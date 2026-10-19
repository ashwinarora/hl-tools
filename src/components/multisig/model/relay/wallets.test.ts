import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	adoptLegacy,
	forgetWallet,
	hasSlot,
	legacyWallet,
	MAX_SIGNED_IN,
	overLimit,
	RELAY_LEGACY_KEY,
	RELAY_SLOT_PREFIX,
	RELAY_USED_KEY,
	type Slots,
	slotKey,
	storedWallets,
	touchWallet,
	walletOfSlot,
} from "./wallets";

const w = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const A = w(0xa1);
const B = w(0xb2);
const C = w(0xc3);

/** A stand-in for `localStorage`: insertion-ordered keys, strings only. */
function slots(init: Record<string, string> = {}): Slots & {
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

/** A stored session as Supabase writes it, for a wallet (checksummed, as it comes). */
const session = (address: string) =>
	JSON.stringify({
		access_token: "jwt",
		refresh_token: "renew",
		user: {
			id: "u",
			user_metadata: { custom_claims: { address } },
			identities: [{ identity_data: { custom_claims: { address } } }],
		},
	});

describe("a wallet's slot", () => {
	it("is named after the wallet, in lowercase, and nothing else is read as one", () => {
		expect(slotKey(A)).toBe(`${RELAY_SLOT_PREFIX}${A}`);
		expect(slotKey(A.toUpperCase().replace("0X", "0x") as Address)).toBe(
			slotKey(A),
		);
		expect(walletOfSlot(slotKey(A))).toBe(A);
		for (const key of [
			null,
			RELAY_LEGACY_KEY,
			RELAY_USED_KEY,
			`${RELAY_SLOT_PREFIX}`,
			`${RELAY_SLOT_PREFIX}0x12`,
			`${RELAY_SLOT_PREFIX}${A}x`,
			`${RELAY_SLOT_PREFIX}${A.toUpperCase()}`,
			`x${slotKey(A)}`,
			"hl-tools:network",
		])
			expect(walletOfSlot(key), String(key)).toBeNull();
	});

	it("is found by scanning, whatever else the browser keeps", () => {
		const s = slots({
			"hl-tools:network": "{}",
			[slotKey(B)]: session(B),
			[RELAY_USED_KEY]: "{}",
			[slotKey(A)]: session(A),
			[`${RELAY_SLOT_PREFIX}not-an-address`]: "x",
		});
		expect(storedWallets(s)).toEqual([A, B]);
		expect(hasSlot(s, A)).toBe(true);
		expect(hasSlot(s, C)).toBe(false);
	});
});

describe("the order of the wallets signed in here", () => {
	it("is most recently used first, and stable for wallets never noted", () => {
		const s = slots({
			[slotKey(C)]: "c",
			[slotKey(A)]: "a",
			[slotKey(B)]: "b",
		});
		expect(storedWallets(s)).toEqual([A, B, C]);
		touchWallet(s, B, 100);
		expect(storedWallets(s)).toEqual([B, A, C]);
		touchWallet(s, C, 200);
		touchWallet(s, B, 300);
		expect(storedWallets(s)).toEqual([B, C, A]);
	});

	it("notes nothing for a wallet with no slot, and drops notes of slots that are gone", () => {
		const s = slots({ [slotKey(A)]: "a" });
		touchWallet(s, B, 1);
		expect(s.map.has(RELAY_USED_KEY)).toBe(false);
		touchWallet(s, A, 2);
		s.map.set(
			RELAY_USED_KEY,
			JSON.stringify({ [A]: 2, [B]: 9, junk: 1, [C]: "x" }),
		);
		touchWallet(s, A, 3);
		expect(JSON.parse(s.map.get(RELAY_USED_KEY) ?? "")).toEqual({ [A]: 3 });
	});

	it.each([
		"",
		"not json",
		"[]",
		"null",
		"3",
		'{"0xnope":1}',
	])("survives a note that reads %j", (raw) => {
		const s = slots({ [slotKey(A)]: "a", [slotKey(B)]: "b" });
		s.map.set(RELAY_USED_KEY, raw);
		expect(storedWallets(s)).toEqual([A, B]);
		touchWallet(s, B, 5);
		expect(storedWallets(s)).toEqual([B, A]);
	});
});

describe("forgetting a wallet", () => {
	it("empties its slot and its note, and touches nobody else's", () => {
		const s = slots({ [slotKey(A)]: "a", [slotKey(B)]: "b" });
		touchWallet(s, A, 1);
		touchWallet(s, B, 2);
		forgetWallet(s, A);
		expect(storedWallets(s)).toEqual([B]);
		expect(JSON.parse(s.map.get(RELAY_USED_KEY) ?? "")).toEqual({ [B]: 2 });
		forgetWallet(s, B);
		expect([...s.map.keys()]).toEqual([]);
		// forgetting what is not there is not an error
		forgetWallet(s, C);
	});
});

describe("how many wallets stay signed in", () => {
	it("is bounded: the least recently used go, never the one that just signed in", () => {
		const all = Array.from({ length: 10 }, (_, i) => w(i + 1));
		expect(MAX_SIGNED_IN).toBe(8);
		expect(overLimit(all.slice(0, 8), all[0] as Address)).toEqual([]);
		// ten stored, the newest first: the two oldest go
		expect(overLimit(all, all[0] as Address)).toEqual([all[8], all[9]]);
		// the one to keep is the oldest in the list: it stays, the next oldest go
		expect(overLimit(all, all[9] as Address)).toEqual([all[7], all[8]]);
		expect(overLimit([A, B, C], C, 1)).toEqual([A, B]);
		expect(overLimit([A, B, C], A, 2)).toEqual([C]);
		expect(overLimit([], A)).toEqual([]);
	});
});

describe("the session of the single-slot time", () => {
	const mixed = "0x00000000000000000000000000000000000000A1";

	it("is moved into its wallet's slot once, and the single slot is emptied", () => {
		const s = slots({ [RELAY_LEGACY_KEY]: session(mixed) });
		expect(adoptLegacy(s, 7)).toBe(A);
		expect(s.map.has(RELAY_LEGACY_KEY)).toBe(false);
		expect(s.map.get(slotKey(A))).toBe(session(mixed));
		expect(storedWallets(s)).toEqual([A]);
		// nothing to adopt a second time
		expect(adoptLegacy(s, 8)).toBeNull();
		expect(storedWallets(s)).toEqual([A]);
	});

	it("is dropped when its wallet cannot be told or already has a slot", () => {
		for (const raw of ["", "not json", "null", "{}", '{"user":{}}', "[1]"]) {
			const s = slots({ [RELAY_LEGACY_KEY]: raw });
			expect(adoptLegacy(s, 1), raw).toBeNull();
			expect([...s.map.keys()], raw).toEqual([]);
		}
		const s = slots({
			[RELAY_LEGACY_KEY]: session(A),
			[slotKey(A)]: "newer",
		});
		expect(adoptLegacy(s, 1)).toBeNull();
		expect(s.map.get(slotKey(A))).toBe("newer");
		expect(s.map.has(RELAY_LEGACY_KEY)).toBe(false);
	});

	it("reads the wallet from either place Supabase writes it, as a hint only", () => {
		expect(legacyWallet(session(mixed))).toBe(A);
		expect(
			legacyWallet(
				JSON.stringify({
					user: {
						identities: [{ identity_data: { custom_claims: { address: B } } }],
					},
				}),
			),
		).toBe(B);
		expect(
			legacyWallet(
				JSON.stringify({
					user: { user_metadata: { custom_claims: { address: "0x12" } } },
				}),
			),
		).toBeNull();
		expect(legacyWallet(null)).toBeNull();
	});

	it("does nothing when there is no such session", () => {
		const s = slots({ [slotKey(B)]: "b" });
		expect(adoptLegacy(s, 1)).toBeNull();
		expect(storedWallets(s)).toEqual([B]);
	});
});
