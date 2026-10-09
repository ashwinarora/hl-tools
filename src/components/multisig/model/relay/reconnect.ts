/**
 * The relay not answering is usually brief: a restart, a dropped connection, a
 * laptop waking up. The page asks again by itself, a little later each time,
 * so nobody has to find the "Try again" button. It never gives up: one small
 * request a minute costs nothing, and the alternative is a page that stays
 * wrong until it is reloaded.
 */
export const RECONNECT_FIRST_MS = 5_000;
export const RECONNECT_MAX_MS = 60_000;

/** How long to wait before the next try, after `failed` tries in a row got no answer. */
export function reconnectDelay(failed: number): number {
	const n = Number.isFinite(failed) ? Math.max(0, Math.floor(failed)) : 0;
	// past a handful of doublings the cap applies; avoid 2 ** n overflowing first
	if (n >= 8) return RECONNECT_MAX_MS;
	return Math.min(RECONNECT_MAX_MS, RECONNECT_FIRST_MS * 2 ** n);
}
