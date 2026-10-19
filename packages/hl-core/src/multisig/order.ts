/**
 * Actions Hyperliquid carries out only in the order of their numbers.
 *
 * Measured on testnet (2026-10-11): fixtures/multisig/send-order.json, twelve
 * pairs through a multi-sig, and fixtures/multisig/nonce-order.json, the
 * order lab, 247 questions put to a plain account and to a multi-sig.
 *
 * Once an account has carried out a `usdSend`, a `usdSend` whose `time` is not
 * greater is refused with "Nonce already used.", whoever leads the envelope
 * and wherever it sends, and a bridge withdrawal (`withdraw3`) with such a
 * `time` is refused the same way. The mark is the highest `time` carried
 * out; a refused or failed attempt does not count; it belongs to the account
 * (a plain account behaves the same, and the mark survives becoming a
 * multi-sig and becoming a plain account again). Every other kind that could
 * be run was taken in any order: `sendAsset`, `spotSend`,
 * `usdClassTransfer`, approvals, staking, account settings, orders and the
 * other L1 kinds. Not measured: whether a withdrawal that goes through moves
 * the mark (no withdrawal is made in testing), and mainnet.
 *
 * For a treasury this means: two USDC sends can be pending together, but
 * carrying the newer one out first shuts the older one out for good. It has
 * to be proposed again. And a send dated ahead (the longer signing window)
 * shuts out, once it is carried out, every send dated before it.
 */
import { ORDERED_ACTION_TYPES, SHUT_OUT_BY } from "../rules/multisig.ts";

/** What places an action in its kind's order: the kind and its own number. */
export interface OrderMark {
	readonly kind: string;
	readonly time: number;
}

const whole = (v: unknown): number | null =>
	typeof v === "number" && Number.isSafeInteger(v)
		? v
		: typeof v === "bigint" && v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER)
			? Number(v)
			: null;

/** The kinds whose carried-out actions shut an action of `kind` out. */
const shutters = (kind: string): readonly string[] => SHUT_OUT_BY[kind] ?? [];

/** The mark of an ordered action; null for an action Hyperliquid takes in any order. */
export function orderMark(action: unknown): OrderMark | null {
	if (!action || typeof action !== "object" || Array.isArray(action))
		return null;
	const a = action as { type?: unknown; time?: unknown };
	if (typeof a.type !== "string" || !ORDERED_ACTION_TYPES.includes(a.type))
		return null;
	const time = whole(a.time);
	return time === null ? null : { kind: a.type, time };
}

/**
 * The carried-out action that shuts `action` out: of a kind that does (a send,
 * for a send or a withdrawal), with a number that is not smaller. The latest one when there are several;
 * null when `action` can still be carried out as far as `done` tells.
 *
 * `done` must not contain `action`'s own proposal: an action does not shut
 * itself out.
 */
export function overtakenBy<T extends { readonly action: unknown }>(
	action: unknown,
	done: readonly T[],
): T | null {
	const mine = orderMark(action);
	if (!mine) return null;
	let hit: T | null = null;
	let latest = -1;
	for (const d of done) {
		const m = orderMark(d.action);
		if (!m || !shutters(mine.kind).includes(m.kind) || m.time < mine.time)
			continue;
		if (m.time > latest) {
			hit = d;
			latest = m.time;
		}
	}
	return hit;
}

/**
 * Among `pending`, the ones that carrying out `action` now would shut out:
 * older actions of a kind it shuts out. Oldest first.
 */
export function wouldShutOut<T extends { readonly action: unknown }>(
	action: unknown,
	pending: readonly T[],
): T[] {
	const mine = orderMark(action);
	if (!mine) return [];
	return pending
		.map((p) => ({ p, m: orderMark(p.action) }))
		.filter(
			(x): x is { p: T; m: OrderMark } =>
				x.m !== null &&
				shutters(x.m.kind).includes(mine.kind) &&
				x.m.time < mine.time,
		)
		.sort((a, b) => a.m.time - b.m.time)
		.map((x) => x.p);
}

/**
 * The smallest number a new action of `type` should carry: one more than the
 * highest number among the ordered actions in `known`. Null when the kind is
 * taken in any order, or nothing ordered is known.
 *
 * Numbered this way, sends and withdrawals can always be carried out in the
 * order they were made. It deliberately counts every ordered kind, not only
 * the ones measured to shut `type` out: what a carried-out withdrawal does to
 * the mark is not known, and an ascending sequence is safe either way.
 *
 * A proposal's number is normally the time it is made, so this only matters
 * when an earlier one was dated ahead: a send made today must not be numbered
 * below a send dated tomorrow, or carrying that one out first shuts it out.
 */
export function orderFloor(
	type: string,
	known: readonly { readonly action: unknown }[],
): number | null {
	if (shutters(type).length === 0) return null;
	let top: number | null = null;
	for (const k of known) {
		const m = orderMark(k.action);
		if (m && (top === null || m.time > top)) top = m.time;
	}
	return top === null ? null : top + 1;
}
