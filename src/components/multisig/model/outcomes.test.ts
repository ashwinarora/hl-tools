import type { SpotBalanceRow } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { isOutcomeShare, OUTCOME_TITLE_MAX, splitHoldings } from "./outcomes";

const row = (coin: string, total: string, hold = "0"): SpotBalanceRow => ({
	key: coin,
	coin,
	token: null,
	total,
	hold,
	available: total,
});

// as Hyperliquid's lists had it on testnet (fixtures/outcomes/meta-testnet.json)
const LISTS = {
	meta: {
		outcomes: [
			{
				outcome: 10225,
				name: "June Fed rate change",
				description: "The market resolves to Change if…",
				sideSpecs: [{ name: "Change" }, { name: "No Change" }],
			},
		],
		questions: [],
	},
	templates: [],
};

describe("outcome shares among the balances", () => {
	// found on the live site: "+102251" listed as a token under Balances
	const spot = [
		row("USDC", "23.899883"),
		row("+102251", "12", "2"),
		row("HYPE", "0.086"),
		row("+102250", "0"),
		row("PURR", "0"),
	];

	it("go to Outcomes, named as Hyperliquid names them", () => {
		const { balances, outcomes } = splitHoldings(spot, LISTS);
		expect(balances.map((b) => b.coin)).toEqual(["USDC", "HYPE"]);
		expect(outcomes).toEqual([
			{
				key: "+102251",
				coin: "+102251",
				share: { outcome: 10225, side: 1, encoding: 102251 },
				title: "June Fed rate change",
				fullTitle: "June Fed rate change",
				side: "No Change",
				total: "12",
				hold: "2",
			},
		]);
	});

	it("are still set apart while the names are not read", () => {
		const { balances, outcomes } = splitHoldings(spot, null);
		expect(balances).toHaveLength(2);
		expect(outcomes.map((o) => [o.title, o.side])).toEqual([
			["Outcome 10225", "side 1"],
		]);
	});

	it("show a long name cut, with the whole name for the hover", () => {
		const long = "x".repeat(OUTCOME_TITLE_MAX + 50);
		const { outcomes } = splitHoldings([row("+70", "1")], {
			meta: {
				outcomes: [
					{
						outcome: 7,
						name: long,
						description: "",
						sideSpecs: [{ name: "Yes‮" }, { name: "No" }],
					},
				],
			},
			templates: null,
		});
		expect(outcomes[0]?.title).toBe(`${"x".repeat(OUTCOME_TITLE_MAX)}…`);
		expect(outcomes[0]?.fullTitle).toBe(long);
		// text somebody else wrote: no hidden characters
		expect(outcomes[0]?.side).toBe("Yes");
	});

	it("are told apart from tokens by name alone", () => {
		expect(isOutcomeShare({ coin: "+102251" })).toBe(true);
		for (const coin of ["USDC", "#102251", "+102252"])
			expect(isOutcomeShare({ coin })).toBe(false);
		expect(splitHoldings(null, null)).toEqual({ balances: [], outcomes: [] });
	});
});
