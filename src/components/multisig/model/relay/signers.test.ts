import type { Address, Policy } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, OUTSIDER } from "#/test/keys";
import {
	compareSigners,
	livePolicy,
	nextRecheck,
	RECHECK_EVERY_MS,
	RECHECK_MAX,
	type StoredPolicy,
} from "./signers";

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

describe("livePolicy", () => {
	it("is unknown while the chain has not answered", () => {
		expect(livePolicy(null, null)).toBeNull();
		expect(livePolicy(null, live([A, B, C], 2))).toBeNull();
	});

	it("passes a signer set through", () => {
		const p = live([A, B, C], 2);
		expect(livePolicy(true, p)).toBe(p);
	});

	it("turns 'not a multi-sig' into an empty signer set, not into 'unknown'", () => {
		expect(livePolicy(false, null, 7)).toEqual({
			authorizedUsers: [],
			threshold: 0,
			observedAt: 7,
		});
	});

	it("lets a page see that its treasury stopped being a multi-sig (found in the browser: it never asked for the re-check that freezes it)", () => {
		const d = compareSigners(livePolicy(false, null), stored());
		expect(d?.same).toBe(false);
		expect(d?.noLongerMultisig).toBe(true);
		// and nothing is concluded while the read is still out
		expect(compareSigners(livePolicy(null, null), stored())).toBeNull();
	});

	it("agrees with a frozen copy once the relay has caught up", () => {
		const d = compareSigners(livePolicy(false, null), stored({ frozen: true }));
		expect(d?.same).toBe(true);
	});
});

describe("nextRecheck", () => {
	const T = 1_000_000;

	it("asks at once the first time a difference is seen", () => {
		expect(nextRecheck(null, 0, T)).toBe(0);
	});

	it("waits out the relay's own 30-second window before asking again", () => {
		expect(RECHECK_EVERY_MS).toBeGreaterThan(30_000);
		expect(nextRecheck(T, 1, T)).toBe(RECHECK_EVERY_MS);
		expect(nextRecheck(T, 1, T + 10_000)).toBe(RECHECK_EVERY_MS - 10_000);
		expect(nextRecheck(T, 1, T + RECHECK_EVERY_MS)).toBe(0);
		expect(nextRecheck(T, 1, T + 10 * RECHECK_EVERY_MS)).toBe(0);
	});

	it("keeps asking while the difference lasts: a second change inside the window is not lost", () => {
		// found in the browser: two signer changes 40 s apart; the second ask was dropped, not deferred
		const firstAsk = T;
		const secondChangeSeenAt = T + 20_000;
		const wait = nextRecheck(firstAsk, 1, secondChangeSeenAt);
		expect(wait).toBe(15_000);
		expect(wait).not.toBeNull();
	});

	it("gives up after a handful of asks for the same difference", () => {
		expect(nextRecheck(T, RECHECK_MAX - 1, T)).not.toBeNull();
		expect(nextRecheck(T, RECHECK_MAX, T + 10 * RECHECK_EVERY_MS)).toBeNull();
		expect(nextRecheck(null, RECHECK_MAX, T)).toBeNull();
	});
});
