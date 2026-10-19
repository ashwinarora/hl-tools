import {
	ACTIVATION_FEE_USDC,
	Decimal,
	HYPE_WEI_DECIMALS,
	VAULT_MIN_DEPOSIT_USDC,
	VAULT_USD_DECIMALS,
	WITHDRAWAL_FEE_USDC,
} from "@hl-tools/core";
import type { Receiver } from "./actions";

/**
 * What a "Max" beside an amount fills in: the most Hyperliquid would take
 * now, worked out with exact decimal arithmetic from Hyperliquid's own
 * figures. A figure is only ever cut down to the decimals the action carries,
 * never rounded, and a fee comes off only where it is paid from the same
 * balance. The amount is fixed once the proposal is made; the check before
 * sending compares it again with what is there then.
 *
 * `ok` names the figure and, in one sentence, what it is; `none` says why
 * there is no figure yet.
 */
export type MaxAmount =
	| { readonly kind: "ok"; readonly amount: string; readonly basis: string }
	| { readonly kind: "none"; readonly reason: string };

/** A USDC send, a bridge withdrawal and a class transfer carry 6 decimals. */
export const USDC_SEND_DECIMALS = 6;

const FEE = Decimal.parse(ACTIVATION_FEE_USDC);
const BRIDGE_FEE = Decimal.parse(WITHDRAWAL_FEE_USDC);
const VAULT_MIN = Decimal.parse(VAULT_MIN_DEPOSIT_USDC);

const read = (v: string | null | undefined): Decimal | null =>
	v === null || v === undefined ? null : Decimal.tryParse(v);

/** Cut down to `decimals`: never more than there is. */
const cut = (d: Decimal, decimals: number): Decimal =>
	d.roundToDecimals(decimals, "floor");

const none = (reason: string): MaxAmount => ({ kind: "none", reason });

/**
 * The figure to fill, with a clause when cutting to the action's decimals
 * left a remainder behind (a spot balance can hold 8 decimals, a USDC send
 * carries 6).
 */
function filled(
	full: Decimal,
	decimals: number,
	basis: (amount: string) => string,
	unit: string,
	at = (d: Decimal) => d,
): MaxAmount {
	const whole = cut(full, decimals);
	const amount = at(whole);
	if (!amount.isPositive())
		return none(`There is nothing to move: ${full.toString()} ${unit}.`);
	const left = full.sub(whole);
	return {
		kind: "ok",
		amount: amount.toString(),
		basis: left.isPositive()
			? `${basis(amount.toString())} The last ${left.toString()} ${unit} stays: this action carries ${decimals} decimals.`
			: basis(amount.toString()),
	};
}

const NOT_READ = "The balance has not been read yet.";

/**
 * A guided USDC send. To an address in use it costs nothing, so Max is all of
 * the balance it leaves. To a new address Hyperliquid charges 1 USDC on top,
 * from spot when what is left there covers it, otherwise from perps (core
 * `activationCharge`): Max keeps the fee back only when no other balance
 * would pay it. Before the destination has been checked, the fee is not
 * known, so there is no Max yet.
 */
export function maxSendUsdc(i: {
	/** A unified treasury: one balance, reported as spot. */
	readonly unified: boolean;
	readonly from: "perps" | "spot";
	readonly perps: string | null;
	readonly spot: string | null;
	readonly receiver: Receiver["status"] | "loading" | null;
}): MaxAmount {
	if (i.receiver === null || i.receiver === "loading")
		return none(
			"Enter the destination first: a first send to a new address costs 1 USDC, and Max takes that into account.",
		);
	if (i.receiver !== "new" && i.receiver !== "active")
		return none(
			"Whether the 1 USDC fee for a new address applies to this destination cannot be told, so Max cannot work it out. Type the amount.",
		);
	const from = i.unified ? "spot" : i.from;
	const source = read(from === "perps" ? i.perps : i.spot);
	if (!source) return none(NOT_READ);
	const where = i.unified
		? "the treasury's balance"
		: from === "perps"
			? "the perps balance"
			: "spot";
	if (i.receiver === "active")
		return filled(
			source,
			USDC_SEND_DECIMALS,
			(a) => `All of ${where} that can move now: ${a} USDC.`,
			"USDC",
		);
	// new: the fee comes from spot if what is left there covers it, else perps
	if (i.unified)
		return filled(
			source,
			USDC_SEND_DECIMALS,
			(a) =>
				`All of the treasury's balance less the 1 USDC fee for a new address: ${a} USDC.`,
			"USDC",
			(d) => d.sub(FEE),
		);
	const other = read(from === "perps" ? i.spot : i.perps);
	if (!other) return none(NOT_READ);
	if (other.gte(FEE))
		return filled(
			source,
			USDC_SEND_DECIMALS,
			(a) =>
				`All of ${where}: ${a} USDC. The 1 USDC fee for a new address comes from ${from === "perps" ? "spot" : "the perps balance"}.`,
			"USDC",
		);
	return filled(
		source,
		USDC_SEND_DECIMALS,
		(a) =>
			`All of ${where} less the 1 USDC fee for a new address, which nothing else can pay: ${a} USDC.`,
		"USDC",
		(d) => d.sub(FEE),
	);
}

/**
 * A spot token send: all of the token that is not on hold, cut to the
 * token's own decimals. A fee for a new address is paid in USDC, apart.
 */
export function maxSendToken(i: {
	readonly coin: string;
	readonly available: string | null;
	/** The token's `weiDecimals`; null when the token list is not read. */
	readonly decimals: number | null;
}): MaxAmount {
	const available = read(i.available);
	if (!available || i.decimals === null) return none(NOT_READ);
	return filled(
		available,
		i.decimals,
		(a) => `All the ${i.coin} in spot that is not on hold: ${a} ${i.coin}.`,
		i.coin,
	);
}

/** A move between the treasury's own perps and spot: no fee. */
export function maxClassTransfer(i: {
	readonly toPerp: boolean;
	readonly perps: string | null;
	readonly spot: string | null;
}): MaxAmount {
	const source = read(i.toPerp ? i.spot : i.perps);
	if (!source) return none(NOT_READ);
	return filled(
		source,
		USDC_SEND_DECIMALS,
		(a) =>
			`All the ${i.toPerp ? "spot USDC that is not on hold" : "perps balance can release"}: ${a} USDC.`,
		"USDC",
	);
}

/**
 * A bridge withdrawal: all of the balance it leaves (perps, or a unified
 * treasury's one balance). The bridge keeps its 1 USDC out of the amount, so
 * nothing comes off; a withdrawal of 1 USDC or less is refused.
 */
export function maxWithdrawal(i: {
	readonly unified: boolean;
	readonly perps: string | null;
	readonly spot: string | null;
}): MaxAmount {
	const source = read(i.unified ? i.spot : i.perps);
	if (!source) return none(NOT_READ);
	if (cut(source, USDC_SEND_DECIMALS).lte(BRIDGE_FEE))
		return none(
			`There is ${source.toString()} USDC to withdraw, and a withdrawal has to be more than the 1 USDC the bridge keeps.`,
		);
	return filled(
		source,
		USDC_SEND_DECIMALS,
		(a) =>
			`All of ${i.unified ? "the treasury's balance" : "the perps balance"}: ${a} USDC. The bridge keeps 1 USDC of it, so ${Decimal.parse(a).sub(BRIDGE_FEE).toString()} USDC arrives.`,
		"USDC",
	);
}

/**
 * A vault deposit: what the perps balance (a unified treasury's one balance)
 * can release, in one proposal. More can be typed: the form then moves the
 * rest from spot first.
 */
export function maxVaultDeposit(i: {
	readonly unified: boolean;
	readonly perps: string | null;
}): MaxAmount {
	const source = read(i.perps);
	if (!source) return none(NOT_READ);
	if (cut(source, VAULT_USD_DECIMALS).lt(VAULT_MIN))
		return none(
			`${i.unified ? "The treasury's balance" : "The perps balance"} can release ${source.toString()} USDC, and a vault deposit is at least ${VAULT_MIN_DEPOSIT_USDC} USDC. Type a larger amount to move the rest from spot first.`,
		);
	return filled(
		source,
		VAULT_USD_DECIMALS,
		(a) =>
			`All ${i.unified ? "the treasury's balance" : "the perps balance"} can release: ${a} USDC.`,
		"USDC",
	);
}

/**
 * A vault withdrawal: exactly what Hyperliquid says it releases now
 * (`maxWithdrawable`, already cut down by Hyperliquid), never the deposit's
 * worth, which can be above it. Its worth moves until the proposal is sent.
 */
export function maxVaultWithdrawal(i: {
	readonly maxWithdrawable: string | null;
}): MaxAmount {
	const max = read(i.maxWithdrawable);
	if (!max)
		return none(
			"What Hyperliquid releases from this vault has not been read yet.",
		);
	return filled(
		max,
		VAULT_USD_DECIMALS,
		(a) =>
			`What Hyperliquid said it releases from this vault at the page's last read: ${a} USDC. Its worth moves until this is sent; if it is lower then, Hyperliquid would refuse it, and the page says so before sending.`,
		"USDC",
	);
}

/** Staking: what each of the three forms can take, in HYPE (8 decimals). */
export function maxStaking(i: {
	readonly kind: "stake" | "returnToSpot" | "moveStake";
	/** Spot HYPE not on hold. */
	readonly spot: string | null;
	/** In the staking balance and not staked. */
	readonly undelegated: string | null;
	readonly delegations:
		| readonly { readonly validator: string; readonly amount: string }[]
		| null;
	/** The validator the form unstakes from, as typed or chosen; "" when none. */
	readonly from: string;
}): MaxAmount & { readonly validator?: string } {
	const undelegated = read(i.undelegated);
	if (!undelegated) return none(NOT_READ);
	const hype = (d: Decimal) => d.toString();
	if (i.kind === "stake") {
		const spot = read(i.spot);
		if (!spot) return none(NOT_READ);
		return filled(
			spot.add(undelegated),
			HYPE_WEI_DECIMALS,
			(a) =>
				`All the HYPE that can be staked: ${a} HYPE (${hype(spot)} in spot, ${hype(undelegated)} in the staking balance).`,
			"HYPE",
		);
	}
	if (!i.delegations) return none(NOT_READ);
	const staked = (validator: string) =>
		read(
			i.delegations?.find((d) => d.validator === validator.toLowerCase())
				?.amount,
		);
	if (i.kind === "moveStake") {
		if (!i.from.trim())
			return none("Choose the validator to move the HYPE from first.");
		const held = staked(i.from);
		if (!held)
			return none("The treasury has nothing staked with that validator.");
		return filled(
			held,
			HYPE_WEI_DECIMALS,
			(a) => `All the HYPE staked with this validator: ${a} HYPE.`,
			"HYPE",
		);
	}
	// back to spot: the staking balance, and the stake of one validator
	const chosen = i.from.trim()
		? i.from.trim().toLowerCase()
		: i.delegations.length === 1
			? (i.delegations[0]?.validator ?? "")
			: "";
	const held = chosen ? staked(chosen) : null;
	if (!held) {
		if (i.delegations.length > 1 && !undelegated.isPositive())
			return none(
				"HYPE is staked with several validators. Type the amount and choose which one to take it from.",
			);
		return filled(
			undelegated,
			HYPE_WEI_DECIMALS,
			(a) =>
				i.delegations?.length
					? `What the staking balance holds unstaked: ${a} HYPE. To bring back staked HYPE too, type the amount and choose its validator.`
					: `What the staking balance holds: ${a} HYPE.`,
			"HYPE",
		);
	}
	const out = filled(
		undelegated.add(held),
		HYPE_WEI_DECIMALS,
		(a) =>
			`All of it: ${a} HYPE (${hype(held)} staked with this validator, ${hype(undelegated)} already unstaked).`,
		"HYPE",
	);
	return out.kind === "ok" ? { ...out, validator: chosen } : out;
}

/** Everything the forms know that a Max can draw on. */
export interface MaxFacts {
	/** The account mode was read: which balance a send or a deposit leaves depends on it. */
	readonly modeKnown: boolean;
	readonly unified: boolean;
	/** What perps can release now; null while not read. */
	readonly perps: string | null;
	/** Spot USDC not on hold; null while not read. */
	readonly spotUsdc: string | null;
	/** The balance a USDC send leaves, as the form resolved it. */
	readonly from: "perps" | "spot";
	readonly receiver: Receiver["status"] | "loading" | null;
	/** The spot token a token send names; null when none is chosen. */
	readonly token: {
		readonly coin: string;
		readonly available: string | null;
		readonly decimals: number | null;
	} | null;
	/** What Hyperliquid releases from the vault the form names; null while not read. */
	readonly maxWithdrawable: string | null;
	readonly staking: {
		readonly spot: string | null;
		readonly undelegated: string | null;
		readonly delegations:
			| readonly { readonly validator: string; readonly amount: string }[]
			| null;
	};
}

/**
 * The Max of the form's own amount field, by its kind; null for a kind with
 * no amount. A staking return may also name the validator it takes from.
 */
export function maxFor(
	form: {
		readonly kind: string;
		readonly toPerp: "perp" | "spot";
		readonly validator: string;
	},
	facts: MaxFacts,
): (MaxAmount & { readonly validator?: string }) | null {
	const leaves = ["sendUsdc", "withdraw3", "vaultDeposit"].includes(form.kind);
	if (leaves && !facts.modeKnown)
		return none(
			"The treasury's account mode has not been read yet, and which balance this leaves depends on it.",
		);
	switch (form.kind) {
		case "sendUsdc":
			return maxSendUsdc({
				unified: facts.unified,
				from: facts.from,
				perps: facts.perps,
				spot: facts.spotUsdc,
				receiver: facts.receiver,
			});
		case "sendToken":
			return facts.token
				? maxSendToken(facts.token)
				: none("Choose the token first.");
		case "usdClassTransfer":
			return maxClassTransfer({
				toPerp: form.toPerp === "perp",
				perps: facts.perps,
				spot: facts.spotUsdc,
			});
		case "withdraw3":
			return maxWithdrawal({
				unified: facts.unified,
				perps: facts.perps,
				spot: facts.spotUsdc,
			});
		case "vaultDeposit":
			return maxVaultDeposit({
				unified: facts.unified,
				// a unified treasury deposits from its one balance
				perps: facts.unified ? facts.spotUsdc : facts.perps,
			});
		case "vaultWithdraw":
			return maxVaultWithdrawal({ maxWithdrawable: facts.maxWithdrawable });
		case "stake":
		case "returnToSpot":
		case "moveStake":
			return maxStaking({
				kind: form.kind,
				...facts.staking,
				from: form.validator,
			});
		default:
			return null;
	}
}
