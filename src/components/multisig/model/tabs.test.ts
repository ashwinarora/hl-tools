import { describe, expect, it } from "vitest";
import { DEFAULT_TREASURY_TAB, TREASURY_TABS, treasuryTab } from "./tabs";

describe("treasuryTab", () => {
	it("accepts every section by its name", () => {
		for (const t of TREASURY_TABS) expect(treasuryTab(t)).toBe(t);
		expect(TREASURY_TABS).toContain(DEFAULT_TREASURY_TAB);
	});
	it("sends links from before the rename to where their content went", () => {
		expect(treasuryTab("history")).toBe("log");
		expect(treasuryTab("signers")).toBe("overview");
	});
	it("answers undefined for anything else, so the page opens on its default", () => {
		for (const raw of ["", "Overview", "logs", 5, null, undefined, {}, ["log"]])
			expect(treasuryTab(raw)).toBeUndefined();
	});
});
