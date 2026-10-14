/**
 * Signing in to the relay with a wallet, and asking which wallet a session
 * speaks for. No React here: the provider, the integration tests and the lab
 * scripts all use these.
 */
import { type Address, type Issue, issue } from "@hl-tools/core";
import { isUnreachable, relayIssue } from "../model/relay/errors";
import { buildSignInMessage, signInOriginProblem } from "../model/relay/siwe";
import { forgetWallet, type Slots, slotKey } from "../model/relay/wallets";
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
	// Another wallet's session in this browser ends only from here on, with the
	// new wallet's signature in hand: a declined prompt leaves it as it was, and
	// so does a sign-in the relay refuses.
	const previous = await storedToken(client);
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
					? `The sharing service opened a session for ${seen}, not for the wallet that signed.`
					: "The sharing service opened a session but could not say which wallet it is for.",
				{ fix: "Sign in again." },
			),
		);
	}
	if (previous) await endReplaced(client, previous);
	return { ok: true, wallet: expected };
}

/** The access token of the session this client holds now, if any. */
async function storedToken(client: RelayClient): Promise<string | null> {
	try {
		const { data } = await client.auth.getSession();
		return data.session?.access_token ?? null;
	} catch {
		return null;
	}
}

/**
 * Ends, on the relay, the session a new sign-in has just replaced in this
 * browser (the client has already forgotten it), so its renewal token stops
 * working. Says nothing when the relay cannot be reached: that session can no
 * longer be used from here either way.
 */
async function endReplaced(client: RelayClient, token: string): Promise<void> {
	try {
		const { data } = await client.auth.getSession();
		if (data.session?.access_token === token) return;
		await client.auth.admin.signOut(token, "local");
	} catch {
		// nothing to do
	}
}

/**
 * Ends the session a client holds, on the relay and in the client's storage;
 * other devices stay signed in. When the relay cannot be reached the stored
 * session may be left behind: a caller that must be sure the browser holds
 * nothing any more uses `endSession`.
 */
export async function signOut(client: RelayClient): Promise<void> {
	try {
		await client.auth.signOut({ scope: "local" });
	} catch {
		// nothing more can be done from here
	}
}

/**
 * What a wallet's slot is worth right now. On top of `probeSession`: the
 * session in a slot must speak for the wallet the slot is named after. One
 * that speaks for another wallet (a slot that was tampered with, or filled
 * from a wrong hint) is ended and never used; a session the relay no longer
 * recognises leaves no slot behind.
 */
export async function probeFor(
	client: RelayClient,
	wallet: Address,
	slots: Slots,
): Promise<"ready" | "none" | "unreachable"> {
	const probe = await probeSession(client);
	if (probe.status === "unreachable") return "unreachable";
	if (probe.status === "ready" && probe.wallet === wallet) return "ready";
	if (probe.status === "ready") await signOut(client);
	forgetWallet(slots, wallet);
	return "none";
}

/**
 * Sign a wallet out of this browser. Its slot is emptied first, at once and
 * whatever the relay says, so that from this line on the browser holds
 * nothing that speaks for the wallet; the session is then ended on the relay
 * in the background (`end`), so its renewal token stops working there too.
 * Returns what became of the relay's side, for tests and logs.
 */
export function endSession(
	wallet: Address,
	slots: Slots,
	end: (raw: string) => Promise<"ended" | "gone" | "unreachable">,
): Promise<"ended" | "gone" | "unreachable" | "nothing"> {
	const raw = slots.getItem(slotKey(wallet));
	forgetWallet(slots, wallet);
	if (raw === null) return Promise.resolve("nothing");
	return end(raw).catch(() => "unreachable" as const);
}
