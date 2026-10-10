import { describe, expect, it } from "vitest";
import {
	describeWindow,
	EXTENDED_OFFSET_MS,
	expiresSoon,
	nonceFor,
} from "./nonce";

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

describe("expiresSoon", () => {
	it("marks a proposal in its last day, in words", () => {
		expect(expiresSoon(NOW + 5 * HOUR + 60_000, NOW)).toEqual({
			text: "expires in 5 hours",
			at: NOW + 5 * HOUR + 60_000,
		});
		expect(expiresSoon(NOW + 12 * 60_000, NOW)?.text).toBe(
			"expires in 12 minutes",
		);
		expect(expiresSoon(NOW + 20_000, NOW)?.text).toBe(
			"expires in less than a minute",
		);
		expect(expiresSoon(NOW + 24 * HOUR, NOW)?.text).toBe("expires in 24 hours");
	});
	it("leaves alone one with more than a day left, and one that has closed", () => {
		expect(expiresSoon(NOW + 24 * HOUR + 1, NOW)).toBeNull();
		expect(expiresSoon(NOW + 47 * HOUR, NOW)).toBeNull();
		expect(expiresSoon(NOW, NOW)).toBeNull();
		expect(expiresSoon(NOW - HOUR, NOW)).toBeNull();
		expect(expiresSoon(Number.NaN, NOW)).toBeNull();
	});
});
