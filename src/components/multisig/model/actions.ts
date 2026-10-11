/**
 * From a form to the input of the core's `createProposal`. Only user-signed
 * actions: a treasury governs funds; trading is delegated to an API wallet,
 * not proposed order by order.
 *
 * The core passes `string` fields through verbatim, so this layer lowercases
 * addresses and writes amounts in canonical form. It never rounds: an amount
 * with too many decimals is an error, not a silent truncation.
 */
import {
	type AccountMode,
	type Address,
	activationCharge,
	Decimal,
	fromPlain,
	type Hex,
	hasErrors,
	type Issue,
	issue,
	type Network,
	networkConfig,
	type PlainObject,
	type Policy,
	type ProposalInput,
	sendRefusal,
	sendShape,
	signingFamilyFor,
	stringifyJson,
	toPlain,
	tryParseJson,
	userSignedSpec,
} from "@hl-tools/core";
import { ADDRESS_RE } from "#/components/tools/multisig/model";
import { chainChoiceFor, type InnerChain } from "./chains";
import type { NonceMode } from "./nonce";
import { selfRefusal } from "./selfSend";
import {
	judgeSet,
	type SignerCheck,
	signersField,
	wantedSet,
} from "./signerSet";

/**
 * `sendUsdc` and `sendToken` both build a `sendAsset`: the one way of sending
 * that Hyperliquid takes in any order, from an account in any mode, and that
 * delivers the full amount to an address never used (see the core's
 * rules/transfers). A `usdSend` or `spotSend` can still be written as raw JSON.
 */
export type ActionKind =
	| "sendUsdc"
	| "sendToken"
	| "usdClassTransfer"
	| "withdraw3"
	| "approveAgent"
	| "changeSigners"
	| "raw";

export const ACTION_KINDS: readonly {
	readonly kind: ActionKind;
	readonly label: string;
	readonly description: string;
}[] = [
	{
		kind: "sendUsdc",
		label: "Send USDC",
		description: "USDC to another Hyperliquid account.",
	},
	{
		kind: "sendToken",
		label: "Send spot token",
		description: "A spot token to another Hyperliquid account.",
	},
	{
		kind: "usdClassTransfer",
		label: "Perps ↔ spot",
		description: "Move USDC between this account's perps and spot balances.",
	},
	{
		kind: "withdraw3",
		label: "Withdraw",
		description: "USDC from the perps balance to Arbitrum through the bridge.",
	},
	{
		kind: "approveAgent",
		label: "Approve API wallet",
		description:
			"Let another key act for this account without the signers: trade, and move its money into vaults.",
	},
	{
		kind: "changeSigners",
		label: "Change signers",
		description:
			"Replace the list of signers and how many of them must sign, in one step.",
	},
	{
		kind: "raw",
		label: "Raw JSON",
		description: "Any other user-signed action, written as JSON.",
	},
];

/** One of the two balances of a manual account. */
export type PocketChoice = "perps" | "spot";

/** What is known about a destination when the form is filled in. */
export interface Receiver {
	/**
	 * new      never used on Hyperliquid: the first send to it costs 1 USDC
	 * active   an account in use: sending to it costs nothing
	 * agent    an API wallet's address: whether the fee applies cannot be told
	 * other    a vault or a sub-account
	 * unknown  could not be read
	 */
	readonly status: "new" | "active" | "agent" | "other" | "unknown";
	/** Its account mode; null when not read. */
	readonly mode: AccountMode | null;
	/** For an API wallet: the account it trades for. */
	readonly agentOf?: string | null;
}

/** Flat strings, as the inputs hold them. */
export interface ActionForm {
	readonly kind: ActionKind;
	readonly destination: string;
	readonly amount: string;
	/**
	 * Which of the treasury's balances a USDC send is taken from. `auto`: the
	 * one that holds the money (see `sourcePocket`). A unified treasury has one.
	 */
	readonly fromPocket: PocketChoice | "auto";
	/** Which of the receiver's balances a USDC send arrives in. */
	readonly toPocket: PocketChoice;
	/** `NAME:tokenId`, as the action carries it. */
	readonly token: string;
	readonly toPerp: "perp" | "spot";
	readonly agentAddress: string;
	readonly agentName: string;
	/**
	 * A change of signers, as the action itself carries it (see `wantedSet`):
	 * "" while untouched, the signer set as a JSON string, or "null" for the
	 * conversion back to a normal account.
	 */
	readonly signers: string;
	readonly raw: string;
	/** The leader: the signer expected to complete and submit. */
	readonly finaliser: string;
	readonly chain: InnerChain;
	readonly nonceMode: NonceMode;
	readonly title: string;
	readonly note: string;
}

export const DEFAULT_FORM: ActionForm = {
	kind: "sendUsdc",
	destination: "",
	amount: "",
	fromPocket: "auto",
	toPocket: "perps",
	token: "",
	toPerp: "perp",
	agentAddress: "",
	agentName: "",
	signers: "",
	raw: "",
	finaliser: "",
	chain: "hyperevm",
	nonceMode: "now",
	title: "",
	note: "",
};

export interface BuildContext {
	readonly network: Network;
	readonly multiSigUser: string;
	/** Goes into the action's own `time`/`nonce` field and the proposal. */
	readonly nonce: number;
	readonly signatureChainId: Hex;
	/** Spot tokens of this network, to check the token and its decimals. */
	readonly tokens?: readonly {
		readonly name: string;
		readonly tokenId: string;
		readonly weiDecimals: number;
	}[];
	/** Observed balances; they only ever produce warnings. */
	readonly balances?: {
		readonly perpWithdrawable?: string;
		readonly spot?: readonly {
			readonly coin: string;
			readonly total: string;
			/** Held by positions and resting orders; what can be sent is total − hold. */
			readonly hold?: string;
		}[];
	};
	/** The treasury's account mode: absent while it is being read, null when it could not be. */
	readonly mode?: AccountMode | null;
	/** What is known about the destination; null or absent while it is not. */
	readonly receiver?: Receiver | null;
	/** What Hyperliquid said about the addresses that would be new signers. */
	readonly signerChecks?: ReadonlyMap<string, SignerCheck>;
	readonly createdBy?: string | null;
	readonly supersedes?: Hex | null;
	readonly policyAtCreation?: Policy | null;
}

const NO_CHECKS: ReadonlyMap<string, SignerCheck> = new Map();

/** Perps USDC is accounted in 1e6. */
const USDC_DECIMALS = 6;
const USDC = "USDC";
const TOKEN_RE = /^[^:\s]+:0x[0-9a-f]{32}$/;

function addressField(
	value: string,
	path: string,
	what: string,
	issues: Issue[],
): string | null {
	const v = value.trim();
	if (!v) {
		issues.push(
			issue("field.required", "error", `${what} is required.`, { path }),
		);
		return null;
	}
	if (!ADDRESS_RE.test(v)) {
		issues.push(
			issue(
				"address.invalid",
				"error",
				`${what} must be a 20-byte hex address: 0x followed by 40 hex digits.`,
				{ path },
			),
		);
		return null;
	}
	return v.toLowerCase();
}

function amountField(
	value: string,
	maxDecimals: number,
	unit: string,
	issues: Issue[],
): Decimal | null {
	const path = "action.amount";
	const v = value.trim();
	if (!v) {
		issues.push(
			issue("field.required", "error", "Amount is required.", { path }),
		);
		return null;
	}
	// a person types 12.5, not 1.25e1; refuse the exponent form the parser would accept
	const d = /[eE]/.test(v) ? null : Decimal.tryParse(v);
	if (!d) {
		issues.push(
			issue(
				"amount.invalid",
				"error",
				"Amount must be a plain decimal number such as 12.5.",
				{ path },
			),
		);
		return null;
	}
	if (!d.isPositive()) {
		issues.push(
			issue(
				"amount.not_positive",
				"error",
				"Amount must be greater than zero.",
				{
					path,
				},
			),
		);
		return null;
	}
	if (d.decimalPlaces() > maxDecimals) {
		issues.push(
			issue(
				"amount.precision",
				"error",
				`${unit} has ${maxDecimals} decimal places; ${v} has ${d.decimalPlaces()}.`,
				{
					path,
					fix: "Shorten the amount yourself; it is never rounded for you.",
				},
			),
		);
		return null;
	}
	return d;
}

function warnOverBalance(
	amount: Decimal,
	balance: string | undefined,
	what: string,
	issues: Issue[],
): void {
	const b = balance === undefined ? null : Decimal.tryParse(balance);
	if (b && amount.gt(b)) {
		issues.push(
			issue(
				"amount.exceeds_balance",
				"warning",
				`${amount.toString()} is more than the ${what} observed just now (${b.toString()}). The chain will reject it unless funds arrive first.`,
				{ path: "action.amount" },
			),
		);
	}
}

/**
 * What the treasury can send of a spot token now: its total less what is
 * held. Hyperliquid lists only the tokens an account holds, so a token
 * missing from balances that were read is none of it.
 */
function spotFree(ctx: BuildContext, coin: string): string | undefined {
	const b = ctx.balances?.spot?.find((x) => x.coin === coin);
	if (!b) return ctx.balances?.spot ? "0" : undefined;
	const total = Decimal.tryParse(b.total);
	const hold = Decimal.tryParse(b.hold ?? "0");
	return total && hold ? total.sub(hold).toString() : b.total;
}

const positive = (v: string | undefined): boolean =>
	!!v && (Decimal.tryParse(v)?.isPositive() ?? false);

/**
 * The balance a USDC send is taken from. A unified treasury has one, reported
 * as spot. A manual one: the pocket the form names, or, left on `auto`, the
 * one that holds the money (perps when both do, or when neither is known to).
 */
export function sourcePocket(
	form: Pick<ActionForm, "fromPocket">,
	ctx: Pick<BuildContext, "mode" | "balances">,
): PocketChoice {
	if (ctx.mode?.kind === "unified") return "spot";
	if (form.fromPocket !== "auto") return form.fromPocket;
	return !positive(ctx.balances?.perpWithdrawable) &&
		positive(spotFree(ctx as BuildContext, USDC))
		? "spot"
		: "perps";
}

/**
 * The balance of the receiver a USDC send arrives in: the pocket the form
 * names. A unified receiver has one balance, so the question is not asked and
 * the action names spot, where that balance is reported.
 */
export function arrivalPocket(
	form: Pick<ActionForm, "toPocket">,
	ctx: Pick<BuildContext, "receiver">,
): PocketChoice {
	return ctx.receiver?.mode?.kind === "unified" ? "spot" : form.toPocket;
}

const dexOf = (p: PocketChoice): string => (p === "perps" ? "" : "spot");

/**
 * The mode could not be read, so the form offers what a manual account can
 * do. Said where that would be refused if the treasury turned out unified.
 */
const modeUnread = (consequence: string): Issue =>
	issue(
		"mode.unread",
		"warning",
		`This treasury's account mode could not be read from Hyperliquid. If it is a unified account, ${consequence}`,
		// not a field of this form: shown with the general notes
		{ path: "mode" },
	);

/**
 * Warnings about a finished action that moves money: what the treasury's mode
 * or the receiver being new will make of it. Balances are read a moment ago,
 * so nothing here blocks: the check before submitting does.
 */
function warnAboutSend(
	action: PlainObject,
	ctx: BuildContext,
	issues: Issue[],
): void {
	const treasury = ctx.multiSigUser.toLowerCase();
	const toItself = selfRefusal(treasury, action);
	if (toItself) {
		issues.push(
			issue(
				"action.self_refused",
				"error",
				toItself === "self-transfer"
					? "This sends from the treasury to itself, and Hyperliquid refuses that kind of send to oneself."
					: "This sends from one of the treasury's balances into the same balance of itself, and Hyperliquid refuses that. To move USDC between its perps and spot balances, use Perps ↔ spot.",
				{ path: "action.destination" },
			),
		);
	} else if (sendShape(action)?.destination === treasury) {
		issues.push(
			issue(
				"action.self_send",
				"warning",
				"The destination is the treasury itself: this only moves money between its own balances.",
				{ path: "action.destination" },
			),
		);
	}
	const refusal = ctx.mode ? sendRefusal(ctx.mode, action) : null;
	if (refusal === "unified-disabled" || refusal === "unified-spot-only") {
		issues.push(
			issue(
				"mode.refuses",
				"warning",
				refusal === "unified-disabled"
					? "This treasury is a unified account, and Hyperliquid switches this action off there. Use Send USDC or Send spot token instead."
					: "This treasury is a unified account: it can only send from its one balance, which Hyperliquid calls spot.",
				{ path: "action" },
			),
		);
	}
	if (refusal === "token-invalid") {
		issues.push(
			issue(
				"token.not_collateral",
				"warning",
				"Only USDC moves into or out of a perps balance. Hyperliquid refuses any other token there.",
				{ path: "action.token" },
			),
		);
	}
	if (ctx.receiver?.status !== "new") return;
	const charge = activationCharge({
		action,
		receiverNew: true,
		spotUsdc: spotFree(ctx, USDC) ?? null,
		perpsUsdc: ctx.balances?.perpWithdrawable ?? null,
	});
	if (charge.refusal === "transfer-below-fee") {
		issues.push(
			issue(
				"fee.below",
				"warning",
				"The destination is new, and this kind of send pays the 1 USDC fee out of the amount: Hyperliquid refuses an amount of 1 USDC or less.",
				{ path: "action.amount" },
			),
		);
	}
	if (charge.refusal === "transfer-gas") {
		issues.push(
			issue(
				"fee.not_covered",
				"warning",
				"The destination is new, so this costs 1 USDC on top of the amount, and the balances observed just now do not cover both. The chain will reject it unless funds arrive first.",
				{ path: "action.amount" },
			),
		);
	}
}

export interface BuiltAction {
	readonly action: PlainObject | null;
	/**
	 * The action as far as the form goes, also while it still has errors (an
	 * amount not typed yet). Only for saying what a send will cost before it is
	 * complete: never signed, never stored.
	 */
	readonly sketch: PlainObject | null;
	readonly issues: readonly Issue[];
}

/** The inner action for the chosen kind, or the reasons it cannot be built. */
export function buildAction(form: ActionForm, ctx: BuildContext): BuiltAction {
	const issues: Issue[] = [];
	const head = {
		signatureChainId: ctx.signatureChainId,
		hyperliquidChain: networkConfig(ctx.network).hyperliquidChain,
	};
	const treasury = ctx.multiSigUser.toLowerCase();
	const done = (action: PlainObject | null): BuiltAction => ({
		action: hasErrors(issues) ? null : action,
		sketch: action,
		issues,
	});
	// what a destination that is the treasury itself means is said where the
	// action is known: a send (`warnAboutSend`), a withdrawal (below)
	const destination = () =>
		addressField(form.destination, "action.destination", "Destination", issues);

	switch (form.kind) {
		case "sendUsdc": {
			const dest = destination();
			const amount = amountField(form.amount, USDC_DECIMALS, USDC, issues);
			const usdc = ctx.tokens?.find((t) => t.name === USDC);
			if (!usdc) {
				issues.push(
					issue(
						"token.list_missing",
						"error",
						`The token list of ${ctx.network} is not loaded yet, and the action has to name USDC by its id.`,
						// not a field of this form: shown with the general notes
						{ path: "tokens" },
					),
				);
			}
			const from = sourcePocket(form, ctx);
			if (ctx.mode === null && from === "perps")
				issues.push(
					modeUnread(
						"Hyperliquid refuses a payment taken from the perps balance: choose Spot.",
					),
				);
			if (amount)
				warnOverBalance(
					amount,
					from === "perps"
						? ctx.balances?.perpWithdrawable
						: spotFree(ctx, USDC),
					ctx.mode?.kind === "unified"
						? "balance that can be moved"
						: from === "perps"
							? "withdrawable perps balance"
							: "USDC spot balance",
					issues,
				);
			const action: PlainObject = {
				type: "sendAsset",
				...head,
				destination: dest ?? "",
				sourceDex: dexOf(from),
				destinationDex: dexOf(arrivalPocket(form, ctx)),
				token: usdc ? `${usdc.name}:${usdc.tokenId}` : "",
				amount: amount?.toString() ?? "",
				fromSubAccount: "",
				nonce: ctx.nonce,
			};
			warnAboutSend(action, ctx, issues);
			return done(action);
		}
		case "withdraw3": {
			const dest = destination();
			if (dest && dest === treasury) {
				issues.push(
					issue(
						"withdraw.own_address",
						"warning",
						"The destination is the treasury's own address. On Arbitrum that address is controlled by the account's own key, not by the signers.",
						{ path: "action.destination" },
					),
				);
			}
			const amount = amountField(form.amount, USDC_DECIMALS, USDC, issues);
			if (amount)
				warnOverBalance(
					amount,
					ctx.balances?.perpWithdrawable,
					"withdrawable perps balance",
					issues,
				);
			return done({
				type: "withdraw3",
				...head,
				destination: dest ?? "",
				amount: amount?.toString() ?? "",
				time: ctx.nonce,
			});
		}
		case "sendToken": {
			const dest = destination();
			const token = form.token.trim();
			const listed = ctx.tokens?.find(
				(t) => `${t.name}:${t.tokenId}` === token,
			);
			if (!token) {
				issues.push(
					issue("field.required", "error", "Choose a token.", {
						path: "action.token",
					}),
				);
			} else if (!TOKEN_RE.test(token)) {
				issues.push(
					issue(
						"token.invalid",
						"error",
						"The token must be written NAME:0x… with its 16-byte token id.",
						{ path: "action.token" },
					),
				);
			} else if (ctx.tokens && !listed) {
				issues.push(
					issue(
						"token.unknown",
						"error",
						`${token} is not a spot token on ${ctx.network}.`,
						{ path: "action.token" },
					),
				);
			}
			const name = token.split(":")[0] ?? "token";
			const amount = amountField(
				form.amount,
				listed?.weiDecimals ?? 8,
				name,
				issues,
			);
			if (amount)
				warnOverBalance(
					amount,
					spotFree(ctx, name),
					`${name} spot balance`,
					issues,
				);
			const action: PlainObject = {
				type: "sendAsset",
				...head,
				destination: dest ?? "",
				sourceDex: "spot",
				destinationDex: "spot",
				token,
				amount: amount?.toString() ?? "",
				fromSubAccount: "",
				nonce: ctx.nonce,
			};
			warnAboutSend(action, ctx, issues);
			return done(action);
		}
		case "usdClassTransfer": {
			if (ctx.mode?.kind === "unified") {
				issues.push(
					issue(
						"mode.one_balance",
						"error",
						"This treasury is a unified account: it has one balance, so there is nothing to move between perps and spot.",
						// not a field of this form: shown with the general notes
						{ path: "mode" },
					),
				);
			}
			if (ctx.mode === null)
				issues.push(
					modeUnread(
						"it has one balance and Hyperliquid refuses a move between perps and spot.",
					),
				);
			const toPerp = form.toPerp === "perp";
			const amount = amountField(form.amount, USDC_DECIMALS, "USDC", issues);
			if (amount)
				warnOverBalance(
					amount,
					toPerp ? spotFree(ctx, USDC) : ctx.balances?.perpWithdrawable,
					toPerp ? "USDC spot balance" : "withdrawable perps balance",
					issues,
				);
			return done({
				type: "usdClassTransfer",
				...head,
				amount: amount?.toString() ?? "",
				toPerp,
				nonce: ctx.nonce,
			});
		}
		case "approveAgent": {
			const agent = addressField(
				form.agentAddress,
				"action.agentAddress",
				"API wallet address",
				issues,
			);
			if (agent && agent === treasury) {
				issues.push(
					issue(
						"agent.self",
						"error",
						"The API wallet cannot be the multi-sig account itself.",
						{ path: "action.agentAddress" },
					),
				);
			}
			return done({
				type: "approveAgent",
				...head,
				agentAddress: agent ?? "",
				agentName: form.agentName.trim(),
				nonce: ctx.nonce,
			});
		}
		case "changeSigners": {
			const path = "action.signers";
			const current = ctx.policyAtCreation ?? null;
			if (!current || current.authorizedUsers.length === 0) {
				issues.push(
					issue(
						"signers.unread",
						"error",
						"The treasury's signers have not been read yet.",
						{ path },
					),
				);
				return done(null);
			}
			const wanted = wantedSet(form.signers, current);
			const convert = (signers: string): PlainObject => ({
				type: "convertToMultiSigUser",
				...head,
				signers,
				nonce: ctx.nonce,
			});
			// nothing to choose and nothing Hyperliquid would refuse: the signers decide
			if (wanted.revert) return done(convert("null"));
			const judged = judgeSet({
				entries: wanted.entries,
				threshold: wanted.threshold,
				self: treasury,
				checks: ctx.signerChecks ?? NO_CHECKS,
				current,
				me: ctx.createdBy ?? null,
				leader: form.finaliser.trim() || null,
			});
			const stop = (code: string, message: string) =>
				issues.push(issue(code, "error", message, { path }));
			if (judged.unchanged) stop("signers.unchanged", "Nothing changes yet.");
			else if (judged.blockedBy) stop("signers.blocked", judged.blockedBy);
			else if (judged.pending)
				stop("signers.checking", "Checking the new signers on Hyperliquid…");
			return done(convert(signersField(wanted.entries, wanted.threshold)));
		}
		case "raw": {
			const action = rawAction(form.raw, head, ctx.nonce, issues);
			if (action) warnAboutSend(action, ctx, issues);
			return done(action);
		}
	}
}

function rawAction(
	text: string,
	head: { signatureChainId: Hex; hyperliquidChain: string },
	nonce: number,
	issues: Issue[],
): PlainObject | null {
	const path = "action";
	const trimmed = text.trim();
	if (!trimmed) {
		issues.push(
			issue("field.required", "error", "Paste the action as JSON.", { path }),
		);
		return null;
	}
	const parsed = tryParseJson(trimmed);
	if (!parsed.ok) {
		issues.push(
			issue(
				"raw.invalid",
				"error",
				`Not valid JSON: ${parsed.error.message}.`,
				{
					path,
				},
			),
		);
		return null;
	}
	const plain = toPlain(parsed.node);
	if (!plain || typeof plain !== "object" || Array.isArray(plain)) {
		issues.push(
			issue("raw.not_object", "error", "The action must be a JSON object.", {
				path,
			}),
		);
		return null;
	}
	const obj = plain as PlainObject;
	const type = obj.type;
	if (typeof type !== "string") {
		issues.push(
			issue("raw.no_type", "error", 'The action needs a string "type".', {
				path,
			}),
		);
		return null;
	}
	const family = signingFamilyFor(type);
	if (family === "multisig") {
		issues.push(
			issue(
				"raw.nested_envelope",
				"error",
				"Paste the inner action, not a multiSig envelope.",
				{ path },
			),
		);
		return null;
	}
	if (family !== "user-signed") {
		issues.push(
			issue(
				"raw.l1_out_of_scope",
				"error",
				`"${type}" is an L1 action (orders, cancels, leverage, vault and sub-account moves). Those are not proposals here.`,
				{
					path,
					fix: "To trade with multi-sig funds, propose an API wallet and trade with its key.",
				},
			),
		);
		return null;
	}
	if (type === "convertToMultiSigUser") {
		issues.push(
			issue(
				"raw.convert_out_of_scope",
				"error",
				"Changing the signers has its own form, which checks the new list and says what the change does to waiting proposals.",
				{ path, fix: "Choose “Change signers” above." },
			),
		);
		return null;
	}
	// signingFamilyFor said user-signed, so the spec exists
	const nonceField = userSignedSpec(type)?.nonceField ?? "nonce";
	const forced: Record<string, string | number> = {
		signatureChainId: head.signatureChainId,
		hyperliquidChain: head.hyperliquidChain,
		[nonceField]: nonce,
	};
	const overridden = Object.keys(forced).filter(
		(k) => k in obj && obj[k] !== forced[k],
	);
	if (overridden.length) {
		issues.push(
			issue(
				"raw.field_overridden",
				"info",
				`${overridden.join(", ")} ${overridden.length > 1 ? "are" : "is"} set by this page (signing chain, network and nonce) and replaced what you pasted.`,
				{ path },
			),
		);
	}
	return { ...obj, ...forced };
}

/**
 * The action type a form will produce, known before the action can be built
 * (the nonce it needs depends on the type: sends and withdrawals are numbered
 * after the ones on record). Null when raw JSON does not say.
 */
export function actionTypeOf(
	form: Pick<ActionForm, "kind" | "raw">,
): string | null {
	switch (form.kind) {
		case "sendUsdc":
		case "sendToken":
			return "sendAsset";
		case "changeSigners":
			return "convertToMultiSigUser";
		case "raw": {
			const parsed = tryParseJson(form.raw.trim());
			const plain = parsed.ok ? toPlain(parsed.node) : null;
			const type =
				plain && typeof plain === "object" && !Array.isArray(plain)
					? (plain as PlainObject).type
					: null;
			return typeof type === "string" ? type : null;
		}
		default:
			return form.kind;
	}
}

/**
 * The Hyperliquid account a form pays, lowercased, once it is a whole
 * address: the one whose being new or in use decides what the send costs.
 * Null for what pays nobody on Hyperliquid (a withdrawal goes to Arbitrum).
 */
export function destinationOf(
	form: Pick<ActionForm, "kind" | "destination" | "raw">,
): string | null {
	let value = "";
	if (form.kind === "sendUsdc" || form.kind === "sendToken")
		value = form.destination;
	else if (form.kind === "raw") {
		const parsed = tryParseJson(form.raw.trim());
		const plain = parsed.ok ? toPlain(parsed.node) : null;
		const o =
			plain && typeof plain === "object" && !Array.isArray(plain)
				? (plain as PlainObject)
				: null;
		// the ways of sending to an account; a withdrawal names an Arbitrum address
		if (o && ["usdSend", "spotSend", "sendAsset"].includes(str(o.type)))
			value = str(o.destination);
	}
	const address = value.trim().toLowerCase();
	return ADDRESS_RE.test(address) ? address : null;
}

export interface Draft {
	/** Null while the form has errors. */
	readonly input: ProposalInput | null;
	readonly action: PlainObject | null;
	/** See `BuiltAction.sketch`. */
	readonly sketch: PlainObject | null;
	readonly issues: readonly Issue[];
}

/** Everything `createProposal` needs. Vault address and expiry are always null (see DECISIONS). */
export function buildProposalInput(form: ActionForm, ctx: BuildContext): Draft {
	const built = buildAction(form, ctx);
	const issues: Issue[] = [...built.issues];
	const path = "payload.outerSigner";
	const finaliser = form.finaliser.trim().toLowerCase();
	if (!finaliser) {
		issues.push(
			issue("finaliser.required", "error", "Choose who finalises this.", {
				path,
			}),
		);
	} else if (!ADDRESS_RE.test(finaliser)) {
		issues.push(
			issue("address.invalid", "error", "The finaliser must be an address.", {
				path,
			}),
		);
	} else if (
		ctx.policyAtCreation &&
		!ctx.policyAtCreation.authorizedUsers.includes(finaliser as Address)
	) {
		issues.push(
			issue(
				"finaliser.not_signer",
				"error",
				"The finaliser must be one of the current signers: only an authorized user can submit.",
				{ path },
			),
		);
	}
	if (!built.action || hasErrors(issues))
		return { input: null, action: built.action, sketch: built.sketch, issues };
	return {
		action: built.action,
		sketch: built.sketch,
		issues,
		input: {
			network: ctx.network,
			multiSigUser: ctx.multiSigUser,
			outerSigner: finaliser,
			action: built.action,
			nonce: ctx.nonce,
			vaultAddress: null,
			expiresAfter: null,
			title: form.title.trim() || null,
			note: form.note.trim() || null,
			// wallets report checksummed addresses; documents carry lowercase
			createdBy: ctx.createdBy ? ctx.createdBy.toLowerCase() : null,
			supersedes: ctx.supersedes ?? null,
			policyAtCreation: ctx.policyAtCreation ?? null,
		},
	};
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Pre-fill the form from an existing action (re-proposing after expiry). */
export function formFromAction(
	action: PlainObject,
	network: Network,
): Partial<ActionForm> {
	const chain =
		chainChoiceFor(str(action.signatureChainId), network) ?? undefined;
	const base = chain ? { chain } : {};
	const pocket = (dex: unknown): PocketChoice | null =>
		dex === "" ? "perps" : dex === "spot" ? "spot" : null;
	const isUsdc = (token: unknown) => str(token).split(":")[0] === USDC;
	switch (action.type) {
		// the two older ways of sending come back as the send that replaces them
		case "usdSend":
			return {
				...base,
				kind: "sendUsdc",
				destination: str(action.destination),
				amount: str(action.amount),
				fromPocket: "perps",
				toPocket: "perps",
			};
		case "spotSend":
			return isUsdc(action.token)
				? {
						...base,
						kind: "sendUsdc",
						destination: str(action.destination),
						amount: str(action.amount),
						fromPocket: "spot",
						toPocket: "spot",
					}
				: {
						...base,
						kind: "sendToken",
						destination: str(action.destination),
						token: str(action.token),
						amount: str(action.amount),
					};
		case "sendAsset": {
			const from = pocket(action.sourceDex);
			const to = pocket(action.destinationDex);
			// another perp dex or a sub-account is beyond the two forms
			if (from && to && str(action.fromSubAccount) === "") {
				if (isUsdc(action.token))
					return {
						...base,
						kind: "sendUsdc",
						destination: str(action.destination),
						amount: str(action.amount),
						fromPocket: from,
						toPocket: to,
					};
				if (from === "spot" && to === "spot")
					return {
						...base,
						kind: "sendToken",
						destination: str(action.destination),
						token: str(action.token),
						amount: str(action.amount),
					};
			}
			return rawForm(action, base);
		}
		case "withdraw3":
			return {
				...base,
				kind: "withdraw3",
				destination: str(action.destination),
				amount: str(action.amount),
			};
		case "usdClassTransfer":
			return {
				...base,
				kind: "usdClassTransfer",
				amount: str(action.amount),
				toPerp: action.toPerp === false ? "spot" : "perp",
			};
		case "approveAgent":
			return {
				...base,
				kind: "approveAgent",
				agentAddress: str(action.agentAddress),
				agentName: str(action.agentName),
			};
		// the form's field is the action's own value: nothing to translate
		case "convertToMultiSigUser":
			return { ...base, kind: "changeSigners", signers: str(action.signers) };
		default:
			return rawForm(action, base);
	}
}

/** The action as raw JSON, without the three fields this page sets, so the paste is not "overridden" at once. */
function rawForm(
	action: PlainObject,
	base: Partial<ActionForm>,
): Partial<ActionForm> {
	const nonceField = userSignedSpec(str(action.type))?.nonceField ?? "nonce";
	const rest = Object.fromEntries(
		Object.entries(action).filter(
			([k]) =>
				k !== "signatureChainId" &&
				k !== "hyperliquidChain" &&
				k !== nonceField,
		),
	);
	return { ...base, kind: "raw", raw: stringifyJson(fromPlain(rest), 2) };
}

/** Which form field an issue belongs under, if any. */
export function fieldOf(i: Issue): keyof ActionForm | null {
	switch (i.path) {
		case "action.destination":
			return "destination";
		case "action.amount":
			return "amount";
		case "action.token":
			return "token";
		case "action.agentAddress":
			return "agentAddress";
		case "action.agentName":
			return "agentName";
		case "action.signers":
			return "signers";
		case "action":
		case "action.type":
			return "raw";
		case "payload.outerSigner":
			return "finaliser";
		default:
			return null;
	}
}
