/**
 * Moments in messages, from numbers this module did not make.
 *
 * A nonce, an expiry or a `time` field arrives in a pasted body, a link, a
 * file or an answer from the chain. A date holds only ±8.64e15 ms, which is
 * less than the largest integer a document may carry, and `toISOString`
 * throws beyond it. Nothing that reads a document may throw, so every such
 * number is written through `isoTime`.
 */

/** The largest moment a date can hold. A nonce or an expiry beyond it is no time at all. */
export const MAX_TIME_MS = 8_640_000_000_000_000;

/** Whether a number is a moment a date can hold. */
export function isMoment(ms: unknown): ms is number {
	return (
		typeof ms === "number" && Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_MS
	);
}

/** A moment as ISO text; a number that is no moment as the number itself. Never throws. */
export function isoTime(ms: unknown): string {
	return isMoment(ms) ? new Date(ms).toISOString() : `${String(ms)} (no date)`;
}
