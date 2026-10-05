/**
 * Explicit, opt-in sharing. Content goes into the URL *fragment* (`#share=…`),
 * which browsers never send to servers or in Referer headers. Nothing is ever
 * written to the URL without the user clicking Share and confirming the
 * content is public.
 */

const PREFIX = "share=";

function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
	const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
	return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export interface SharePayload {
	readonly v: 1;
	readonly tool: string;
	readonly state: Record<string, unknown>;
}

export function buildShareUrl(
	tool: string,
	state: Record<string, unknown>,
): string {
	const payload: SharePayload = { v: 1, tool, state };
	const url = new URL(window.location.href);
	url.search = "";
	url.hash = PREFIX + toBase64Url(JSON.stringify(payload));
	return url.toString();
}

/** Read (without keeping) shared state for `tool` from the current fragment. */
export function readShared(tool: string): Record<string, unknown> | null {
	if (typeof window === "undefined") return null;
	const hash = window.location.hash.slice(1);
	if (!hash.startsWith(PREFIX)) return null;
	try {
		const payload = JSON.parse(
			fromBase64Url(hash.slice(PREFIX.length)),
		) as SharePayload;
		if (
			payload.v !== 1 ||
			payload.tool !== tool ||
			typeof payload.state !== "object"
		)
			return null;
		return payload.state;
	} catch {
		return null;
	}
}

/** Drop the fragment once its content is loaded into the page. */
export function clearShared(): void {
	if (
		typeof window === "undefined" ||
		!window.location.hash.startsWith(`#${PREFIX}`)
	)
		return;
	history.replaceState(
		history.state,
		"",
		window.location.pathname + window.location.search,
	);
}
