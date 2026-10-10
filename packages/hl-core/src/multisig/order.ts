/**
 * Actions Hyperliquid carries out only in the order of their numbers.
 *
 * Measured on testnet (2026-10-11, fixtures/multisig/send-order.json): once
 * an account has carried out a `usdSend`, a `usdSend` whose `time` is not
 * greater is refused with "Nonce already used.", whoever leads the envelope
 * and wherever it sends. A refused or failed attempt does not count. The
 * other kinds the signer proposes (`usdClassTransfer`, `spotSend`,
 * `approveAgent`) were tried the same way and are taken in any order;
 * `withdraw3` and `sendAsset` were not tried.
 *
 * For a treasury this means: two USDC sends can be pending together, but
 * carrying the newer one out first shuts the older one out for good. It has
 * to be proposed again.
 */
import { ORDERED_ACTION_TYPES } from "../rules/multisig.ts";

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
 * The carried-out action that shuts `action` out: of the same ordered kind,
 * with a number that is not smaller. The latest one when there are several;
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
		if (!m || m.kind !== mine.kind || m.time < mine.time) continue;
		if (m.time > latest) {
			hit = d;
			latest = m.time;
		}
	}
	return hit;
}

/**
 * Among `pending`, the ones that carrying out `action` now would shut out:
 * older actions of the same ordered kind. Oldest first.
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
				x.m !== null && x.m.kind === mine.kind && x.m.time < mine.time,
		)
		.sort((a, b) => a.m.time - b.m.time)
		.map((x) => x.p);
}
