/**
 * What happens when an account sends money, read off the measured tables
 * (rules/transfers.ts; fixtures/multisig/send-modes.json and
 * activation-fee.json): which actions the sender's mode allows, which of the
 * receiver's balances the money lands in, and what a send to an address
 * never used costs and whom.
 */
import { Decimal } from "../decimal.ts";
import {
	ACCOUNT_MODES,
	ACTIVATION_FEE_USDC,
	type AccountModeName,
	COLLATERAL_TOKEN,
	MODE_KINDS,
	type ModeKind,
	PERPS_DEX,
	SPOT_DEX,
	UNIFIED_DISABLED_ACTIONS,
} from "../rules/transfers.ts";

export interface AccountMode {
	/** As `userAbstraction` answered. */
	readonly raw: string;
	/** `unknown`: a value this version has no rule for. */
	readonly kind: ModeKind | "unknown";
	/** False when the kind is taken from the docs and was not measured. */
	readonly verified: boolean;
}

/** Read a `userAbstraction` answer. Never throws. */
export function accountMode(raw: unknown): AccountMode {
	const name = typeof raw === "string" ? raw : "";
	const known = (ACCOUNT_MODES as readonly string[]).includes(name)
		? MODE_KINDS[name as AccountModeName]
		: null;
	return known
		? { raw: name, kind: known.kind, verified: known.verified }
		: { raw: name, kind: "unknown", verified: false };
}

/** One of an account's balances. `dex` is a perp dex other than the first. */
export type Pocket = "perps" | "spot" | { readonly dex: string };

export interface SendShape {
	readonly type: string;
	readonly from: Pocket;
	readonly to: Pocket;
	/** The token's name, without its id. */
	readonly token: string;
	/** Null for a move between the account's own balances. */
	readonly destination: string | null;
	/** Null when the action's amount is not a plain decimal. */
	readonly amount: Decimal | null;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
/** `USDC:0x6d1e…` → `USDC`. */
const tokenName = (v: unknown): string => text(v).replace(/:.*$/s, "");
const pocketOf = (dex: string): Pocket =>
	dex === PERPS_DEX ? "perps" : dex === SPOT_DEX ? "spot" : { dex };

/**
 * Where an action takes money from and where it puts it. Null for anything
 * that does not move money between balances of Hyperliquid accounts (a bridge
 * withdrawal included).
 */
export function sendShape(action: unknown): SendShape | null {
	if (!action || typeof action !== "object" || Array.isArray(action))
		return null;
	const a = action as Record<string, unknown>;
	const amount = Decimal.tryParse(text(a.amount));
	switch (a.type) {
		case "usdSend":
			return {
				type: "usdSend",
				from: "perps",
				to: "perps",
				token: COLLATERAL_TOKEN,
				destination: text(a.destination).toLowerCase(),
				amount,
			};
		case "spotSend":
			return {
				type: "spotSend",
				from: "spot",
				to: "spot",
				token: tokenName(a.token),
				destination: text(a.destination).toLowerCase(),
				amount,
			};
		case "sendAsset":
			return {
				type: "sendAsset",
				from: pocketOf(text(a.sourceDex)),
				to: pocketOf(text(a.destinationDex)),
				token: tokenName(a.token),
				destination: text(a.destination).toLowerCase(),
				amount,
			};
		case "usdClassTransfer":
			return {
				type: "usdClassTransfer",
				from: a.toPerp === true ? "spot" : "perps",
				to: a.toPerp === true ? "perps" : "spot",
				token: COLLATERAL_TOKEN,
				destination: null,
				amount,
			};
		default:
			return null;
	}
}

/** A refusal Hyperliquid would give, by its id in the error catalogue. */
export type SendRefusal =
	| "unified-disabled"
	| "unified-spot-only"
	| "token-invalid"
	| "self-transfer"
	| "send-invalid";

const samePocket = (a: Pocket, b: Pocket): boolean =>
	typeof a === "string" || typeof b === "string" ? a === b : a.dex === b.dex;

/**
 * The refusal this action meets because of the sender's mode, of what it
 * moves where, or (when `self`, the sending account, is given) of sending to
 * itself; null when none stands in its way (balances are another matter: see
 * `activationCharge`).
 */
export function sendRefusal(
	sender: AccountMode,
	action: unknown,
	self?: string,
): SendRefusal | null {
	const shape = sendShape(action);
	if (!shape) return null;
	if (sender.kind === "unified") {
		if (UNIFIED_DISABLED_ACTIONS.includes(shape.type))
			return "unified-disabled";
		if (shape.from !== "spot") return "unified-spot-only";
	}
	// only the collateral moves into or out of the first perp dex
	if (
		shape.token !== COLLATERAL_TOKEN &&
		(shape.from === "perps" || shape.to === "perps")
	)
		return "token-invalid";
	// to itself: the two older sends never, sendAsset only into another balance
	if (self && shape.destination === self.toLowerCase()) {
		if (shape.type !== "sendAsset") return "self-transfer";
		if (samePocket(shape.from, shape.to)) return "send-invalid";
	}
	return null;
}

/**
 * Which of the receiver's balances the money arrives in: the pocket the
 * action names, or `balance` for a unified receiver, which has only one.
 * Null for an action that sends nothing.
 */
export function landsIn(
	receiver: AccountMode,
	action: unknown,
): Pocket | "balance" | null {
	const shape = sendShape(action);
	if (!shape) return null;
	if (receiver.kind === "unified" && typeof shape.to === "string")
		return "balance";
	return shape.to;
}

export interface ActivationCharge {
	/** USDC charged for the address being new: "0" or "1". */
	readonly fee: string;
	/**
	 * amount  taken out of what was sent (`usdSend`): the receiver gets less
	 * spot    charged on top, to the sender's spot USDC
	 * perps   charged on top, to the sender's perps balance
	 * unknown charged on top, to a balance that could not be told (a balance was not given)
	 */
	readonly paidFrom: "amount" | "spot" | "perps" | "unknown" | null;
	/** What arrives, in the token sent. Null when the amount could not be read. */
	readonly receiverGets: Decimal | null;
	/**
	 * transfer-below-fee  a `usdSend` no larger than the fee
	 * transfer-gas        neither balance can pay the fee
	 */
	readonly refusal: "transfer-below-fee" | "transfer-gas" | null;
}

const FEE = Decimal.parse(ACTIVATION_FEE_USDC);
const ZERO = Decimal.parse("0");

/**
 * What sending to this receiver costs beyond the amount.
 *
 * To an address in use: nothing. To an address never used, Hyperliquid
 * charges 1 USDC once. A `usdSend` pays it out of the amount (the receiver
 * gets the amount minus 1, and an amount of 1 or less is refused). A
 * `spotSend` or `sendAsset` pays it on top: from the sender's spot USDC when
 * what is left there after the send covers it, otherwise from the perps
 * balance; when neither can, the send is refused. A unified sender has one
 * balance, reported as spot.
 *
 * `spotUsdc` and `perpsUsdc` are what the sender can move (spot total minus
 * hold; perps withdrawable); null when not known.
 */
export function activationCharge(input: {
	readonly action: unknown;
	readonly receiverNew: boolean;
	readonly spotUsdc: string | null;
	readonly perpsUsdc: string | null;
}): ActivationCharge {
	const shape = sendShape(input.action);
	const amount = shape?.amount ?? null;
	if (!shape || shape.destination === null || !input.receiverNew)
		return { fee: "0", paidFrom: null, receiverGets: amount, refusal: null };
	if (shape.type === "usdSend") {
		const enough = amount?.gt(FEE) ?? null;
		return {
			fee: ACTIVATION_FEE_USDC,
			paidFrom: "amount",
			receiverGets: amount && enough ? amount.sub(FEE) : null,
			refusal: enough === false ? "transfer-below-fee" : null,
		};
	}
	const charge = (
		paidFrom: ActivationCharge["paidFrom"],
		refusal: ActivationCharge["refusal"] = null,
	): ActivationCharge => ({
		fee: ACTIVATION_FEE_USDC,
		paidFrom,
		receiverGets: amount,
		refusal,
	});
	const spot =
		input.spotUsdc === null ? null : Decimal.tryParse(input.spotUsdc);
	const perps =
		input.perpsUsdc === null ? null : Decimal.tryParse(input.perpsUsdc);
	if (!spot || !perps || amount === null) return charge("unknown");
	// what the send itself takes from each USDC balance
	const usdc = shape.token === COLLATERAL_TOKEN;
	const fromSpot = usdc && shape.from === "spot" ? amount : ZERO;
	const fromPerps = usdc && shape.from === "perps" ? amount : ZERO;
	if (spot.sub(fromSpot).gte(FEE)) return charge("spot");
	if (perps.sub(fromPerps).gte(FEE)) return charge("perps");
	return charge(null, "transfer-gas");
}
