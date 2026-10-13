import { describe, expect, it } from "vitest";
import {
	DEFAULT_TREASURY_TAB,
	TREASURY_TABS,
	tabWants,
	treasuryTab,
} from "./tabs";

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

describe("tabWants: what a treasury page follows for the section on screen", () => {
	const none = { history: false, ledger: false, lookUps: false };
	it("follows nothing but the holdings where nothing else is shown and nothing waits", () => {
		for (const tab of ["overview", "pending", "staking", "log"] as const)
			expect(tabWants(tab, 0)).toEqual(none);
	});
	it("follows the ledger while a proposal waits, on every section, and looks its rows up", () => {
		// that is how the page notices a proposal carried out without the tool
		for (const tab of TREASURY_TABS) {
			const w = tabWants(tab, 1);
			expect([w.ledger, w.lookUps]).toEqual([true, true]);
			expect(w.history).toBe(tab === "chain");
		}
	});
	it("follows everything on “On Hyperliquid”", () => {
		expect(tabWants("chain", 0)).toEqual({
			history: true,
			ledger: true,
			lookUps: true,
		});
	});
	it("follows the ledger on the Vaults tab for its history, and looks nothing up for it", () => {
		// a vault row is tied to a proposal without its transaction, so the
		// explorer's daily allowance is not spent on rows the tab does not show
		expect(tabWants("vaults", 0)).toEqual({
			history: false,
			ledger: true,
			lookUps: false,
		});
	});
});
