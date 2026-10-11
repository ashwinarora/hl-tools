import { ACCOUNT_MODES, accountMode } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { modeLabel } from "./mode";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

describe("modeLabel", () => {
	it("calls default and disabled a manual account, and unified a unified one", () => {
		expect(modeLabel(accountMode("default")).tag).toBe("manual account");
		expect(modeLabel(accountMode("disabled"))).toEqual(
			modeLabel(accountMode("default")),
		);
		const unified = modeLabel(accountMode("unifiedAccount"));
		expect(unified.tag).toBe("unified account");
		expect(unified.text).toContain("One balance");
		expect(unified.caution).toBe(false);
	});
	it("says so when a mode was not tested, or is not known at all", () => {
		const pm = modeLabel(accountMode("portfolioMargin"));
		expect(pm).toMatchObject({ tag: "portfolio margin", caution: true });
		expect(pm.text).toContain("not tested");
		const dex = modeLabel(accountMode("dexAbstraction"));
		expect(dex).toMatchObject({ tag: "DEX abstraction", caution: true });
		const odd = modeLabel(accountMode("somethingNew"));
		expect(odd).toMatchObject({ tag: "unknown mode", caution: true });
		expect(odd.text).toContain('"somethingNew"');
	});
	it("has a label for every mode Hyperliquid names, in plain words", () => {
		for (const raw of [...ACCOUNT_MODES, "?"]) {
			const l = modeLabel(accountMode(raw));
			expect(l.tag.length).toBeGreaterThan(5);
			expect(l.text).toMatch(/^[A-Z].*\.$/);
			for (const claim of FORBIDDEN_CLAIMS) expect(l.text).not.toMatch(claim);
		}
	});
});
