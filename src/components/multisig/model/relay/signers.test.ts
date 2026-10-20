import type { Address, Policy } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, OUTSIDER } from "#/test/keys";
import {
	COUNTED_MEANWHILE,
	compareSigners,
	livePolicy,
	mayAskAgain,
	nextRecheck,
	RECHECK_EVERY_MS,
	RECHECK_MAX,
	type RecheckState,
	recheckLine,
	requestRefusal,
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

describe("what the notice says is being done about a difference", () => {
	const state = (over: Partial<RecheckState> = {}): RecheckState => ({
		checking: false,
		refused: null,
		gaveUp: false,
		...over,
	});
	it("says the relay was asked only of an ask that got through", () => {
		expect(recheckLine(state())).toBe(
			"The hl-tools server has been asked to look again; this page updates by itself.",
		);
		expect(recheckLine(state({ checking: true }))).toBe(
			"The hl-tools server is checking this treasury on Hyperliquid now…",
		);
	});
	it("says why an ask did not get through, and that the asking has stopped", () => {
		// found in review: both read "has been asked to look again" before
		expect(
			recheckLine(state({ refused: "The relay could not be reached." })),
		).toBe(
			"The copy could not be brought up to date. The relay could not be reached.",
		);
		expect(recheckLine(state({ gaveUp: true }))).toBe(
			`The hl-tools server was asked ${RECHECK_MAX} times and its copy of the signers still differs from Hyperliquid's. It may not be reaching Hyperliquid right now; try again later.`,
		);
		// a refusal says more than "asked six times"
		expect(recheckLine(state({ gaveUp: true, refused: "No." }))).toContain(
			"No.",
		);
	});
	it("offers to ask by hand only once nothing is under way", () => {
		expect(mayAskAgain(state())).toBe(false);
		expect(mayAskAgain(state({ gaveUp: true }))).toBe(true);
		expect(mayAskAgain(state({ refused: "No." }))).toBe(true);
		expect(mayAskAgain(state({ gaveUp: true, checking: true }))).toBe(false);
	});
	it("never says the lists here count against the live list", () => {
		expect(COUNTED_MEANWHILE).toContain("count signatures against the copy");
	});
	it("reads what the relay said of a request it could not do", () => {
		expect(requestRefusal(null)).toBeNull();
		expect(requestRefusal({ status: "pending", reason: null })).toBeNull();
		expect(requestRefusal({ status: "done", reason: null })).toBeNull();
		expect(requestRefusal({ status: "failed", reason: "lookup_failed" })).toBe(
			"The hl-tools server could not reach Hyperliquid for this look-up. Try again in a minute.",
		);
		expect(requestRefusal({ status: "rejected", reason: null })).toBe(
			"The hl-tools server refused the request.",
		);
	});
});
