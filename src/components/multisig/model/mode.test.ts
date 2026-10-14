import { ACCOUNT_MODES, accountMode } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { balanceView, modeLabel } from "./mode";
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

describe("balanceView: the figures a treasury's screens show", () => {
	const perp = { accountValue: "12.5", withdrawable: "9.25" };
	const spot = [
		{ coin: "USDC", total: "23.71", hold: "2.31" },
		{ coin: "HYPE", total: "1.5", hold: "0" },
	];
	it("shows a manual account as two balances", () => {
		for (const raw of ["default", "disabled", "dexAbstraction"])
			expect(balanceView(accountMode(raw), perp, spot)).toEqual({
				kind: "two",
				perpsValue: "12.5",
				perpsMovable: "9.25",
				spotUsdc: "23.71",
			});
	});
	it("shows a unified account as one balance, with what is in use and what is left", () => {
		// as measured: 23.71 held, 2.31 reserved by a position and an order, 21.4 sendable
		expect(balanceView(accountMode("unifiedAccount"), perp, spot)).toEqual({
			kind: "one",
			balance: "23.71",
			movable: "21.4",
			inUse: "2.31",
		});
		expect(balanceView(accountMode("portfolioMargin"), null, spot).kind).toBe(
			"one",
		);
	});
	it("counts no USDC as zero once the balances are read, and nothing before", () => {
		const unified = accountMode("unifiedAccount");
		expect(balanceView(unified, null, [])).toEqual({
			kind: "one",
			balance: "0",
			movable: "0",
			inUse: "0",
		});
		expect(balanceView(unified, null, null)).toEqual({
			kind: "one",
			balance: null,
			movable: null,
			inUse: null,
		});
		expect(balanceView(accountMode("default"), null, null)).toEqual({
			kind: "two",
			perpsValue: null,
			perpsMovable: null,
			spotUsdc: null,
		});
		// a hold Hyperliquid did not state is no hold
		expect(
			balanceView(unified, null, [{ coin: "USDC", total: "5" }]),
		).toMatchObject({ movable: "5", inUse: "0" });
	});
	it("writes every figure alike, without trailing zeros", () => {
		expect(
			balanceView(
				accountMode("default"),
				{ accountValue: "0.0", withdrawable: "2.50" },
				[{ coin: "USDC", total: "8" }],
			),
		).toEqual({
			kind: "two",
			perpsValue: "0",
			perpsMovable: "2.5",
			spotUsdc: "8",
		});
	});
	it("falls back to two balances when the mode is not known", () => {
		expect(balanceView(null, perp, spot).kind).toBe("two");
		expect(balanceView(accountMode("somethingNew"), perp, spot).kind).toBe(
			"two",
		);
	});
});
