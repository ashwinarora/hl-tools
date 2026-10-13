import { describe, expect, it } from "vitest";
import { isMoment, isoTime, MAX_TIME_MS } from "../../src/multisig/index.ts";

describe("isoTime: a moment in a message, from a number somebody else wrote", () => {
	it("writes a moment as ISO text", () => {
		expect(isoTime(1_791_800_000_000)).toBe("2026-10-12T10:13:20.000Z");
		expect(isoTime(0)).toBe("1970-01-01T00:00:00.000Z");
		expect(isoTime(MAX_TIME_MS)).toBe("+275760-09-13T00:00:00.000Z");
		expect(isoTime(-MAX_TIME_MS)).toBe("-271821-04-20T00:00:00.000Z");
	});
	it("writes anything that is no moment as what it is, and never throws", () => {
		expect(isoTime(MAX_TIME_MS + 1)).toBe("8640000000000001 (no date)");
		expect(isoTime(9_000_000_000_000_000)).toBe("9000000000000000 (no date)");
		expect(isoTime(Number.NaN)).toBe("NaN (no date)");
		expect(isoTime(Number.POSITIVE_INFINITY)).toBe("Infinity (no date)");
		expect(isoTime("1791800000000")).toBe("1791800000000 (no date)");
		expect(isoTime(null)).toBe("null (no date)");
		expect(isoTime(undefined)).toBe("undefined (no date)");
		expect(isoTime(12n)).toBe("12 (no date)");
	});
	it("knows a moment from a number that is none", () => {
		expect(isMoment(MAX_TIME_MS)).toBe(true);
		expect(isMoment(MAX_TIME_MS + 1)).toBe(false);
		expect(isMoment(-1)).toBe(true);
		expect(isMoment("1")).toBe(false);
	});
});
