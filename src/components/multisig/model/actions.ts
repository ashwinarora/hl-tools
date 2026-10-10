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
	type Address,
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
	signingFamilyFor,
	stringifyJson,
	toPlain,
	tryParseJson,
	userSignedSpec,
} from "@hl-tools/core";
import { ADDRESS_RE } from "#/components/tools/multisig/model";
import { chainChoiceFor, type InnerChain } from "./chains";
import type { NonceMode } from "./nonce";

export type ActionKind =
	| "usdSend"
	| "spotSend"
	| "usdClassTransfer"
	| "withdraw3"
	| "approveAgent"
	| "raw";

export const ACTION_KINDS: readonly {
	readonly kind: ActionKind;
	readonly label: string;
	readonly description: string;
}[] = [
	{
		kind: "usdSend",
		label: "Send USDC",
		description: "USDC from the perps balance to another Hyperliquid account.",
	},
	{
		kind: "spotSend",
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
			"Let another key trade for this account without the multi-sig.",
	},
	{
		kind: "raw",
		label: "Raw JSON",
		description: "Any other user-signed action, written as JSON.",
	},
];

/** Flat strings, as the inputs hold them. */
export interface ActionForm {
	readonly kind: ActionKind;
	readonly destination: string;
	readonly amount: string;
	/** `NAME:tokenId`, as the spot send action carries it. */
	readonly token: string;
	readonly toPerp: "perp" | "spot";
	readonly agentAddress: string;
	readonly agentName: string;
	readonly raw: string;
	/** The leader: the signer expected to complete and submit. */
	readonly finaliser: string;
	readonly chain: InnerChain;
	readonly nonceMode: NonceMode;
	readonly title: string;
	readonly note: string;
}

export const DEFAULT_FORM: ActionForm = {
	kind: "usdSend",
	destination: "",
	amount: "",
	token: "",
	toPerp: "perp",
	agentAddress: "",
	agentName: "",
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
		}[];
	};
	readonly createdBy?: string | null;
	readonly supersedes?: Hex | null;
	readonly policyAtCreation?: Policy | null;
}

/** Perps USDC is accounted in 1e6. */
const USDC_DECIMALS = 6;
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

export interface BuiltAction {
	readonly action: PlainObject | null;
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
		issues,
	});
	const destination = () => {
		const d = addressField(
			form.destination,
			"action.destination",
			"Destination",
			issues,
		);
		if (d && d === treasury) {
			issues.push(
				issue(
					"action.self_send",
					"warning",
					"The destination is the multi-sig account itself.",
					{ path: "action.destination" },
				),
			);
		}
		return d;
	};

	switch (form.kind) {
		case "usdSend":
		case "withdraw3": {
			const dest = destination();
			const amount = amountField(form.amount, USDC_DECIMALS, "USDC", issues);
			if (amount)
				warnOverBalance(
					amount,
					ctx.balances?.perpWithdrawable,
					"withdrawable perps balance",
					issues,
				);
			return done({
				type: form.kind,
				...head,
				destination: dest ?? "",
				amount: amount?.toString() ?? "",
				time: ctx.nonce,
			});
		}
		case "spotSend": {
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
					ctx.balances?.spot?.find((b) => b.coin === name)?.total,
					`${name} spot balance`,
					issues,
				);
			return done({
				type: "spotSend",
				...head,
				destination: dest ?? "",
				token,
				amount: amount?.toString() ?? "",
				time: ctx.nonce,
			});
		}
		case "usdClassTransfer": {
			const toPerp = form.toPerp === "perp";
			const amount = amountField(form.amount, USDC_DECIMALS, "USDC", issues);
			if (amount)
				warnOverBalance(
					amount,
					toPerp
						? ctx.balances?.spot?.find((b) => b.coin === "USDC")?.total
						: ctx.balances?.perpWithdrawable,
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
		case "raw":
			return done(rawAction(form.raw, head, ctx.nonce, issues));
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
				"Changing the signer set needs its own guarded flow (lock-out checks) and is not offered as raw JSON.",
				{ path },
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

export interface Draft {
	/** Null while the form has errors. */
	readonly input: ProposalInput | null;
	readonly action: PlainObject | null;
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
		return { input: null, action: built.action, issues };
	return {
		action: built.action,
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
	switch (action.type) {
		case "usdSend":
		case "withdraw3":
			return {
				...base,
				kind: action.type,
				destination: str(action.destination),
				amount: str(action.amount),
			};
		case "spotSend":
			return {
				...base,
				kind: "spotSend",
				destination: str(action.destination),
				token: str(action.token),
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
		default: {
			// the three fields this page sets are left out so the paste is not "overridden" at once
			const nonceField =
				userSignedSpec(str(action.type))?.nonceField ?? "nonce";
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
	}
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
		case "action":
		case "action.type":
			return "raw";
		case "payload.outerSigner":
			return "finaliser";
		default:
			return null;
	}
}
