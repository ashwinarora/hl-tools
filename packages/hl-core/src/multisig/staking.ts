/**
 * Staking, read off the measured table (rules/staking.ts;
 * fixtures/multisig/staking.json): what Hyperliquid reports about an
 * account's HYPE in staking and about validators, which actions bring about
 * a move, and what Hyperliquid would answer to them as things stand.
 *
 * HYPE amounts are decimal strings in their canonical form, as everywhere in
 * the account data; the actions carry them as integers with 8 decimals.
 * Parsers are total: a wrong shape gives null, a bad row is left out.
 */
import { Decimal } from "../decimal.ts";
import type { Network } from "../network.ts";
import {
	HYPE_WEI_DECIMALS,
	MAX_PENDING_RETURNS,
	RETURN_QUEUE,
	STAKE_LOCKUP,
} from "../rules/staking.ts";

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

// ------------------------------------------------------------------ actions

/**
 * A staking action, in HYPE.
 *   moveIn   spot to the staking balance        (`cDeposit`)
 *   stake    the staking balance to a validator (`tokenDelegate`)
 *   unstake  a validator to the staking balance (`tokenDelegate`, isUndelegate)
 *   return   the staking balance to spot        (`cWithdraw`)
 */
export type StakingAction =
	| { readonly kind: "moveIn"; readonly amount: string }
	| {
			readonly kind: "stake" | "unstake";
			readonly amount: string;
			readonly validator: string;
	  }
	| { readonly kind: "return"; readonly amount: string };

/** An action as posted, read as a staking action. Null for any other action, and for one whose amount or validator cannot be read. */
export function stakingActionOf(action: unknown): StakingAction | null {
	const a = record(action);
	const amount = weiToHype(a?.wei);
	if (!a || amount === null) return null;
	switch (a.type) {
		case "cDeposit":
			return { kind: "moveIn", amount };
		case "cWithdraw":
			return { kind: "return", amount };
		case "tokenDelegate": {
			const validator = addressOf(a.validator);
			return validator === null
				? null
				: {
						kind: a.isUndelegate === true ? "unstake" : "stake",
						amount,
						validator,
					};
		}
		default:
			return null;
	}
}

/**
 * The fields Hyperliquid takes for a staking action (the chain fields and
 * the number are the proposal's). Null when the amount cannot be carried
 * exactly.
 */
export function stakingFields(
	a: StakingAction,
): Record<string, unknown> | null {
	const wei = hypeToWei(a.amount);
	if (wei === null) return null;
	switch (a.kind) {
		case "moveIn":
			return { type: "cDeposit", wei };
		case "return":
			return { type: "cWithdraw", wei };
		default:
			return {
				type: "tokenDelegate",
				validator: a.validator,
				wei,
				isUndelegate: a.kind === "unstake",
			};
	}
}

// ------------------------------------------------------------------ a move

const dec = (v: string): Decimal => Decimal.parse(v);
/** `want` minus `have`, or null when nothing is missing. */
function missing(want: string, have: string): string | null {
	const short = dec(want).sub(dec(have));
	return short.isPositive() ? short.toString() : null;
}

/**
 * "This much staked with this validator": what the staking balance does not
 * already hold unstaked is moved in from spot first. One action or two.
 */
export function planStake(i: {
	readonly amount: string;
	readonly validator: string;
	/** In the staking balance and not staked. */
	readonly undelegated: string;
}): StakingAction[] {
	const short = missing(i.amount, i.undelegated);
	const stake: StakingAction = {
		kind: "stake",
		amount: i.amount,
		validator: i.validator,
	};
	return short === null ? [stake] : [{ kind: "moveIn", amount: short }, stake];
}

/**
 * "This much back in spot": what the staking balance does not already hold
 * unstaked is unstaked from `from` first. Null when something has to be
 * unstaked and no validator is named.
 */
export function planReturn(i: {
	readonly amount: string;
	readonly undelegated: string;
	readonly from: string | null;
}): StakingAction[] | null {
	const short = missing(i.amount, i.undelegated);
	const back: StakingAction = { kind: "return", amount: i.amount };
	if (short === null) return [back];
	return i.from === null
		? null
		: [{ kind: "unstake", amount: short, validator: i.from }, back];
}

/** "This much from one validator to another": unstake, then stake. */
export function planMove(i: {
	readonly amount: string;
	readonly from: string;
	readonly to: string;
}): StakingAction[] {
	return [
		{ kind: "unstake", amount: i.amount, validator: i.from },
		{ kind: "stake", amount: i.amount, validator: i.to },
	];
}

// ------------------------------------------------------------------ the judge

/**
 * What is known about an account's staking when an action is judged. A fact
 * that could not be read is null, and an unknown fact refuses nothing.
 */
export interface StakingFacts {
	/** Spot HYPE that is not on hold. */
	readonly spotAvailable: string | null;
	/** In the staking balance and not staked. */
	readonly undelegated: string | null;
	readonly delegations: readonly Delegation[] | null;
	/** How many returns are waiting. */
	readonly pendingReturns: number | null;
	/** Every validator's address. */
	readonly validators: readonly string[] | null;
}

/** A refusal Hyperliquid would give, by its id in the error catalogue. */
export type StakingRefusal =
	| "staking-deposit-funds"
	| "stake-balance"
	| "validator-unknown"
	| "unstake-lockup"
	| "unstake-balance"
	| "return-balance"
	| "return-queue-full";

const exceeds = (amount: string, have: string | null): boolean =>
	have !== null && dec(amount).gt(dec(have));

/**
 * The refusal this action would meet as things stand at `now`, or null.
 * Where two reasons hold at once, which of them Hyperliquid names was not
 * measured; the one named here comes first in the code below.
 */
export function stakingRefusal(
	action: StakingAction,
	facts: StakingFacts,
	now: number,
): StakingRefusal | null {
	switch (action.kind) {
		case "moveIn":
			return exceeds(action.amount, facts.spotAvailable)
				? "staking-deposit-funds"
				: null;
		case "stake":
			if (facts.validators && !facts.validators.includes(action.validator))
				return "validator-unknown";
			return exceeds(action.amount, facts.undelegated) ? "stake-balance" : null;
		case "unstake": {
			if (!facts.delegations) return null;
			const stake = facts.delegations.find(
				(d) => d.validator === action.validator,
			);
			if (stake && stake.lockedUntil > now) return "unstake-lockup";
			return exceeds(action.amount, stake?.amount ?? "0")
				? "unstake-balance"
				: null;
		}
		default:
			if (
				facts.pendingReturns !== null &&
				facts.pendingReturns >= MAX_PENDING_RETURNS
			)
				return "return-queue-full";
			return exceeds(action.amount, facts.undelegated)
				? "return-balance"
				: null;
	}
}

const plus = (have: string | null, amount: string): string | null =>
	have === null ? null : dec(have).add(dec(amount)).toString();
const minus = (have: string | null, amount: string): string | null =>
	have === null ? null : dec(have).sub(dec(amount)).toString();

/**
 * What stands after Hyperliquid has carried the action out at `now`. A stake
 * (a first one or an addition) locks everything staked with that validator
 * for the network's lockup; a stake removed completely leaves the list.
 */
export function afterStakingAction(
	facts: StakingFacts,
	action: StakingAction,
	now: number,
	network: Network,
): StakingFacts {
	switch (action.kind) {
		case "moveIn":
			return {
				...facts,
				spotAvailable: minus(facts.spotAvailable, action.amount),
				undelegated: plus(facts.undelegated, action.amount),
			};
		case "return":
			return {
				...facts,
				undelegated: minus(facts.undelegated, action.amount),
				pendingReturns:
					facts.pendingReturns === null ? null : facts.pendingReturns + 1,
			};
		default: {
			const staking = action.kind === "stake";
			const old = facts.delegations?.find(
				(d) => d.validator === action.validator,
			);
			const others = facts.delegations?.filter((d) => d !== old);
			const held = dec(old?.amount ?? "0");
			const amount = staking
				? held.add(dec(action.amount))
				: held.sub(dec(action.amount));
			return {
				...facts,
				undelegated: staking
					? minus(facts.undelegated, action.amount)
					: plus(facts.undelegated, action.amount),
				delegations: !others
					? null
					: !amount.isPositive()
						? others
						: [
								...others,
								{
									validator: action.validator,
									amount: amount.toString(),
									lockedUntil:
										staking || !old
											? now + STAKE_LOCKUP[network].ms
											: old.lockedUntil,
								},
							],
			};
		}
	}
}

/**
 * The first of these actions Hyperliquid would refuse when they are carried
 * out in order from `now`, each judged against what the ones before it leave
 * behind. Null when none would be.
 */
export function judgeStakingSteps(
	actions: readonly StakingAction[],
	facts: StakingFacts,
	now: number,
	network: Network,
): { readonly index: number; readonly refusal: StakingRefusal } | null {
	let state = facts;
	for (const [index, action] of actions.entries()) {
		const refusal = stakingRefusal(action, state, now);
		if (refusal) return { index, refusal };
		state = afterStakingAction(state, action, now, network);
	}
	return null;
}

/**
 * When the lockup of the stake an unstake takes from ends; null for any
 * other action and when the account has no stake with that validator. An
 * unstake can be signed before this and is refused if submitted before it.
 */
export function lockupOf(
	action: StakingAction,
	delegations: readonly Delegation[],
): number | null {
	return action.kind === "unstake"
		? (delegations.find((d) => d.validator === action.validator)?.lockedUntil ??
				null)
		: null;
}
