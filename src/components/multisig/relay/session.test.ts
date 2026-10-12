import { describe, expect, it } from "vitest";
import type { RelayClient } from "./client";
import { type SignInWallet, signIn } from "./session";

const ORIGIN = "http://localhost:3000";
const NEW = "0x00000000000000000000000000000000000000b2" as const;
const OLD = "0x00000000000000000000000000000000000000a1" as const;

interface Held {
	readonly access_token: string;
	readonly user: { readonly id: string };
	readonly wallet: string;
}

/** As much of the Supabase client as signing in touches, with one session slot like a browser's. */
function relay(o: { held?: Held; refuses?: boolean; opensFor?: string }) {
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
		rpc: async () => ({ data: held?.wallet ?? null, error: null }),
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
