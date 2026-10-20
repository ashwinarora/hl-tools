import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	forgetWallet,
	type Slots,
	slotKey,
	storedWallets,
} from "../model/relay/wallets";
import type { RelayClient } from "./client";
import { endSession, probeFor, type SignInWallet, signIn } from "./session";

const ORIGIN = "http://localhost:3000";
const NEW = "0x00000000000000000000000000000000000000b2" as const;
const OLD = "0x00000000000000000000000000000000000000a1" as const;

interface Held {
	readonly access_token: string;
	readonly user: { readonly id: string };
	readonly wallet: string;
}

/** As much of the Supabase client as signing in touches, with one session slot like a browser's. */
function relay(o: {
	held?: Held;
	refuses?: boolean;
	opensFor?: string;
	/** "Who am I" answers this HTTP error after the sign-in. */
	whoamiFails?: number;
}) {
	let held: Held | null = o.held ?? null;
	const ended: string[] = [];
	const client = {
		auth: {
			getSession: async () => ({ data: { session: held }, error: null }),
			signInWithWeb3: async () => {
				if (o.refuses)
					return {
						data: { session: null },
						error: Object.assign(new Error("Signature is not valid"), {
							status: 400,
						}),
					};
				held = {
					access_token: "token-new",
					user: { id: "user-new" },
					wallet: o.opensFor ?? NEW,
				};
				return { data: { session: held }, error: null };
			},
			signOut: async () => {
				held = null;
				return { error: null };
			},
			admin: {
				signOut: async (token: string) => {
					ended.push(token);
					return { data: null, error: null };
				},
			},
		},
		rpc: async () =>
			o.whoamiFails
				? { data: null, error: { message: "outage" }, status: o.whoamiFails }
				: { data: held?.wallet ?? null, error: null, status: 200 },
	};
	return {
		client: client as unknown as RelayClient,
		ended,
		held: () => held,
	};
}

const old: Held = {
	access_token: "token-old",
	user: { id: "user-old" },
	wallet: OLD,
};

const wallet = (signMessage: SignInWallet["signMessage"]): SignInWallet => ({
	address: NEW,
	chainId: 998,
	signMessage,
});
const signs = wallet(async () => "0x01");
const declines = wallet(async () => {
	throw Object.assign(new Error("User rejected the request."), { code: 4001 });
});
const deps = { origin: ORIGIN, nonce: "abcdefgh12345678" };

describe("signing in while another wallet is signed in (audit F-002)", () => {
	it("leaves that session alone when the wallet prompt is declined", async () => {
		const r = relay({ held: old });
		const out = await signIn(r.client, declines, deps);
		expect(out).toMatchObject({ ok: false, cancelled: true });
		expect(r.held()).toBe(old);
		expect(r.ended).toEqual([]);
	});

	it("leaves it alone when the relay refuses the new sign-in", async () => {
		const r = relay({ held: old, refuses: true });
		const out = await signIn(r.client, signs, deps);
		expect(out).toMatchObject({ ok: false, cancelled: false });
		expect(r.held()).toBe(old);
		expect(r.ended).toEqual([]);
	});

	it("replaces it once the new wallet is signed in, and ends it on the relay", async () => {
		const r = relay({ held: old });
		const out = await signIn(r.client, signs, deps);
		expect(out).toEqual({ ok: true, wallet: NEW });
		expect(r.held()?.access_token).toBe("token-new");
		expect(r.ended).toEqual(["token-old"]);
	});

	it("says an outage right after signing in as one, and keeps the new session to look at again (decision D7)", async () => {
		const r = relay({ whoamiFails: 503 });
		const out = await signIn(r.client, signs, deps);
		expect(out.ok).toBe(false);
		expect(out.ok ? null : out.issue.code).toBe("relay.unreachable");
		expect(r.held()?.access_token).toBe("token-new");
	});

	it("ends nothing when nobody was signed in", async () => {
		const r = relay({});
		expect(await signIn(r.client, signs, deps)).toEqual({
			ok: true,
			wallet: NEW,
		});
		expect(r.ended).toEqual([]);
	});

	it("keeps no session the relay opened for another wallet than the one that signed", async () => {
		const r = relay({ opensFor: OLD });
		const out = await signIn(r.client, signs, deps);
		expect(out).toMatchObject({
			ok: false,
			issue: { code: "relay.signin_mismatch" },
		});
		expect(r.held()).toBeNull();
	});

	it("does not ask the wallet from an address the relay cannot sign in from", async () => {
		const r = relay({ held: old });
		let asked = false;
		const out = await signIn(
			r.client,
			wallet(async () => {
				asked = true;
				return "0x01";
			}),
			{ ...deps, origin: "http://127.0.0.1:3000" },
		);
		expect(out).toMatchObject({
			ok: false,
			issue: { code: "relay.signin_origin" },
		});
		expect(asked).toBe(false);
		expect(r.held()).toBe(old);
	});
});

/** The same two wallets, as the addresses the slots are named after. */
const N = NEW as unknown as Address;
const O = OLD as unknown as Address;

/** A stand-in for `localStorage`. */
function browser(init: Record<string, string> = {}): Slots & {
	readonly map: Map<string, string>;
} {
	const map = new Map(Object.entries(init));
	return {
		map,
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
 * A client whose stored session the relay answers for as told: `speaksFor`
 * is the relay's own answer to "who am I", `down` a relay that does not answer.
 */
function probed(o: {
	held?: boolean;
	speaksFor?: string | null;
	down?: boolean;
	/** "Who am I" answered with an error and this HTTP status. */
	whoamiFails?: number;
}) {
	let signedOut = 0;
	const client = {
		auth: {
			getSession: async () =>
				o.down
					? {
							data: { session: null },
							error: Object.assign(new Error("Failed to fetch"), {
								name: "AuthRetryableFetchError",
							}),
						}
					: {
							data: {
								session:
									o.held === false
										? null
										: { access_token: "t", user: { id: "u" } },
							},
							error: null,
						},
			signOut: async () => {
				signedOut++;
				return { error: null };
			},
		},
		rpc: async () =>
			o.whoamiFails
				? {
						data: null,
						// what postgrest-js hands back for any answer that is not 2xx
						error: { message: "injected outage" },
						status: o.whoamiFails,
					}
				: { data: o.speaksFor ?? null, error: null, status: 200 },
	};
	return {
		client: client as unknown as RelayClient,
		signedOut: () => signedOut,
	};
}

describe("what a wallet's slot is worth", () => {
	it("is used when the relay says the session speaks for that very wallet", async () => {
		const slots = browser({ [slotKey(N)]: "session" });
		const c = probed({ speaksFor: N });
		expect(await probeFor(c.client, N, slots)).toBe("ready");
		expect(storedWallets(slots)).toEqual([N]);
		expect(c.signedOut()).toBe(0);
	});

	it("is never used for a session that speaks for another wallet: it is ended and the slot emptied", async () => {
		// a slot that was tampered with, or filled from a wrong hint
		const slots = browser({ [slotKey(N)]: "session of O" });
		const c = probed({ speaksFor: O });
		expect(await probeFor(c.client, N, slots)).toBe("none");
		expect(storedWallets(slots)).toEqual([]);
		expect(c.signedOut()).toBe(1);
	});

	it("leaves no slot behind for a session the relay no longer knows", async () => {
		const slots = browser({ [slotKey(N)]: "stale", [slotKey(O)]: "x" });
		expect(await probeFor(probed({ held: false }).client, N, slots)).toBe(
			"none",
		);
		// the other wallet's slot is not touched
		expect(storedWallets(slots)).toEqual([O]);
		// a session that speaks for no wallet at all is of no use either
		const mute = browser({ [slotKey(N)]: "x" });
		expect(await probeFor(probed({ speaksFor: null }).client, N, mute)).toBe(
			"ended",
		);
		expect(storedWallets(mute)).toEqual([]);
	});

	it('keeps the session through an outage: a 5xx or a 429 is not "signed out" (decision D7, audit F-064)', async () => {
		for (const status of [500, 502, 503, 504, 520, 429, 404]) {
			const slots = browser({ [slotKey(N)]: "session" });
			const c = probed({ whoamiFails: status });
			expect(await probeFor(c.client, N, slots)).toBe("unreachable");
			expect(storedWallets(slots)).toEqual([N]);
			expect(c.signedOut()).toBe(0);
		}
	});

	it("ends it only when the relay refuses the session itself, and says so", async () => {
		const slots = browser({ [slotKey(N)]: "session" });
		const c = probed({ whoamiFails: 401 });
		expect(await probeFor(c.client, N, slots)).toBe("ended");
		expect(storedWallets(slots)).toEqual([]);
		expect(c.signedOut()).toBe(1);
	});

	it("discards nothing while the relay does not answer", async () => {
		const slots = browser({ [slotKey(N)]: "session" });
		const c = probed({ down: true });
		expect(await probeFor(c.client, N, slots)).toBe("unreachable");
		expect(storedWallets(slots)).toEqual([N]);
		expect(c.signedOut()).toBe(0);
	});
});

describe("signing a wallet out of this browser", () => {
	it("empties its slot before the relay is even asked, and hands the session on to be ended there", async () => {
		const slots = browser({
			[slotKey(N)]: "raw-new",
			[slotKey(O)]: "raw-old",
		});
		let seenAtEnd: string[] | null = null;
		let handed: string | null = null;
		const done = endSession(N, slots, async (raw) => {
			handed = raw;
			// by the time the relay is asked, the browser already holds nothing for it
			seenAtEnd = storedWallets(slots);
			return "ended";
		});
		// synchronously: gone, whatever happens next
		expect(storedWallets(slots)).toEqual([O]);
		expect(await done).toBe("ended");
		expect(handed).toBe("raw-new");
		expect(seenAtEnd).toEqual([O]);
	});

	it("is just as gone when the relay cannot be reached or the attempt throws", async () => {
		for (const end of [
			async () => "unreachable" as const,
			async () => {
				throw new Error("Failed to fetch");
			},
		]) {
			const slots = browser({ [slotKey(N)]: "raw" });
			expect(await endSession(N, slots, end)).toBe("unreachable");
			expect(storedWallets(slots)).toEqual([]);
		}
	});

	it("asks the relay nothing for a wallet that has no slot", async () => {
		const slots = browser({ [slotKey(O)]: "raw-old" });
		let asked = false;
		expect(
			await endSession(N, slots, async () => {
				asked = true;
				return "ended";
			}),
		).toBe("nothing");
		expect(asked).toBe(false);
		expect(storedWallets(slots)).toEqual([O]);
		forgetWallet(slots, O);
		expect(storedWallets(slots)).toEqual([]);
	});
});
