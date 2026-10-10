/**
 * Signing in to the relay with a wallet, and asking which wallet a session
 * speaks for. No React here: the provider, the integration tests and the lab
 * scripts all use these.
 */
import { type Address, type Issue, issue } from "@hl-tools/core";
import { isUnreachable, relayIssue } from "../model/relay/errors";
import { buildSignInMessage, signInOriginProblem } from "../model/relay/siwe";
import { describeWalletError } from "../model/walletErrors";
import type { RelayClient } from "./client";

export interface SignInWallet {
	readonly address: `0x${string}`;
	readonly chainId: number;
	/** `personal_sign` over the message; the wallet shows it to the user. */
	signMessage(message: string): Promise<`0x${string}`>;
}

export type SignInResult =
	| { readonly ok: true; readonly wallet: Address }
	| { readonly ok: false; readonly issue: Issue; readonly cancelled: boolean };

export interface SignInDeps {
	/** `location.origin`. */
	readonly origin: string;
	readonly nonce: string;
	readonly now?: number;
}

const WALLETS = new WeakMap<object, Map<string, Address | null>>();

/**
 * The wallet the client's current session speaks for, as the relay sees it
 * (never read from the token). Asked once per signed-in user and remembered.
 * Null when there is no session or the relay does not answer.
 */
export async function sessionWallet(
	client: RelayClient,
): Promise<Address | null> {
	try {
		const { data } = await client.auth.getSession();
		const user = data.session?.user.id;
		if (!user) return null;
		let known = WALLETS.get(client);
		if (!known) {
			known = new Map();
			WALLETS.set(client, known);
		}
		if (known.has(user)) return known.get(user) ?? null;
		const { data: wallet, error } = await client.rpc("whoami");
		if (error) return null;
		const address =
			typeof wallet === "string" && /^0x[0-9a-f]{40}$/.test(wallet)
				? (wallet as Address)
				: null;
		known.set(user, address);
		return address;
	} catch {
		return null;
	}
}

export type SessionProbe =
	| { readonly status: "ready"; readonly wallet: Address }
	/** No session, or one the relay no longer recognises (it is cleared). */
	| { readonly status: "none" }
	/** There is a stored session but the relay did not answer; nothing is cleared. */
	| { readonly status: "unreachable" };

/**
 * What a stored session is worth right now: asked once when the section
 * opens with a session left in the browser.
 */
export async function probeSession(client: RelayClient): Promise<SessionProbe> {
	try {
		const { data, error } = await client.auth.getSession();
		if (error) {
			return isUnreachable(error)
				? { status: "unreachable" }
				: { status: "none" };
		}
		if (!data.session) return { status: "none" };
		const { data: wallet, error: refused } = await client.rpc("whoami");
		if (refused) {
			if (isUnreachable(refused)) return { status: "unreachable" };
			await signOut(client);
			return { status: "none" };
		}
		if (typeof wallet === "string" && /^0x[0-9a-f]{40}$/.test(wallet)) {
			let known = WALLETS.get(client);
			if (!known) {
				known = new Map();
				WALLETS.set(client, known);
			}
			known.set(data.session.user.id, wallet as Address);
			return { status: "ready", wallet: wallet as Address };
		}
		// a session that speaks for no wallet is of no use here
		await signOut(client);
		return { status: "none" };
	} catch (e) {
		return isUnreachable(e) ? { status: "unreachable" } : { status: "none" };
	}
}

export async function signIn(
	client: RelayClient,
	wallet: SignInWallet,
	deps: SignInDeps,
): Promise<SignInResult> {
	const fail = (i: Issue, cancelled = false): SignInResult => ({
		ok: false,
		issue: i,
		cancelled,
	});
	const problem = signInOriginProblem(deps.origin);
	if (problem) return fail(issue("relay.signin_origin", "error", problem));

	const message = buildSignInMessage({
		address: wallet.address,
		chainId: wallet.chainId,
		origin: deps.origin,
		nonce: deps.nonce,
		now: deps.now ?? Date.now(),
	});
	let signature: `0x${string}`;
	try {
		signature = await wallet.signMessage(message);
	} catch (e) {
		const w = describeWalletError(e);
		return fail(
			issue("relay.signin_wallet", "warning", w.message),
			w.kind === "rejected",
		);
	}
	try {
		const { error } = await client.auth.signInWithWeb3({
			chain: "ethereum",
			message,
			signature,
		});
		if (error) return fail(relayIssue(error));
	} catch (e) {
		return fail(relayIssue(e));
	}
	// the relay's own answer to "who am I" must be the wallet that just signed
	const expected = wallet.address.toLowerCase() as Address;
	const seen = await sessionWallet(client);
	if (seen !== expected) {
		await signOut(client);
		return fail(
			issue(
				"relay.signin_mismatch",
				"error",
				seen
					? `The relay opened a session for ${seen}, not for the wallet that signed.`
					: "The relay opened a session but could not say which wallet it is for.",
				{ fix: "Sign in again." },
			),
		);
	}
	return { ok: true, wallet: expected };
}

/** Ends the session in this browser only; other devices stay signed in. */
export async function signOut(client: RelayClient): Promise<void> {
	try {
		await client.auth.signOut({ scope: "local" });
	} catch {
		// the stored session is cleared even when the relay cannot be reached
	}
}
