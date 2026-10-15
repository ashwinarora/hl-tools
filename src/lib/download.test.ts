import { describe, expect, it } from "vitest";
import { csvCell, csvTime, toCsv } from "./download";

describe("CSV", () => {
	it("quotes what RFC 4180 asks to quote, and doubles quotes", () => {
		expect(csvCell("plain")).toBe("plain");
		expect(csvCell("a, b")).toBe('"a, b"');
		expect(csvCell('say "no"')).toBe('"say ""no"""');
		expect(csvCell("two\nlines")).toBe('"two\nlines"');
		expect(csvCell(" padded")).toBe('" padded"');
		expect(csvCell(null)).toBe("");
		expect(csvCell(undefined)).toBe("");
		expect(csvCell(0)).toBe("0");
	});

	it("never lets a spreadsheet run a cell as a formula", () => {
		expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
		expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
		expect(csvCell("+cmd")).toBe("'+cmd");
		expect(csvCell("-2+3")).toBe("'-2+3");
		expect(csvCell("\tx")).toBe("'\tx");
		// a quoted formula is opened with the apostrophe inside the quotes
		expect(csvCell("=1,2")).toBe('"\'=1,2"');
		// a number stays a number, signed or not
		expect(csvCell("-1.5")).toBe("-1.5");
		expect(csvCell("+20")).toBe("+20");
		expect(csvCell("-0.000001")).toBe("-0.000001");
		expect(csvCell("1e-7")).toBe("1e-7");
	});

	it("writes a header and one record per row, each ended by CRLF", () => {
		expect(
			toCsv(
				["Time (UTC)", "What"],
				[
					["2026-10-14 02:54:01", "Sent, to Bob"],
					["", null],
				],
			),
		).toBe('Time (UTC),What\r\n2026-10-14 02:54:01,"Sent, to Bob"\r\n,\r\n');
		expect(toCsv(["A"], [])).toBe("A\r\n");
	});

	it("gives moments in UTC, and nothing for what is not one", () => {
		expect(csvTime(Date.UTC(2026, 9, 14, 2, 54, 1, 900))).toBe(
			"2026-10-14 02:54:01",
		);
		expect(csvTime(Number.NaN)).toBe("");
		expect(csvTime(0)).toBe("");
	});
});
