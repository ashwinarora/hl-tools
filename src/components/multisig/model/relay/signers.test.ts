import type { Address, Policy } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, OUTSIDER } from "#/test/keys";
import { compareSigners, type StoredPolicy } from "./signers";

const live = (
	authorizedUsers: readonly Address[],
	threshold: number,
): Policy => ({
	authorizedUsers: [...authorizedUsers].sort(),
	threshold,
	observedAt: 1,
});
const stored = (over: Partial<StoredPolicy> = {}): StoredPolicy => ({
	signers: [A, B, C].sort(),
	threshold: 2,
	frozen: false,
	...over,
});

describe("compareSigners", () => {
	it("has no verdict while the live set is unknown", () => {
		expect(compareSigners(null, stored())).toBeNull();
		expect(compareSigners(undefined, stored())).toBeNull();
	});

	it("is the same when signers and threshold agree, in any order", () => {
		expect(compareSigners(live([C, A, B], 2), stored())).toEqual({
			same: true,
			added: [],
			removed: [],
			thresholdChanged: false,
			noLongerMultisig: false,
			multisigAgain: false,
		});
	});

	it("names who was added and who was removed", () => {
		const d = compareSigners(live([A, B, OUTSIDER], 2), stored());
		expect(d?.same).toBe(false);
		expect(d?.added).toEqual([OUTSIDER]);
		expect(d?.removed).toEqual([C]);
		expect(d?.thresholdChanged).toBe(false);
	});

	it("sees a threshold change on its own", () => {
		const d = compareSigners(live([A, B, C], 3), stored());
		expect(d?.same).toBe(false);
		expect(d?.thresholdChanged).toBe(true);
		expect(d?.added).toEqual([]);
	});

	it("sees an account that stopped being a multi-sig", () => {
		const d = compareSigners(live([], 0), stored());
		expect(d?.same).toBe(false);
		expect(d?.noLongerMultisig).toBe(true);
	});

	it("agrees with a frozen copy when the chain still reports no signer set", () => {
		const d = compareSigners(live([], 0), stored({ frozen: true }));
		expect(d?.same).toBe(true);
		expect(d?.noLongerMultisig).toBe(false);
	});

	it("sees a frozen copy whose account is a multi-sig again, even with the old signers", () => {
		const d = compareSigners(live([A, B, C], 2), stored({ frozen: true }));
		expect(d?.same).toBe(false);
		expect(d?.multisigAgain).toBe(true);
		expect(d?.added).toEqual([]);
	});
});
