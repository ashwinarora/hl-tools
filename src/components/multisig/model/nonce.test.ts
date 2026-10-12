import { describe, expect, it } from "vitest";
import {
	closes,
	DATED_AHEAD,
	describeWindow,
	EXTENDED_OFFSET_MS,
	NUMBERED_AFTER,
	nonceFor,
	proposalNonce,
} from "./nonce";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

const NOW = 1_791_399_781_235;
const HOUR = 3_600_000;

describe("proposalNonce", () => {
	it("is the usual number when nothing earlier bears on it", () => {
		expect(proposalNonce("now", NOW, null)).toEqual({
			nonce: NOW,
			raised: false,
		});
		expect(proposalNonce("extended", NOW, null)).toEqual({
			nonce: NOW + EXTENDED_OFFSET_MS,
			raised: false,
		});
		// an earlier send dated in the past does not move it
		expect(proposalNonce("now", NOW, NOW - HOUR)).toEqual({
			nonce: NOW,
			raised: false,
		});
		expect(proposalNonce("now", NOW, NOW)).toEqual({
			nonce: NOW,
			raised: false,
		});
	});
	it("comes after a send that was dated ahead", () => {
		// yesterday's send was given the longer window: its number is still ahead of the clock
		const floor = NOW + 20 * HOUR + 1;
		expect(proposalNonce("now", NOW, floor)).toEqual({
			nonce: floor,
			raised: true,
		});
		// the longer window is ahead of it anyway
		expect(proposalNonce("extended", NOW, floor)).toEqual({
			nonce: NOW + EXTENDED_OFFSET_MS,
			raised: false,
		});
		// and what it is raised to can be submitted at once
		expect(describeWindow(floor, NOW).submittableNow).toBe(true);
	});
	it("says so in words that claim nothing the relay cannot keep", () => {
		for (const text of [NUMBERED_AFTER, DATED_AHEAD])
			for (const claim of FORBIDDEN_CLAIMS) expect(text).not.toMatch(claim);
	});
});

describe("nonce", () => {
	it("uses now, or 23 hours ahead for the longer window", () => {
		expect(nonceFor("now", NOW)).toBe(NOW);
		expect(nonceFor("extended", NOW)).toBe(NOW + EXTENDED_OFFSET_MS);
		expect(nonceFor("now")).toBeGreaterThan(NOW);
	});

	it("gives two days for now and almost three when extended, submittable at once", () => {
		const two = describeWindow(nonceFor("now", NOW), NOW + 1);
		expect(two.submittableNow).toBe(true);
		expect(two.hoursLeft).toBe(47);
		const three = describeWindow(nonceFor("extended", NOW), NOW);
		expect(three.submittableNow).toBe(true);
		expect(three.hoursLeft).toBe(71);
		expect(three.text).toMatch(
			/^submittable until \d{4}-\d\d-\d\d \d\d:\d\d UTC \(71 h left\)$/,
		);
	});

	it("says when the window has closed or has not opened", () => {
		const closed = describeWindow(NOW, NOW + 48 * HOUR);
		expect(closed.submittableNow).toBe(false);
		expect(closed.hoursLeft).toBe(0);
		expect(closed.text).toMatch(/^closed /);
		const early = describeWindow(NOW + 30 * HOUR, NOW);
		expect(early.submittableNow).toBe(false);
		expect(early.text).toMatch(/^opens .*, closes /);
	});
});

describe("when a waiting proposal lapses", () => {
	const HOUR = 3_600_000;
	const AT = Date.UTC(2026, 9, 14, 16, 20);

	it("is said from the start, in words that sharpen as it comes closer", () => {
		expect(closes(AT, AT - 47 * HOUR)).toEqual({
			at: AT,
			inWords: "in 1 day 23 hours",
			soon: false,
		});
		expect(closes(AT, AT - 30 * HOUR)?.inWords).toBe("in 1 day 6 hours");
		expect(closes(AT, AT - 48 * HOUR)?.inWords).toBe("in 2 days");
		expect(closes(AT, AT - 24 * HOUR)).toMatchObject({
			inWords: "in 1 day",
			soon: true,
		});
		expect(closes(AT, AT - 5 * HOUR)).toMatchObject({
			inWords: "in 5 hours",
			soon: true,
		});
		// the last hour in minutes
		expect(closes(AT, AT - 12 * 60_000)?.inWords).toBe("in 12 minutes");
		expect(closes(AT, AT - 60_000)?.inWords).toBe("in 1 minute");
		expect(closes(AT, AT - 20_000)?.inWords).toBe("in less than a minute");
	});

	it("is no longer said once the window has closed", () => {
		expect(closes(AT, AT)).toBeNull();
		expect(closes(AT, AT + 1)).toBeNull();
		expect(closes(Number.NaN, AT)).toBeNull();
	});
});
