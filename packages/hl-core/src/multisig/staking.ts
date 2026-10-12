/**
 * Staking, read off the measured table (rules/staking.ts;
 * fixtures/multisig/staking.json): what Hyperliquid reports about an
 * account's HYPE in staking and about validators.
 *
 * HYPE amounts are decimal strings in their canonical form, as everywhere in
 * the account data; the actions carry them as integers with 8 decimals.
 * Parsers are total: a wrong shape gives null, a bad row is left out.
 */
import { Decimal } from "../decimal.ts";
import type { Network } from "../network.ts";
import { HYPE_WEI_DECIMALS, RETURN_QUEUE } from "../rules/staking.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;

const record = (v: unknown): Record<string, unknown> | null =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
/** A plain non-negative decimal, in its canonical form. */
function amountOf(v: unknown): string | null {
	const d = typeof v === "string" ? Decimal.tryParse(v) : null;
	return d && !d.isNegative() ? d.toString() : null;
}
const addressOf = (v: unknown): string | null =>
	typeof v === "string" && ADDRESS.test(v.toLowerCase())
		? v.toLowerCase()
		: null;
const timeOf = (v: unknown): number | null =>
	typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

// ------------------------------------------------------------------ amounts

/** The integer an action carries, as HYPE: 100000000 is "1". Null for anything that is not a whole, non-negative number. */
export function weiToHype(wei: unknown): string | null {
	const ok =
		typeof wei === "bigint"
			? wei >= 0n
			: typeof wei === "number"
				? Number.isSafeInteger(wei) && wei >= 0
				: typeof wei === "string" && /^\d+$/.test(wei);
	return ok
		? Decimal.fromScaled(
				wei as bigint | number | string,
				HYPE_WEI_DECIMALS,
			).toString()
		: null;
}

/**
 * HYPE as the integer an action carries: a number while it is exact, a
 * bigint beyond that. Null when the amount is not a plain decimal with at
 * most 8 decimals, or is negative. Never rounds.
 */
export function hypeToWei(amount: string): number | bigint | null {
	const d = Decimal.tryParse(amount);
	if (!d || d.isNegative() || d.decimalPlaces() > HYPE_WEI_DECIMALS)
		return null;
	const wei = d.toScaledBigInt(HYPE_WEI_DECIMALS);
	return wei <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(wei) : wei;
}

// ------------------------------------------------------- an account's staking

/** `delegatorSummary`: the staking balance of an account. */
export interface StakingSummary {
	/** Staked with validators, in all. */
	readonly delegated: string;
	/** In the staking balance and not staked. */
	readonly undelegated: string;
	/** On its way back to spot, in all. */
	readonly pendingTotal: string;
	/** How many returns are waiting. */
	readonly pendingReturns: number;
}

export function parseDelegatorSummary(raw: unknown): StakingSummary | null {
	const r = record(raw);
	const delegated = amountOf(r?.delegated);
	const undelegated = amountOf(r?.undelegated);
	const pendingTotal = amountOf(r?.totalPendingWithdrawal);
	const pendingReturns = timeOf(r?.nPendingWithdrawals);
	return delegated === null ||
		undelegated === null ||
		pendingTotal === null ||
		pendingReturns === null
		? null
		: { delegated, undelegated, pendingTotal, pendingReturns };
}

/** One stake: what an account has with one validator. */
export interface Delegation {
	readonly validator: string;
	readonly amount: string;
	/** Unix ms. The stake cannot be removed, in part or whole, before this. */
	readonly lockedUntil: number;
}

/** `delegations`: an account's stakes, largest first. */
export function parseDelegations(raw: unknown): Delegation[] | null {
	if (!Array.isArray(raw)) return null;
	const out: Delegation[] = [];
	for (const row of raw) {
		const r = record(row);
		const validator = addressOf(r?.validator);
		const amount = amountOf(r?.amount);
		const lockedUntil = timeOf(r?.lockedUntilTimestamp);
		if (validator !== null && amount !== null && lockedUntil !== null)
			out.push({ validator, amount, lockedUntil });
	}
	return out.sort(
		(a, b) =>
			Decimal.parse(b.amount).cmp(Decimal.parse(a.amount)) ||
			(a.validator < b.validator ? -1 : 1),
	);
}

/**
 * moveIn          spot to the staking balance (`cDeposit`)
 * stake, unstake  with a validator (`tokenDelegate`)
 * returnStarted   the staking balance to spot (`cWithdraw`): it now waits
 * returnLanded    Hyperliquid's own step when the wait is over; no signature
 */
export type StakingEventKind =
	| "moveIn"
	| "stake"
	| "unstake"
	| "returnStarted"
	| "returnLanded";

/** One row of `delegatorHistory`. */
export interface StakingEvent {
	readonly time: number;
	/** The transaction; all zeros for Hyperliquid's own step. */
	readonly hash: string;
	readonly kind: StakingEventKind;
	readonly amount: string;
	readonly validator: string | null;
}

function eventOf(
	delta: Record<string, unknown>,
): Pick<StakingEvent, "kind" | "amount" | "validator"> | null {
	const moved = record(delta.cDeposit);
	const staked = record(delta.delegate);
	const returned = record(delta.withdrawal);
	if (moved) {
		const amount = amountOf(moved.amount);
		return amount === null ? null : { kind: "moveIn", amount, validator: null };
	}
	if (staked) {
		const amount = amountOf(staked.amount);
		const validator = addressOf(staked.validator);
		return amount === null || validator === null
			? null
			: {
					kind: staked.isUndelegate === true ? "unstake" : "stake",
					amount,
					validator,
				};
	}
	if (returned) {
		const amount = amountOf(returned.amount);
		const kind =
			returned.phase === "initiated"
				? "returnStarted"
				: returned.phase === "finalized"
					? "returnLanded"
					: null;
		return amount === null || kind === null
			? null
			: { kind, amount, validator: null };
	}
	return null;
}

/** `delegatorHistory`: every staking step of an account, newest first. */
export function parseDelegatorHistory(raw: unknown): StakingEvent[] | null {
	if (!Array.isArray(raw)) return null;
	const out: StakingEvent[] = [];
	for (const row of raw) {
		const r = record(row);
		const time = timeOf(r?.time);
		const delta = record(r?.delta);
		const what = delta ? eventOf(delta) : null;
		if (time !== null && typeof r?.hash === "string" && what)
			out.push({ time, hash: r.hash.toLowerCase(), ...what });
	}
	return out.sort((a, b) => b.time - a.time);
}

/** A return on its way back to spot. */
export interface PendingReturn {
	readonly amount: string;
	readonly startedAt: number;
	/** `startedAt` plus the length of the network's queue. */
	readonly landsAt: number;
}

/**
 * The returns that are waiting, the one that lands first first. Hyperliquid
 * says how many wait and their total; when each lands follows from when it
 * was started, and those are the newest starts in the history (the queue has
 * one length, so the first in is the first out). Null when the history does
 * not account for what the summary says, so no time is made up.
 */
export function pendingReturns(
	summary: StakingSummary,
	events: readonly StakingEvent[],
	network: Network,
): PendingReturn[] | null {
	const starts = events
		.filter((e) => e.kind === "returnStarted")
		.sort((a, b) => b.time - a.time)
		.slice(0, summary.pendingReturns);
	const total = starts.reduce(
		(sum, e) => sum.add(Decimal.parse(e.amount)),
		Decimal.ZERO,
	);
	if (
		starts.length !== summary.pendingReturns ||
		!total.eq(Decimal.parse(summary.pendingTotal))
	)
		return null;
	return starts
		.map((e) => ({
			amount: e.amount,
			startedAt: e.time,
			landsAt: e.time + RETURN_QUEUE[network].ms,
		}))
		.reverse();
}

// ------------------------------------------------------------------ validators

/** What Hyperliquid measured over one window. */
export interface ValidatorWindow {
	/** A fraction: "0.9996" is 99.96 %. */
	readonly uptime: string | null;
	/** A staker's yearly rate after the validator's commission, as a fraction. */
	readonly expectedRate: string | null;
}

/** One row of `validatorSummaries`. Name and description are the validator's own words. */
export interface Validator {
	readonly address: string;
	readonly name: string;
	readonly description: string;
	/** All HYPE staked with it, by everyone. */
	readonly stake: string;
	/** In the working set: the validators that produce blocks and are paid. */
	readonly isActive: boolean;
	/** Voted out by the others for not responding; pays nothing until it is back. */
	readonly isJailed: boolean;
	/** The share of the rewards it keeps, as a fraction; "1" keeps everything. */
	readonly commission: string | null;
	readonly day: ValidatorWindow | null;
	readonly week: ValidatorWindow | null;
	readonly month: ValidatorWindow | null;
}

function windowOf(
	stats: unknown,
	name: "day" | "week" | "month",
): ValidatorWindow | null {
	const found = Array.isArray(stats)
		? stats.find((s) => Array.isArray(s) && s[0] === name)
		: null;
	const w = record(found?.[1]);
	return w
		? {
				uptime: amountOf(w.uptimeFraction),
				expectedRate: amountOf(w.predictedApr),
			}
		: null;
}

/** `validatorSummaries`: every validator, the most staked first. */
export function parseValidators(raw: unknown): Validator[] | null {
	if (!Array.isArray(raw)) return null;
	const out: Validator[] = [];
	for (const row of raw) {
		const r = record(row);
		const address = addressOf(r?.validator);
		const stake = weiToHype(r?.stake);
		if (!r || address === null || stake === null) continue;
		out.push({
			address,
			name: typeof r.name === "string" ? r.name : "",
			description: typeof r.description === "string" ? r.description : "",
			stake,
			isActive: r.isActive === true,
			isJailed: r.isJailed === true,
			commission: amountOf(r.commission),
			day: windowOf(r.stats, "day"),
			week: windowOf(r.stats, "week"),
			month: windowOf(r.stats, "month"),
		});
	}
	return out.sort(
		(a, b) =>
			Decimal.parse(b.stake).cmp(Decimal.parse(a.stake)) ||
			(a.address < b.address ? -1 : 1),
	);
}

/** Hyperliquid's estimate of a staker's yearly rate, over the longest window it gives. */
export function expectedRate(v: Validator): string | null {
	return (
		v.month?.expectedRate ?? v.week?.expectedRate ?? v.day?.expectedRate ?? null
	);
}

/**
 * jailed     voted out for not responding
 * outside    not in the working set (too little stake to be one of them)
 * keeps-all  its commission is everything
 * no-rate    none of those, yet Hyperliquid's own estimate is zero
 */
export type NoPay = "jailed" | "outside" | "keeps-all" | "no-rate";

/**
 * Whether a stake with this validator earns anything as things stand, and if
 * not, why. Hyperliquid accepts a stake either way.
 */
export function validatorPays(
	v: Validator,
): { readonly pays: true } | { readonly pays: false; readonly why: NoPay } {
	const rate = expectedRate(v);
	const why: NoPay | null = v.isJailed
		? "jailed"
		: !v.isActive
			? "outside"
			: v.commission !== null && Decimal.parse(v.commission).gte(Decimal.ONE)
				? "keeps-all"
				: rate !== null && Decimal.parse(rate).isZero()
					? "no-rate"
					: null;
	return why ? { pays: false, why } : { pays: true };
}
