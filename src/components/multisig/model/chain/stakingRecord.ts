/**
 * Whether a staking step has already been carried out, read from
 * Hyperliquid's own list of an account's staking steps.
 *
 * Staking a balance, unstaking it and starting a return leave no row in the
 * ledger (only moving HYPE in does), so the ledger cannot say that such a
 * proposal was carried out. If the finaliser's page lost Hyperliquid's answer
 * (a closed tab, a dropped connection), the proposal would still read as
 * waiting, a second submission would be answered "duplicate nonce", and the
 * natural next step, proposing it again, would stake twice. The staking
 * history closes that gap: every step is in it, with its transaction.
 *
 * As with the ledger (match.ts) the transaction decides: the explorer gives
 * the action as it was signed, and that either is this proposal's action or
 * is not. Where the explorer does not answer, one step that agrees in kind,
 * amount, validator and time is called likely, never certain; several are
 * not told apart at all.
 */
import {
	Decimal,
	type PlainObject,
	type StakingAction,
	type StakingEvent,
	stakingActionOf,
} from "@hl-tools/core";
import {
	LANDS_AFTER_NONCE_MS,
	LANDS_BEFORE_NONCE_MS,
	type Lookup,
} from "./match";

const KIND: Readonly<Record<StakingAction["kind"], StakingEvent["kind"]>> = {
	moveIn: "moveIn",
	stake: "stake",
	unstake: "unstake",
	return: "returnStarted",
};
const ZERO_HASH = /^0x0+$/;

/**
 * How far before the moment a proposal says it was made a step may lie and
 * still be its own: the proposer's clock and Hyperliquid's are not the same
 * clock. Two minutes; a step made earlier than that was made before the
 * proposal existed and is somebody else's.
 */
export const MADE_BEFORE_SLACK_MS = 2 * 60_000;

const sameStep = (a: StakingAction, b: StakingAction): boolean =>
	a.kind === b.kind &&
	Decimal.parse(a.amount).eq(Decimal.parse(b.amount)) &&
	("validator" in a ? a.validator : null) ===
		("validator" in b ? b.validator : null);

/**
 * The steps in the history that agree with the action in everything the
 * history shows, and lie where an action with this number can have landed.
 * Newest first. Empty for an action that is no staking step.
 *
 * `madeAt` is when the proposal says it was made. A step from before that
 * cannot be the proposal's, however alike: an earlier stake of the same
 * amount with the same validator is the common case, and without this bound
 * a brand-new proposal would be told it "may be carried out already" whenever
 * the explorer cannot say whose that earlier step was. Null when the document
 * does not say: then only the number bounds it.
 */
export function stakingCandidates(
	action: PlainObject,
	nonce: number,
	events: readonly StakingEvent[],
	madeAt: number | null = null,
): StakingEvent[] {
	const step = stakingActionOf(action);
	if (!step) return [];
	const validator = "validator" in step ? step.validator : null;
	const earliest = Math.max(
		nonce - LANDS_BEFORE_NONCE_MS,
		madeAt === null ? Number.NEGATIVE_INFINITY : madeAt - MADE_BEFORE_SLACK_MS,
	);
	return events
		.filter(
			(e) =>
				e.kind === KIND[step.kind] &&
				e.validator === validator &&
				Decimal.parse(e.amount).eq(Decimal.parse(step.amount)) &&
				e.time >= earliest &&
				e.time <= nonce + LANDS_AFTER_NONCE_MS &&
				!ZERO_HASH.test(e.hash),
		)
		.sort((a, b) => b.time - a.time);
}

/**
 * unread     the history was not read: nothing is known
 * none       it was read, and no step in it can be this proposal's
 * checking   a step like it is there; its transaction is being looked up
 * matched    that transaction is this proposal's action: it was carried out
 * likely     one step like it, and the explorer did not say whose it is
 * unchecked  several like it, and the explorer did not say which
 */
export type StepRecord =
	| { readonly kind: "unread" | "none" | "checking" | "unchecked" }
	| {
			readonly kind: "matched" | "likely";
			readonly hash: string;
			readonly time: number;
	  };

export function stepRecord(i: {
	readonly action: PlainObject;
	readonly nonce: number;
	/** The treasury: a transaction of another account is nobody's here. */
	readonly account: string;
	readonly events: readonly StakingEvent[] | null;
	readonly lookups: ReadonlyMap<string, Lookup>;
	/** When the proposal says it was made (`stakingCandidates`); null when it does not. */
	readonly madeAt?: number | null;
}): StepRecord {
	if (!i.events) return { kind: "unread" };
	const step = stakingActionOf(i.action);
	const open: StakingEvent[] = [];
	let pending = false;
	for (const e of stakingCandidates(
		i.action,
		i.nonce,
		i.events,
		i.madeAt ?? null,
	)) {
		const lookup = i.lookups.get(e.hash);
		if (!lookup || lookup.state === "pending") {
			pending = true;
			continue;
		}
		if (lookup.state !== "found") {
			open.push(e);
			continue;
		}
		const { tx } = lookup;
		const signed = stakingActionOf(tx.action);
		// a transaction the explorer shows in a form this cannot read decides nothing
		if (!signed || !step) {
			open.push(e);
			continue;
		}
		const ours =
			tx.user.toLowerCase() === i.account.toLowerCase() &&
			tx.error === null &&
			sameStep(signed, step) &&
			(tx.action as PlainObject).nonce === i.action.nonce;
		if (ours) return { kind: "matched", hash: e.hash, time: e.time };
		// the same step under another number: another proposal's, or made elsewhere
	}
	if (pending) return { kind: "checking" };
	const [only] = open;
	if (!only) return { kind: "none" };
	return open.length === 1
		? { kind: "likely", hash: only.hash, time: only.time }
		: { kind: "unchecked" };
}
