import { describe, expect, it } from "vitest";
import {
	fromNow,
	isoDateTime,
	localDateTime,
	utcDateTime,
	zoneLabel,
} from "./time";

// 2026-10-10 19:51:35 UTC
const T = Date.UTC(2026, 9, 10, 19, 51, 35);
const gb = (timeZone: string) => ({ locale: "en-GB", timeZone });

describe("localDateTime", () => {
	it("shows a moment in the reader's zone: the date can differ from the UTC date", () => {
		expect(localDateTime(T, gb("UTC"))).toBe("10 Oct 2026, 19:51");
		expect(localDateTime(T, gb("Asia/Kolkata"))).toBe("11 Oct 2026, 01:21");
		expect(localDateTime(T, gb("America/New_York"))).toBe("10 Oct 2026, 15:51");
	});
	it("can carry seconds, for rows that happen close together", () => {
		expect(localDateTime(T, gb("Asia/Kolkata"), { seconds: true })).toBe(
			"11 Oct 2026, 01:21:35",
		);
	});
	it("follows the locale's own order and clock", () => {
		expect(
			localDateTime(T, { locale: "en-US", timeZone: "America/New_York" }),
		).toMatch(/^Oct 10, 2026, 3:51\sPM$/);
	});
	it("uses the machine's locale and zone when none is given", () => {
		expect(localDateTime(T)).toMatch(/2026/);
		// asked twice: the same text
		expect(localDateTime(T)).toBe(localDateTime(T));
	});
	it("never prints a number that is not a time", () => {
		for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 9e15 * 10]) {
			expect(localDateTime(bad, gb("UTC"))).toBe("—");
			expect(utcDateTime(bad)).toBe("—");
			expect(isoDateTime(bad)).toBe("");
			expect(zoneLabel(bad, gb("UTC"))).toBe("");
			expect(fromNow(bad, T)).toBe("—");
			expect(fromNow(T, bad)).toBe("—");
		}
	});
});

describe("utcDateTime, isoDateTime, zoneLabel", () => {
	it("give the same moment for everyone, and name the reader's zone", () => {
		expect(utcDateTime(T)).toBe("2026-10-10 19:51:35 UTC");
		expect(isoDateTime(T)).toBe("2026-10-10T19:51:35.000Z");
		expect(zoneLabel(T, gb("UTC"))).toBe("UTC");
		expect(zoneLabel(T, gb("Asia/Kolkata"))).toBe("GMT+5:30");
	});
});

describe("fromNow", () => {
	const min = 60_000;
	const hour = 60 * min;
	const day = 24 * hour;
	it("says how far ahead, coarsely", () => {
		expect(fromNow(T + 20_000, T)).toBe("in less than a minute");
		expect(fromNow(T + min, T)).toBe("in 1 minute");
		expect(fromNow(T + 12.9 * min, T)).toBe("in 12 minutes");
		expect(fromNow(T + hour, T)).toBe("in 1 hour");
		expect(fromNow(T + 47.9 * hour, T)).toBe("in 47 hours");
		expect(fromNow(T + 2 * day, T)).toBe("in 2 days");
		expect(fromNow(T + 89.5 * day, T)).toBe("in 89 days");
	});
	it("says how long ago for moments that passed", () => {
		expect(fromNow(T, T)).toBe("in less than a minute");
		expect(fromNow(T - 1, T)).toBe("less than a minute ago");
		expect(fromNow(T - 5 * min, T)).toBe("5 minutes ago");
		expect(fromNow(T - 3 * day, T)).toBe("3 days ago");
	});
});
