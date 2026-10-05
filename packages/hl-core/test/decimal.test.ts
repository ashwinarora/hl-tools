import { describe, expect, it } from "vitest";
import {
	Decimal,
	DecimalParseError,
	InexactError,
	toWire,
} from "../src/decimal.ts";

const D = (s: string) => Decimal.parse(s);

describe("Decimal.parse", () => {
	it.each([
		["0", "0"],
		["-0", "0"],
		["0.000", "0"],
		["1.2300", "1.23"],
		["001.5", "1.5"],
		[".5", "0.5"],
		["5.", "5"],
		["1e3", "1000"],
		["1.5e-3", "0.0015"],
		["-12345.6789", "-12345.6789"],
		[
			"123456789012345678901234567890.123456789",
			"123456789012345678901234567890.123456789",
		],
	])("%s → %s", (input, expected) => {
		expect(D(input).toString()).toBe(expected);
	});

	it.each([
		"",
		" 1",
		"1 ",
		"abc",
		"1.2.3",
		"0x10",
		"NaN",
		"Infinity",
		"1,000",
		"--1",
		"+",
		".",
		"e5",
	])("rejects %j", (input) => {
		expect(() => D(input)).toThrow(DecimalParseError);
	});

	it("never accepts non-integer JS numbers", () => {
		expect(() => Decimal.fromInteger(0.1)).toThrow(InexactError);
		expect(Decimal.fromInteger(42).toString()).toBe("42");
	});
});

describe("arithmetic is exact", () => {
	it("0.1 + 0.2 = 0.3", () => {
		expect(D("0.1").add(D("0.2")).toString()).toBe("0.3");
	});
	it("multiplies without float error", () => {
		expect(D("1670.1").mul(D("0.0147")).toString()).toBe("24.55047");
		expect(D("-3").mul(D("0.5")).toString()).toBe("-1.5");
	});
	it("subtracts across scales", () => {
		expect(D("100").sub(D("0.001")).toString()).toBe("99.999");
	});
	it("divides with explicit rounding", () => {
		expect(D("1").div(D("3"), 5, "down").toString()).toBe("0.33333");
		expect(D("2").div(D("3"), 5, "half-even").toString()).toBe("0.66667");
		expect(D("-1").div(D("8"), 2, "half-even").toString()).toBe("-0.12");
		expect(() => D("1").div(D("0"), 2)).toThrow(RangeError);
	});
	it("compares", () => {
		expect(D("1.10").eq(D("1.1"))).toBe(true);
		expect(D("-1").lt(D("0"))).toBe(true);
		expect(D("0.0001").gt(D("0"))).toBe(true);
	});
});

describe("rounding", () => {
	it.each([
		["1.25", 1, "half-even", "1.2"],
		["1.35", 1, "half-even", "1.4"],
		["1.25", 1, "half-up", "1.3"],
		["-1.25", 1, "half-up", "-1.3"],
		["1.29", 1, "down", "1.2"],
		["-1.29", 1, "down", "-1.2"],
		["-1.21", 1, "floor", "-1.3"],
		["1.21", 1, "ceil", "1.3"],
		["1.21", 1, "up", "1.3"],
		["0.0004", 3, "down", "0"],
		["0.0004", 3, "up", "0.001"],
	] as const)("%s to %d dp (%s) = %s", (input, dp, mode, expected) => {
		expect(D(input).roundToDecimals(dp, mode).toString()).toBe(expected);
	});

	it.each([
		["12345.6", 5, "half-even", "12346"],
		["0.00123456", 5, "half-even", "0.0012346"],
		["123456", 5, "down", "123450"],
		["99999.5", 5, "half-up", "100000"],
		["0.1", 5, "down", "0.1"],
	] as const)("%s to %d sig figs (%s) = %s", (input, sf, mode, expected) => {
		expect(D(input).roundToSignificantFigures(sf, mode).toString()).toBe(
			expected,
		);
	});

	it("counts significant figures and decimals", () => {
		expect(D("1234.5").significantFigures()).toBe(5);
		expect(D("0.001234").significantFigures()).toBe(4);
		expect(D("1200").significantFigures()).toBe(2);
		expect(D("0").significantFigures()).toBe(0);
		expect(D("0.0012345").decimalPlaces()).toBe(7);
		expect(D("12345.6").integerDigits()).toBe(5);
		expect(D("0.5").integerDigits()).toBe(0);
	});
});

describe("scaled integers", () => {
	it("round-trips CoreWriter 1e8 values", () => {
		expect(D("2667.1").toScaledBigInt(8)).toBe(266710000000n);
		expect(Decimal.fromScaled(500000n, 8).toString()).toBe("0.005");
		expect(Decimal.fromScaled(10000000n, 6).toString()).toBe("10");
	});
	it("refuses to lose digits", () => {
		expect(() => D("0.000000001").toScaledBigInt(8)).toThrow(InexactError);
	});
	it("formats fixed and display", () => {
		expect(D("1.5").toFixedExact(3)).toBe("1.500");
		expect(D("-1234567.891").toDisplay()).toBe("-1,234,567.891");
	});
});

describe("toWire", () => {
	it("removes trailing zeros like the SDKs", () => {
		expect(toWire("100.000")).toBe("100");
		expect(toWire("0.10")).toBe("0.1");
		expect(toWire("-0.0")).toBe("0");
	});
});
