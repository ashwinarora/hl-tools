import { describe, expect, it } from "vitest";
import { type KnownReads, knownStateOf } from "./knownState";

const reads = (over: Partial<KnownReads> = {}): KnownReads => ({
	enabled: true,
	relay: true,
	shared: "read",
	local: "read",
	...over,
});

describe("how much of the record a page has", () => {
	it("is everything only once the relay's list and the browser's own copies are both read", () => {
		expect(knownStateOf(reads())).toBe("ready");
		// a proposal kept in this browser alone is not in the relay's list:
		// until the browser's copies are read, its transfer has no proposal to be tied to
		expect(knownStateOf(reads({ local: "pending" }))).toBe("loading");
		expect(knownStateOf(reads({ shared: "pending" }))).toBe("loading");
		expect(knownStateOf(reads({ shared: "pending", local: "pending" }))).toBe(
			"loading",
		);
	});
	it("is never everything when a part could not be read", () => {
		expect(knownStateOf(reads({ shared: "failed" }))).toBe("unavailable");
		expect(knownStateOf(reads({ local: "failed" }))).toBe("unavailable");
		expect(knownStateOf(reads({ shared: "failed", local: "pending" }))).toBe(
			"unavailable",
		);
	});
	it("is never everything without a relay: other signers' proposals are not here", () => {
		expect(knownStateOf(reads({ relay: false, local: "pending" }))).toBe(
			"loading",
		);
		expect(knownStateOf(reads({ relay: false }))).toBe("unavailable");
		expect(knownStateOf(reads({ relay: false, local: "failed" }))).toBe(
			"unavailable",
		);
	});
	it("waits while the hl-tools server's session is still being checked (audit F-083)", () => {
		expect(knownStateOf(reads({ relay: false, checking: true }))).toBe(
			"loading",
		);
		// once the check is over without a session, this browser's copies are what there is
		expect(knownStateOf(reads({ relay: false, checking: false }))).toBe(
			"unavailable",
		);
	});
	it("waits while the page has not asked", () => {
		expect(knownStateOf(reads({ enabled: false }))).toBe("loading");
	});
});
