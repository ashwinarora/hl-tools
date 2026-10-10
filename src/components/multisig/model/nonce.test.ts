import { describe, expect, it } from "vitest";
import { describeWindow, EXTENDED_OFFSET_MS, nonceFor } from "./nonce";

const NOW = 1_791_399_781_235;
const HOUR = 3_600_000;

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
