import { describe, expect, it } from "vitest";
import {
	agoWords,
	fromNow,
	isoDateTime,
	localDateTime,
	untilWords,
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

describe("agoWords: something that has happened is never told as still to come", () => {
	const T = Date.UTC(2026, 9, 12, 12, 0);
	it("reads like fromNow for a moment in the past", () => {
		expect(agoWords(T - 2 * 3_600_000, T)).toBe("2 hours ago");
		expect(agoWords(T - 20_000, T)).toBe("less than a minute ago");
	});
	it("takes a stamp that lies ahead of this clock, or on it, for just now", () => {
		// the relay's clock a little ahead, or a page clock read a while ago
		expect(agoWords(T + 20_000, T)).toBe("less than a minute ago");
		expect(agoWords(T + 5 * 60_000, T)).toBe("less than a minute ago");
		expect(agoWords(T, T)).toBe("less than a minute ago");
	});
});

describe("untilWords", () => {
	const T = Date.UTC(2026, 9, 12, 12, 0);
	const H = 3_600_000;
	it("gives days and hours, hours, then minutes as the moment comes closer", () => {
		expect(untilWords(T + 54 * H, T)).toBe("in 2 days 6 hours");
		expect(untilWords(T + 48 * H, T)).toBe("in 2 days");
		expect(untilWords(T + 25 * H, T)).toBe("in 1 day 1 hour");
		expect(untilWords(T + 23 * H + 59 * 60_000, T)).toBe("in 23 hours");
		expect(untilWords(T + H, T)).toBe("in 1 hour");
		expect(untilWords(T + 59 * 60_000, T)).toBe("in 59 minutes");
		expect(untilWords(T + 30_000, T)).toBe("in less than a minute");
	});
	it("reads a moment that has passed as fromNow does, and nothing for what is not a time", () => {
		expect(untilWords(T - 2 * H, T)).toBe("2 hours ago");
		expect(untilWords(Number.NaN, T)).toBe("—");
	});
});
