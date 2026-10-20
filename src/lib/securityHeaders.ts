/**
 * The headers every page of the site is sent with.
 *
 * The policy's real work is on scripts: only the site's own files and the few
 * inline scripts the server writes with this response's nonce may run, so
 * text that reached a page can never run as code. Connections stay open to
 * any https and wss host on purpose: the RPC probe and the WebSocket
 * workbench talk to whatever endpoint a developer gives them, and a page's
 * policy holds for the whole visit (moving between sections never reloads the
 * page), so a narrower list for the Multisig section alone would protect
 * little and break those tools after a click.
 *
 * Pure: the nonce in, the headers out.
 */

/** A fresh nonce for one response: 16 random bytes, base64. */
export function makeNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

/**
 * The origins a build is configured to reach besides any https or wss host:
 * the hl-tools server's (and its live channel's) and the signing network's.
 * In production they are https and already allowed; a local build reaches
 * them over plain http and ws, which the policy names exactly so.
 */
export function configuredOrigins(
	urls: readonly (string | undefined)[],
): string[] {
	const out = new Set<string>();
	for (const raw of urls) {
		if (!raw) continue;
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			continue;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") continue;
		out.add(url.origin);
		out.add(url.origin.replace(/^http/, "ws"));
	}
	return [...out];
}

/** The Content-Security-Policy for a page written with `nonce`. */
export function contentSecurityPolicy(
	nonce: string,
	origins: readonly string[] = [],
): string {
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}'`,
		// React and the wallet windows set inline styles; a style cannot run code
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		// the fonts are bundled; a wallet window's web font falls back to the system's
		"font-src 'self' data:",
		["connect-src 'self' https: wss:", ...origins].join(" "),
		// the faucet miner's WalletConnect checks the site in a frame of its own
		"frame-src https://verify.walletconnect.com https://verify.walletconnect.org",
		"worker-src 'self' blob:",
		"manifest-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");
}

/**
 * Every response's headers. `csp` is false in development, where Vite's own
 * inline scripts and hot reload need what the policy forbids.
 */
export function securityHeaders(opts: {
	nonce: string;
	csp: boolean;
	html: boolean;
	origins?: readonly string[];
}): Record<string, string> {
	return {
		...(opts.csp
			? {
					"content-security-policy": contentSecurityPolicy(
						opts.nonce,
						opts.origins,
					),
				}
			: {}),
		"strict-transport-security": "max-age=31536000; includeSubDomains",
		"x-frame-options": "DENY",
		"x-content-type-options": "nosniff",
		"referrer-policy": "strict-origin-when-cross-origin",
		"permissions-policy":
			"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
		// a page carries its own nonce: never kept by a shared cache, always asked again
		...(opts.html ? { "cache-control": "private, no-cache" } : {}),
	};
}
