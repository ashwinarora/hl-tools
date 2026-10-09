/**
 * The Sign in with Ethereum message (EIP-4361) the wallet is asked to sign.
 * Supabase Auth verifies the signature and checks the domain and URI against
 * the site it is configured for; it has no nonce store, so the message is
 * given a short life instead.
 */
import { createSiweMessage } from "viem/siwe";

export const SIGN_IN_STATEMENT =
	"Sign in to hl-tools Multisig. This only proves you control this wallet: it cannot move funds or approve anything.";

/** How long a signed message may be used to sign in. */
export const SIGN_IN_VALID_MS = 5 * 60_000;

export interface SignInMessageInput {
	readonly address: `0x${string}`;
	/** The chain the wallet is on; any chain is accepted, it is not acted on. */
	readonly chainId: number;
	/** `location.origin` of the page. */
	readonly origin: string;
	/** At least 8 letters or digits (`generateSiweNonce`). */
	readonly nonce: string;
	readonly now: number;
}

/**
 * Supabase accepts `localhost` or a real domain as the message domain, never
 * an IP address. Returns what to tell the user when the page's origin cannot
 * sign in; null when it can.
 */
export function signInOriginProblem(origin: string): string | null {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return "This page has no usable address to sign in from.";
	}
	const host = url.hostname;
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
		const port = url.port ? `:${url.port}` : "";
		return `Sign-in needs a named address. Open this page as ${url.protocol}//localhost${port} instead of ${url.host}.`;
	}
	if (host !== "localhost" && url.protocol !== "https:") {
		return "Sign-in needs https on this address.";
	}
	return null;
}

export function buildSignInMessage(i: SignInMessageInput): string {
	const url = new URL(i.origin);
	return createSiweMessage({
		address: i.address,
		chainId: i.chainId,
		domain: url.host,
		// exactly the origin: Supabase matches the URI against its allowed URLs
		uri: url.origin,
		nonce: i.nonce,
		version: "1",
		statement: SIGN_IN_STATEMENT,
		issuedAt: new Date(i.now),
		expirationTime: new Date(i.now + SIGN_IN_VALID_MS),
	});
}
