import { describe, expect, it } from "vitest";
import {
	isRevert,
	parseSignersString,
	signersString,
	validateSignerSet,
} from "../../src/multisig/index.ts";
import {
	A,
	B,
	C,
	codes,
	OUTSIDER,
	POLICY,
	SPARE,
	TREASURY,
} from "./_helpers.ts";

const str = (users: string[], threshold: number) =>
	JSON.stringify({ authorizedUsers: users, threshold });
const many = (n: number) =>
	Array.from(
		{ length: n },
		(_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`,
	);

describe("parseSignersString", () => {
	it("set.not-string / set.not-json", () => {
		expect(
			codes(parseSignersString({ authorizedUsers: [A], threshold: 1 }).issues),
		).toEqual(["signers.not_string"]);
		expect(codes(parseSignersString("{").issues)).toEqual(["signers.not_json"]);
	});
	it("set.null-string-is-revert and set.json-null-also-revert", () => {
		for (const s of ["null", " null ", "null\n"])
			expect(parseSignersString(s)).toEqual({
				set: null,
				revert: true,
				issues: [],
			});
	});
	it("set.shape: arrays, missing authorizedUsers and non-integer thresholds are rejected", () => {
		expect(codes(parseSignersString("[]").issues)).toEqual(["signers.shape"]);
		expect(codes(parseSignersString('{"threshold":0}').issues)).toEqual([
			"signers.shape",
		]);
		expect(
			codes(
				parseSignersString(
					JSON.stringify({ authorizedUsers: [A], threshold: "1" }),
				).issues,
			),
		).toEqual(["signers.shape"]);
		expect(
			codes(
				parseSignersString(JSON.stringify({ authorizedUsers: [A] })).issues,
			),
		).toEqual(["signers.shape"]);
	});
	it("set.invalid-address", () => {
		const r = parseSignersString(str(["0x12", A], 1));
		expect(codes(r.issues)).toEqual(["address.invalid"]);
		expect(r.set).toBeNull();
	});
	it("set.checksummed → lowercased; set.unsorted → sorted; set.duplicate → deduplicated", () => {
		// A (key 1) sorts after B (key 2), so [A, B] is unsorted input.
		expect(A > B).toBe(true);
		const r = parseSignersString(
			str([A.toUpperCase().replace("0X", "0x"), B, A], 2),
		);
		expect(r.set).toEqual({ authorizedUsers: [B, A], threshold: 2 });
		expect(codes(r.issues).sort()).toEqual([
			"address.uppercase",
			"signers.duplicate",
			"signers.unsorted",
		]);
	});
	it("set.sorted-input: no ordering issue", () => {
		const r = parseSignersString(str([B, A], 1));
		expect(r.issues).toEqual([]);
	});
});

describe("signersString", () => {
	it("emits the canonical sorted form or the revert sentinel", () => {
		expect(signersString(null)).toBe("null");
		expect(signersString({ authorizedUsers: [B, A], threshold: 1 })).toBe(
			str([A, B].sort(), 1),
		);
	});
});

describe("validateSignerSet", () => {
	const ctx = { self: TREASURY, exists: () => true };
	it("set.empty-list-any-threshold", () => {
		expect(
			codes(validateSignerSet({ authorizedUsers: [], threshold: 0 }, ctx)),
		).toContain("signers.empty");
		expect(
			codes(validateSignerSet({ authorizedUsers: [], threshold: 1 }, ctx)),
		).toContain("signers.empty");
	});
	it("set.threshold-0 / set.threshold-gt-count", () => {
		expect(
			codes(validateSignerSet({ authorizedUsers: [A, B], threshold: 0 }, ctx)),
		).toEqual(["signers.threshold"]);
		expect(
			codes(validateSignerSet({ authorizedUsers: [A, B], threshold: 3 }, ctx)),
		).toEqual(["signers.threshold"]);
	});
	it("set.threshold-eq-count: all keys required warning (not for a 1-of-1)", () => {
		expect(
			codes(validateSignerSet({ authorizedUsers: [A, B], threshold: 2 }, ctx)),
		).toEqual(["lockout.all_keys_required"]);
		expect(
			codes(validateSignerSet({ authorizedUsers: [A], threshold: 1 }, ctx)),
		).toEqual([]);
	});
	it("set.more-than-10 / set.exactly-10", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: many(11) as never, threshold: 2 },
					ctx,
				),
			),
		).toEqual(["signers.too_many"]);
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: many(10) as never, threshold: 2 },
					ctx,
				),
			),
		).toEqual([]);
	});
	it("set.self-included", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A, TREASURY].sort() as never, threshold: 1 },
					ctx,
				),
			),
		).toEqual(["signers.self"]);
	});
	it("set.existence: unchecked warning, unknown warning, nonexistent error", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A], threshold: 1 },
					{ self: TREASURY },
				),
			),
		).toEqual(["signers.existence_unchecked"]);
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A], threshold: 1 },
					{ self: TREASURY, exists: () => undefined },
				),
			),
		).toEqual(["signers.existence_unknown"]);
		const r = validateSignerSet(
			{ authorizedUsers: [A, B].sort() as never, threshold: 1 },
			{ self: TREASURY, exists: (a) => a !== B },
		);
		expect(codes(r)).toEqual(["signers.nonexistent"]);
		expect(r[0]?.message).toContain(B);
	});
	it("set.nested-multisig-member", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A, B].sort() as never, threshold: 1 },
					{ ...ctx, isMultiSig: (a) => a === A },
				),
			),
		).toEqual(["signers.nested"]);
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A], threshold: 1 },
					{ ...ctx, isMultiSig: () => undefined },
				),
			),
		).toEqual([]);
	});
	it("set.removes-current-leader", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [B, C].sort() as never, threshold: 1 },
					{ ...ctx, leader: A, current: POLICY },
				),
			),
		).toEqual(["lockout.leader_removed"]);
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A, B].sort() as never, threshold: 1 },
					{ ...ctx, leader: A, current: POLICY },
				),
			),
		).toEqual([]);
	});
	it("set.removes-all-current-signers", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [OUTSIDER, SPARE].sort() as never, threshold: 1 },
					{ ...ctx, current: POLICY },
				),
			),
		).toEqual(["lockout.all_current_removed"]);
	});
	it("set.identical-to-current → noop info", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: POLICY.authorizedUsers, threshold: 2 },
					{ ...ctx, current: POLICY },
				),
			),
		).toEqual(["signers.noop"]);
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: POLICY.authorizedUsers, threshold: 1 },
					{ ...ctx, current: POLICY },
				),
			),
		).toEqual([]);
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A, B].sort() as never, threshold: 2 },
					{
						...ctx,
						current: { ...POLICY, authorizedUsers: [A, C].sort() as never },
					},
				),
			),
		).toEqual(["lockout.all_keys_required"]);
	});
	it("set.current-empty: a reverted policy with no users triggers no removal warning", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A], threshold: 1 },
					{
						...ctx,
						current: { authorizedUsers: [], threshold: 0, observedAt: 0 },
					},
				),
			),
		).toEqual([]);
	});
	it("set.lost-keys-unreachable", () => {
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A, B, C].sort() as never, threshold: 2 },
					{ ...ctx, lostKeys: [A, B] },
				),
			),
		).toEqual(["lockout.unreachable"]);
		expect(
			codes(
				validateSignerSet(
					{ authorizedUsers: [A, B, C].sort() as never, threshold: 2 },
					{ ...ctx, lostKeys: [A] },
				),
			),
		).toEqual([]);
	});
});

describe("isRevert", () => {
	it("true only for a convertToMultiSigUser with the null sentinel", () => {
		expect(isRevert({ type: "convertToMultiSigUser", signers: "null" })).toBe(
			true,
		);
		expect(
			isRevert({ type: "convertToMultiSigUser", signers: str([A], 1) }),
		).toBe(false);
		expect(isRevert({ type: "usdSend" })).toBe(false);
	});
});
