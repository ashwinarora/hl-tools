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
	isAgentRemoval,
	isolated,
	issue,
	type Move,
	moveOf,
	multiSigEvmRefusal,
	type Network,
	networkConfig,
	nonceWindow,
	type PlainObject,
	type Policy,
	type Proposal,
	type ProposalInput,
	sendRefusal,
	sendShape,
	signingFamilyFor,
	stakingActionOf,
	stepNumber,
	stringifyJson,
	toPlain,
	tryParseJson,
	userSignedSpec,
	vaultActionOf,
	visibleText,
	WITHDRAWAL_FEE_USDC,
	withdrawalOutcome,
	ZERO_ADDRESS,
} from "@hl-tools/core";
import { ADDRESS_RE } from "#/components/tools/multisig/model";
import { chainChoiceFor, type InnerChain } from "./chains";
import { addressField, amountField } from "./fields";
import {
	judgeSwitch,
	MODE_NAME,
	MODE_SWITCH,
	type ModeTarget,
	modeTargetOf,
	otherMode,
	type SwitchFacts,
} from "./modeSwitch";
import type { NonceMode } from "./nonce";
import { selfRefusal } from "./selfSend";
import { largerOf, sendsBefore, sendsFirstLine, TO_HYPEREVM } from "./send";
import {
	judgeSet,
	type SignerCheck,
	signersField,
	wantedSet,
} from "./signerSet";
import {
	planStaking,
	STAKING,
	type StakingKind,
	type StakingRead,
	stakingActions,
} from "./staking";
import {
	planVault,
	VAULT,
	type VaultKind,
	type VaultRead,
	vaultActions,
} from "./vault";

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
	| "removeAgent"
	| "accountMode"
	| "changeSigners"
	| StakingKind
	| VaultKind
	| "raw";

export const ACTION_KINDS: readonly {
	readonly kind: ActionKind;
	readonly label: string;
	readonly description: string;
	/** Kinds a chooser shows as one entry, with the choice between them inside. */
	readonly group?: "staking" | "vault";
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
		kind: "removeAgent",
		label: "Remove API wallet",
		description:
			"Take an API wallet's permission to act for this account away again.",
	},
	{
		kind: "accountMode",
		label: "Switch account mode",
		description:
			"Change between a manual account, with separate perps and spot balances, and a unified one, with one balance.",
	},
	{
		kind: "changeSigners",
		label: "Change signers",
		description:
			"Replace the list of signers and how many of them must sign, in one step.",
	},
	{ kind: "stake", ...STAKING.kinds.stake, group: "staking" },
	{ kind: "returnToSpot", ...STAKING.kinds.returnToSpot, group: "staking" },
	{ kind: "moveStake", ...STAKING.kinds.moveStake, group: "staking" },
	{ kind: "vaultDeposit", ...VAULT.kinds.vaultDeposit, group: "vault" },
	{ kind: "vaultWithdraw", ...VAULT.kinds.vaultWithdraw, group: "vault" },
	{
		kind: "raw",
		label: "Raw JSON",
		description: "Any other user-signed action, written as JSON.",
	},
];

/**
 * The mode a Switch account mode form switches to: the one chosen, or the
 * other of the two once the treasury's own is read.
 */
export function modeTargetFor(
	form: Pick<ActionForm, "toMode">,
	mode: AccountMode | null | undefined,
): ModeTarget | null {
	return form.toMode || otherMode(mode);
}

/** Every sentence of Remove API wallet. */
export const REMOVE_AGENT = {
	/** How a wallet is called in a sentence: by its name, or as the one without. */
	called: (name: string) =>
		name ? `named "${isolated(visibleText(name))}"` : "without a name",
	missing: (name: string) =>
		`This treasury has no API wallet ${name ? `named "${isolated(visibleText(name))}"` : "without a name"}: there is nothing to remove, and Hyperliquid would refuse it.`,
	none: "This treasury has no API wallet: there is nothing to remove.",
	unread:
		"The API wallets could not be read from Hyperliquid, so there is nothing to choose from yet.",
	reading: "Reading the API wallets from Hyperliquid…",
	what: "That wallet stops acting for the treasury once this is carried out. Nothing else changes: balances, positions and open orders stay as they are.",
	/** Hyperliquid takes one removal at a time ("User has pending agent removal"). */
	oneAtATime:
		"Hyperliquid takes one removal at a time: submit a second one a minute or two after the first.",
} as const;

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
	 * Remove API wallet: the name of the wallet to remove, as Hyperliquid
	 * knows it ("" is the one approved without a name); null while none is
	 * chosen.
	 */
	readonly removeAgent: string | null;
	/**
	 * Switch account mode: the mode to switch to. "" follows the treasury's
	 * own mode: the other of the two, once it is read.
	 */
	readonly toMode: ModeTarget | "";
	/**
	 * A change of signers, as the action itself carries it (see `wantedSet`):
	 * "" while untouched, the signer set as a JSON string, or "null" for the
	 * conversion back to a normal account.
	 */
	readonly signers: string;
	/**
	 * Staking: the validator staked with (Stake) or unstaked from (Return to
	 * spot, Move to another validator), and for a move the one it goes to.
	 */
	readonly validator: string;
	readonly toValidator: string;
	/** Vault deposit and withdrawal: the vault's address. */
	readonly vault: string;
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
	removeAgent: null,
	toMode: "",
	signers: "",
	validator: "",
	toValidator: "",
	vault: "",
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
	/** What is known about the address an API wallet approval names. */
	readonly agent?: Receiver | null;
	/** The treasury's API wallets: absent while they are being read, null when they could not be. */
	readonly agents?:
		| readonly { readonly name: string; readonly address: string }[]
		| null;
	/** Open positions and resting orders of the treasury; null or absent while not read. */
	readonly open?: {
		readonly positions: number | null;
		readonly orders: number | null;
	} | null;
	/**
	 * The proposals of the treasury still waiting: for what a mode switch does
	 * to them, and the older sends a withdrawal should let go first.
	 */
	readonly waiting?: SwitchFacts["waiting"];
	/** What Hyperliquid said about the addresses that would be new signers. */
	readonly signerChecks?: ReadonlyMap<string, SignerCheck>;
	/** What Hyperliquid said about the treasury's balances and deposits and about the vault in the form; null or absent while unread. */
	readonly vault?: VaultRead | null;
	/** What Hyperliquid said about the treasury's staking and the validators; null or absent while unread. */
	readonly staking?: StakingRead | null;
	/** The page's clock, for what is still locked; the proposal's number when absent. */
	readonly now?: number;
	readonly createdBy?: string | null;
	readonly supersedes?: Hex | null;
	readonly policyAtCreation?: Policy | null;
}

const NO_CHECKS: ReadonlyMap<string, SignerCheck> = new Map();

/** Perps USDC is accounted in 1e6. */
const USDC_DECIMALS = 6;
const USDC = "USDC";
const TOKEN_RE = /^[^:\s]+:0x[0-9a-f]{32}$/;

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
	// not an account: nothing else about a receiver applies
	if (multiSigEvmRefusal(action)) {
		issues.push(
			issue("action.to_hyperevm", "error", TO_HYPEREVM, {
				path: "action.destination",
			}),
		);
		return;
	}
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
	/**
	 * The further actions of the same move, in order: a staking form may ask
	 * for two (model/staking.ts). Empty for everything else.
	 */
	readonly also: readonly PlainObject[];
}

/**
 * A plan's steps as the actions built from them, or none and a reason. A step
 * that could not be written as an action would otherwise be left out without
 * a word, and what is left would be proposed as if it were the whole.
 */
export function wholeMove(
	steps: readonly unknown[] | null,
	actions: readonly PlainObject[],
	issues: Issue[],
): readonly PlainObject[] {
	if (!steps || actions.length === steps.length) return actions;
	issues.push(
		issue(
			"action.step_unbuilt",
			"error",
			"One step of this could not be written as an action, so nothing is proposed.",
			{ path: "action.amount" },
		),
	);
	return [];
}

/** The inner action for the chosen kind, or the reasons it cannot be built. */
export function buildAction(form: ActionForm, ctx: BuildContext): BuiltAction {
	const issues: Issue[] = [];
	const head = {
		signatureChainId: ctx.signatureChainId,
		hyperliquidChain: networkConfig(ctx.network).hyperliquidChain,
	};
	const treasury = ctx.multiSigUser.toLowerCase();
	const done = (
		action: PlainObject | null,
		also: readonly PlainObject[] = [],
	): BuiltAction => ({
		action: hasErrors(issues) ? null : action,
		sketch: action,
		issues,
		also: hasErrors(issues) ? [] : also,
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
			if (amount) {
				// a unified account has one balance: see `largerOf`
				const one = ctx.mode?.kind === "unified";
				warnOverBalance(
					amount,
					one
						? (largerOf(
								ctx.balances?.perpWithdrawable ?? null,
								spotFree(ctx, USDC) ?? null,
							) ?? undefined)
						: ctx.balances?.perpWithdrawable,
					one ? "balance that can be moved" : "withdrawable perps balance",
					issues,
				);
			}
			// the bridge keeps its fee out of the amount: at the fee or below, Hyperliquid refuses
			if (
				amount &&
				withdrawalOutcome({ type: "withdraw3", amount: amount.toString() })
					?.refusal
			) {
				issues.push(
					issue(
						"withdraw.below_fee",
						"error",
						`The bridge keeps ${WITHDRAWAL_FEE_USDC} USDC of every withdrawal as its fee, so a withdrawal has to be more than ${WITHDRAWAL_FEE_USDC} USDC. Hyperliquid refuses this one.`,
						{ path: "action.amount" },
					),
				);
			}
			// numbered after every send on record: the waiting ones should go first
			const before = sendsBefore({ type: "withdraw3" }, ctx.waiting ?? []);
			if (before.length > 0)
				issues.push(
					issue(
						"withdraw.after_send",
						"warning",
						sendsFirstLine(before.map((w) => w.title)),
					),
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
			} else if (!ctx.tokens) {
				// how many decimals the token takes is in the list: without it an
				// amount too fine for the token would be proposed, and a refusal
				// uses up the proposal's number
				issues.push(
					issue(
						"token.list_missing",
						"error",
						`The token list of ${ctx.network} is not loaded yet, and it says how many decimals ${token.split(":")[0]} takes.`,
						{ path: "tokens" },
					),
				);
			} else if (!listed) {
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
				false,
			);
			if (agent === ZERO_ADDRESS) {
				// it would build a removal under the label of an approval
				const zero = issues.findIndex((i) => i.code === "address.zero");
				if (zero >= 0) issues.splice(zero, 1);
				issues.push(
					issue(
						"agent.zero",
						"error",
						"The zero address approves nobody: Hyperliquid reads it as removing the API wallet of this name. To remove one, choose Remove API wallet.",
						{ path: "action.agentAddress" },
					),
				);
			} else if (agent && agent === treasury) {
				issues.push(
					issue(
						"agent.self",
						"error",
						"The API wallet cannot be the multi-sig account itself.",
						{ path: "action.agentAddress" },
					),
				);
			} else if (
				agent &&
				(ctx.agent?.status === "active" || ctx.agent?.status === "agent")
			) {
				// allowed as far as this page knows; an API wallet is normally a key made only for this
				issues.push(
					issue(
						"agent.in_use",
						"warning",
						ctx.agent.status === "agent"
							? "This address is already an API wallet on Hyperliquid. Check that it is the one you mean."
							: "This address is already an account in use on Hyperliquid. An API wallet is normally a new key made only for this: check that it is the one you mean.",
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
		case "removeAgent": {
			const path = "action.removeAgent";
			const name = form.removeAgent;
			if (name === null) {
				issues.push(
					issue("field.required", "error", "Choose the API wallet to remove.", {
						path,
					}),
				);
				return done(null);
			}
			if (ctx.agents === null) {
				issues.push(
					issue(
						"agents.unread",
						"warning",
						"This treasury's API wallets could not be read from Hyperliquid. If it has none of this name, Hyperliquid refuses the removal.",
						{ path },
					),
				);
			} else if (ctx.agents && !ctx.agents.some((a) => a.name === name)) {
				// Hyperliquid answers "Extra agent does not exist."
				issues.push(
					issue("agent.missing", "error", REMOVE_AGENT.missing(name), {
						path,
					}),
				);
			}
			// the zero address approves nobody: it removes the wallet of this name
			return done({
				type: "approveAgent",
				...head,
				agentAddress: ZERO_ADDRESS,
				agentName: name,
				nonce: ctx.nonce,
			});
		}
		case "accountMode": {
			const path = "action.abstraction";
			const target = modeTargetFor(form, ctx.mode);
			if (!target) {
				// the mode is on its way, or could not be read and none was chosen
				if (ctx.mode !== undefined)
					issues.push(
						issue("field.required", "error", MODE_SWITCH.choose, { path }),
					);
				return done(null);
			}
			const judged = judgeSwitch(target, {
				mode: ctx.mode,
				positions: ctx.open?.positions ?? null,
				orders: ctx.open?.orders ?? null,
				waiting: ctx.waiting ?? [],
			});
			if (judged.blocked)
				issues.push(issue("mode.busy", "error", judged.blocked, { path }));
			for (const text of judged.warnings)
				issues.push(issue("mode.note", "warning", text, { path: "mode" }));
			return done({
				type: "userSetAbstraction",
				...head,
				user: treasury,
				abstraction: MODE_NAME[target],
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
		case "stake":
		case "returnToSpot":
		case "moveStake": {
			const plan = planStaking(
				{
					kind: form.kind,
					amount: form.amount,
					validator: form.validator,
					toValidator: form.toValidator,
				},
				ctx.staking,
				ctx.network,
				ctx.now ?? ctx.nonce,
			);
			issues.push(...plan.issues);
			// each step is its own proposal, numbered one after the other
			const [first, ...rest] = wholeMove(
				plan.steps,
				plan.steps ? stakingActions(plan.steps, head, ctx.nonce) : [],
				issues,
			);
			return done(first ?? null, rest);
		}
		case "vaultDeposit":
		case "vaultWithdraw": {
			const plan = planVault(
				{ kind: form.kind, amount: form.amount, vault: form.vault },
				ctx.vault,
				ctx.network,
				ctx.now ?? ctx.nonce,
				// the proposal's number is also its deadline
				nonceWindow(ctx.nonce).validUntil,
			);
			issues.push(...plan.issues);
			// each step is its own proposal, numbered one after the other
			const [first, ...rest] = wholeMove(
				plan.steps,
				plan.steps ? vaultActions(plan.steps, head, ctx.nonce) : [],
				issues,
			);
			return done(first ?? null, rest);
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
	if (type === "vaultTransfer") {
		issues.push(
			issue(
				"raw.vault_out_of_scope",
				"error",
				"A vault deposit or withdrawal has its own form: choose “Vault” above. It checks the vault and the balances, and works out the steps.",
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
				`"${type}" is an L1 action (orders, cancels, leverage, sub-account moves). Of those, only vault deposits and withdrawals are proposals here, through the Vault form.`,
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
				"Changing the signers has its own form: choose “Change signers” above. It checks the new list and says what the change does to waiting proposals.",
				{ path },
			),
		);
		return null;
	}
	if (type === "userSetAbstraction") {
		issues.push(
			issue(
				"raw.mode_switch_out_of_scope",
				"error",
				"Switching the account mode has its own form: choose “Switch account mode” above. It offers the two switches measured through a multi-sig, to a unified account and back to a manual one; Hyperliquid refuses any other mode as this page would sign it.",
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
		// a removal is an approval of the zero address
		case "removeAgent":
			return "approveAgent";
		case "accountMode":
			return "userSetAbstraction";
		// one or two actions, known only once the staking balance is read; none
		// of them is numbered after the ones on record
		case "stake":
		case "returnToSpot":
		case "moveStake":
		// likewise one or two, known once the balances are read
		case "vaultDeposit":
		case "vaultWithdraw":
			return null;
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

export interface Drafts {
	/**
	 * One input for each proposal the form asks for, in order: one, or the
	 * two steps of a staking move, numbered one after the other. Null while
	 * the form has errors.
	 */
	readonly inputs: readonly ProposalInput[] | null;
	readonly actions: readonly PlainObject[];
	/** See `BuiltAction.sketch`. */
	readonly sketch: PlainObject | null;
	readonly issues: readonly Issue[];
}

/** Everything `createProposal` needs, for each proposal the form asks for. Vault address and expiry are always null (see DECISIONS). */
export function buildProposalInputs(
	form: ActionForm,
	ctx: BuildContext,
): Drafts {
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
	const actions = built.action ? [built.action, ...built.also] : [];
	if (!built.action || hasErrors(issues))
		return { inputs: null, actions, sketch: built.sketch, issues };
	return {
		actions,
		sketch: built.sketch,
		issues,
		inputs: actions.map((action, i) => ({
			network: ctx.network,
			multiSigUser: ctx.multiSigUser,
			outerSigner: finaliser,
			action,
			nonce: ctx.nonce + i,
			vaultAddress: null,
			expiresAfter: null,
			title: form.title.trim() || null,
			note: form.note.trim() || null,
			// wallets report checksummed addresses; documents carry lowercase
			createdBy: ctx.createdBy ? ctx.createdBy.toLowerCase() : null,
			supersedes: ctx.supersedes ?? null,
			policyAtCreation: ctx.policyAtCreation ?? null,
		})),
	};
}

/** The first (for most forms, the only) proposal a form asks for. */
export function buildProposalInput(form: ActionForm, ctx: BuildContext): Draft {
	const drafts = buildProposalInputs(form, ctx);
	return {
		input: drafts.inputs?.[0] ?? null,
		action: drafts.actions[0] ?? null,
		sketch: drafts.sketch,
		issues: drafts.issues,
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
			// the zero address is a removal: the form that names the wallet by its name
			if (isAgentRemoval(action))
				return {
					...base,
					kind: "removeAgent",
					removeAgent: str(action.agentName),
				};
			return {
				...base,
				kind: "approveAgent",
				agentAddress: str(action.agentAddress),
				agentName: str(action.agentName),
			};
		case "userSetAbstraction": {
			const toMode = modeTargetOf(action);
			// any other mode has no form: it stays as it was written
			return toMode
				? { ...base, kind: "accountMode", toMode }
				: rawForm(action, base);
		}
		// the form's field is the action's own value: nothing to translate
		case "convertToMultiSigUser":
			return { ...base, kind: "changeSigners", signers: str(action.signers) };
		default: {
			// A stake or a return comes back as the form that names its end; the
			// form then works the steps out again from what the treasury holds
			// now. The other two staking steps mean nothing by themselves there
			// and stay as they are.
			const vault = vaultActionOf(action);
			if (vault)
				return {
					...base,
					kind: vault.kind === "deposit" ? "vaultDeposit" : "vaultWithdraw",
					amount: vault.amount,
					vault: vault.vault,
				};
			const staking = stakingActionOf(action);
			if (staking?.kind === "stake")
				return {
					...base,
					kind: "stake",
					amount: staking.amount,
					validator: staking.validator,
				};
			if (staking?.kind === "return")
				return { ...base, kind: "returnToSpot", amount: staking.amount };
			return rawForm(action, base);
		}
	}
}

/** Pre-fill the form from a move of two steps (re-proposing it): the form that names its end. */
export function formFromMove(
	move: Pick<Move, "kind" | "amount" | "validator" | "to" | "steps" | "vault">,
	network: Network,
): Partial<ActionForm> {
	const chain =
		chainChoiceFor(
			str(move.steps[0].payload.action.signatureChainId),
			network,
		) ?? undefined;
	// a deposit in two steps: the form names the deposit and works the steps out again
	if (move.kind === "vault")
		return {
			...(chain ? { chain } : {}),
			kind: "vaultDeposit",
			amount: move.amount,
			vault: move.vault ?? "",
		};
	return {
		...(chain ? { chain } : {}),
		kind:
			move.kind === "stake"
				? "stake"
				: move.kind === "return"
					? "returnToSpot"
					: "moveStake",
		amount: move.amount,
		validator: move.validator,
		toValidator: move.to ?? "",
	};
}

/**
 * Pre-fill the form from a proposal that is proposed again. `other` is the
 * other step where the proposal says it is one step of a move and that step
 * is at hand.
 *
 * From a move's first step the form names the whole move. From its second
 * step it is that step by itself: that is what is left once the first was
 * carried out, and naming the whole move there would do the first step a
 * second time (a move to another validator would unstake twice).
 */
export function formFromProposal(
	old: Proposal,
	other: Proposal | null,
): Partial<ActionForm> {
	const network = old.payload.network;
	const move = other && stepNumber(old) === 1 ? moveOf(old, other) : null;
	return move
		? formFromMove(move, network)
		: formFromAction(old.payload.action, network);
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
		case "action.removeAgent":
			return "removeAgent";
		case "action.abstraction":
			return "toMode";
		case "action.signers":
			return "signers";
		case "action.validator":
			return "validator";
		case "action.toValidator":
			return "toValidator";
		case "action.vaultAddress":
			return "vault";
		case "action":
		case "action.type":
			return "raw";
		case "payload.outerSigner":
			return "finaliser";
		default:
			return null;
	}
}
