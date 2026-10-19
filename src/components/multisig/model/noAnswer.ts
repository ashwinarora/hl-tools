/**
 * A request to Hyperliquid that got no answer (the network dropped it, the
 * browser blocked it, it ran out of time) is said as that, in plain words:
 * never as the error class the browser or a library put on it ("TypeError:
 * Failed to fetch", "Unknown HTTP request error"). An answer that was an
 * error is passed on with Hyperliquid's own words.
 */

const NO_ANSWER =
	/failed to fetch|fetch failed|networkerror|load failed|network request failed|unknown http request error|timed? ?out/i;

/** Whether `e` is a request that got no answer, rather than an answer. */
export function gotNoAnswer(e: unknown): boolean {
	if (!e || typeof e !== "object") return false;
	const o = e as { name?: unknown; message?: unknown; cause?: unknown };
	if (o.name === "AbortError" || o.name === "TimeoutError") return true;
	const message = typeof o.message === "string" ? o.message : "";
	if (NO_ANSWER.test(message)) return true;
	// a library's error around the browser's
	return o.cause !== undefined && o.cause !== e && gotNoAnswer(o.cause);
}

/** "Hyperliquid did not answer when asked for the signer list." or what it answered instead. */
export function askedFor(what: string, e: unknown): string {
	if (gotNoAnswer(e))
		return `Hyperliquid did not answer when asked for ${what}.`;
	const said = e instanceof Error ? e.message : String(e);
	return `Hyperliquid answered with an error when asked for ${what}: ${said}`;
}
