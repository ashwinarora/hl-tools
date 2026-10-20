/**
 * The one place the Supabase client is loaded (src/lib/boundaries.test.ts
 * holds everything else to that). It is imported on demand, in the browser,
 * the first time somebody signs in or returns with a stored session; a
 * visitor who only uses links and files never downloads it.
 *
 * There is one client per wallet, never one client whose session is swapped:
 * a client keeps its session in its wallet's own slot, so a request made
 * through it cannot leave under another wallet's name.
 */
import type { Address } from "@hl-tools/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnreachable, saysSessionEnded } from "../model/relay/errors";
import type { Slots } from "../model/relay/wallets";
import { type RelayConfig, relayAuthOptions } from "./config";

export type RelayClient = SupabaseClient;

const clients = new Map<Address, Promise<RelayClient>>();

type Ended = (wallet: Address) => void;
const endedListeners = new Set<Ended>();

/**
 * Hear when the relay says a wallet's session has ended (a request made as
 * that wallet came back `relay.session_ended`). Returns the way to stop.
 */
export function onSessionEnded(listener: Ended): () => void {
	endedListeners.add(listener);
	return () => {
		endedListeners.delete(listener);
	};
}

/**
 * How long one request to the relay may take. One that has not answered by
 * then fails as a request that got no answer (the data client asks a read
 * again a few times by itself), so no page waits on the relay for ever.
 */
export const RELAY_TIMEOUT_MS = 10_000;

/** The caller's signal, if any, ended also by the time limit. */
function limited(init: RequestInit | undefined, ms: number): AbortSignal {
	const limit = AbortSignal.timeout(ms);
	const own = init?.signal;
	if (!own) return limit;
	if (typeof AbortSignal.any === "function")
		return AbortSignal.any([own, limit]);
	// a browser without `AbortSignal.any` (Safari before 17.4, Firefox before
	// 124): one signal that whichever ends first ends, never the caller's alone
	const both = new AbortController();
	for (const s of [own, limit]) {
		if (s.aborted) {
			both.abort(s.reason);
			break;
		}
		s.addEventListener("abort", () => both.abort(s.reason), { once: true });
	}
	return both.signal;
}

/**
 * `fetch` for one wallet's client: the answer is handed on untouched, and when
 * it is the relay's "this session has ended" the listeners are told whose. A
 * request over the time limit fails like one the network dropped, which is
 * how the page knows the relay as unreachable.
 */
export function watchFetch(
	wallet: Address,
	base: typeof fetch = (input, init) => fetch(input, init),
	timeoutMs = RELAY_TIMEOUT_MS,
): typeof fetch {
	return async (input, init) => {
		const signal = limited(init, timeoutMs);
		let res: Response;
		try {
			res = await base(input, { ...init, signal });
		} catch (e) {
			// the limit, not the caller: said the way a dropped connection is said
			if (signal.aborted && !init?.signal?.aborted)
				throw new TypeError(
					`Failed to fetch: the hl-tools server did not answer within ${timeoutMs / 1000} s`,
				);
			throw e;
		}
		if (res.status === 401) {
			try {
				const body: unknown = await res.clone().json();
				if (saysSessionEnded(res.status, body))
					for (const listener of [...endedListeners]) listener(wallet);
			} catch {
				// not the relay's answer: nothing to tell
			}
		}
		return res;
	};
}

/** The client for one wallet: made once, the same one on every later call. */
export function getRelayClient(
	config: RelayConfig,
	wallet: Address,
): Promise<RelayClient> {
	const key = wallet.toLowerCase() as Address;
	let made = clients.get(key);
	if (!made) {
		made = import("@supabase/supabase-js").then(({ createClient }) =>
			createClient(config.url, config.key, {
				// the very store the slots are read from, so the two cannot disagree
				auth: relayAuthOptions(key, browserSlots() ?? undefined),
				global: { fetch: watchFetch(key) },
			}),
		);
		clients.set(key, made);
		// a download that failed is tried again the next time, not remembered
		made.catch(() => {
			if (clients.get(key) === made) clients.delete(key);
		});
	}
	return made;
}

let memory: Slots | null = null;

/** Slots that last as long as the page: for a browser that refuses `localStorage`. */
function memorySlots(): Slots {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		key: (i) => [...map.keys()][i] ?? null,
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k),
	};
}

/**
 * Where the slots are kept: the browser's `localStorage`, or the page's
 * memory when the browser refuses it (signing in then lasts until the page
 * is closed). Null on the server.
 */
export function browserSlots(): Slots | null {
	if (typeof window === "undefined") return null;
	try {
		const store = window.localStorage;
		// some browsers hand the object out and refuse every use of it
		store.getItem("hl-tools.relay-used");
		return store;
	} catch {
		memory ??= memorySlots();
		return memory;
	}
}

let ending = 0;

/**
 * End, on the relay, a session whose slot has already been emptied. The
 * stored session is handed in as it was read; it is used through a client
 * that keeps nothing in the browser, so a renewal on the way cannot put the
 * session back into its slot.
 *
 * - "ended": the relay has ended it; its renewal token no longer works.
 * - "gone": the relay no longer knew it.
 * - "unreachable": the relay did not answer. Nothing in this browser can use
 *   the session any more, but the relay still holds it until it lapses.
 */
export async function endStoredSession(
	config: RelayConfig,
	raw: string,
): Promise<"ended" | "gone" | "unreachable"> {
	let tokens: { access_token?: unknown; refresh_token?: unknown } | null;
	try {
		tokens = JSON.parse(raw) as typeof tokens;
	} catch {
		return "gone";
	}
	const access = tokens?.access_token;
	const refresh = tokens?.refresh_token;
	if (typeof access !== "string" || typeof refresh !== "string") return "gone";
	try {
		const { createClient } = await import("@supabase/supabase-js");
		const once = createClient(config.url, config.key, {
			auth: {
				persistSession: false,
				autoRefreshToken: false,
				detectSessionInUrl: false,
				// its own name, so it is never taken for a wallet's client
				storageKey: `hl-tools.relay-ending.${++ending}`,
			},
		});
		// renews the session first when its access token has run out
		const held = await once.auth.setSession({
			access_token: access,
			refresh_token: refresh,
		});
		if (held.error) return isUnreachable(held.error) ? "unreachable" : "gone";
		const out = await once.auth.signOut({ scope: "local" });
		return out.error && isUnreachable(out.error) ? "unreachable" : "ended";
	} catch (e) {
		return isUnreachable(e) ? "unreachable" : "gone";
	}
}
