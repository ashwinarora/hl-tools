import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	outcomeName,
	outcomeShare,
	type RawOutcomeMeta,
	type RawOutcomeTemplate,
} from "../src/index.ts";

interface Recorded {
	readonly network: string;
	readonly outcomeMeta: RawOutcomeMeta;
	readonly outcomeTemplates: RawOutcomeTemplate[];
}
const recorded = (network: "mainnet" | "testnet"): Recorded =>
	JSON.parse(
		readFileSync(
			new URL(`../fixtures/outcomes/meta-${network}.json`, import.meta.url),
			"utf8",
		),
	);
const MAINNET = recorded("mainnet");
const TESTNET = recorded("testnet");

const nameIn = (r: Recorded, token: string) => {
	const share = outcomeShare(token);
	if (!share) throw new Error(`not a share: ${token}`);
	return outcomeName(share, r.outcomeMeta, r.outcomeTemplates);
};

describe("outcomeShare: an outcome share among the balances", () => {
	it("reads the token name '+<encoding>'", () => {
		expect(outcomeShare("+102251")).toEqual({
			outcome: 10225,
			side: 1,
			encoding: 102251,
		});
		expect(outcomeShare("+10")).toEqual({ outcome: 1, side: 0, encoding: 10 });
	});

	it("takes nothing else for one", () => {
		for (const name of [
			"USDC",
			"HYPE",
			"#102251",
			"+102252",
			"+",
			"+1.5",
			" +10",
			"+10 ",
		])
			expect(outcomeShare(name)).toBeNull();
	});
});

describe("outcomeName, replayed on Hyperliquid's lists (fixtures/outcomes)", () => {
	it("names the first share seen in a treasury: a plain name and its own sides", () => {
		expect(nameIn(TESTNET, "+102251")).toEqual({
			title: "June Fed rate change",
			side: "No Change",
			unknown: false,
		});
		expect(nameIn(TESTNET, "+102250").side).toBe("Change");
	});

	it("fills a template with the outcome's description, dates in UTC", () => {
		expect(nameIn(MAINNET, "+131030")).toEqual({
			title: "ZEC above 1057 at 2026-10-23 08:00 UTC?",
			side: "Yes",
			unknown: false,
		});
	});

	it("reads an outcome of a question with its question", () => {
		expect(nameIn(MAINNET, "+142000").title).toBe(
			"UEFA Europa League Matchday 3: TSG Hoffenheim v Lyon: Lyon",
		);
		expect(nameIn(MAINNET, "+139381").title).toBe(
			"UEFA Champions League Matchday 3: AS Roma v Slovan Bratislava: Other",
		);
	});

	it("fills a side named by the template", () => {
		expect(nameIn(MAINNET, "+144370")).toMatchObject({
			title: "LoL: Worlds Swiss Stage Round 1: LOS v T1",
			side: "LOS",
		});
		expect(nameIn(MAINNET, "+144371").side).toBe("T1");
	});

	it("names the protocol's own daily markets", () => {
		expect(nameIn(MAINNET, "+143150").title).toBe(
			"ETH above 2430.5 at 2026-10-20 06:00 UTC",
		);
		expect(nameIn(MAINNET, "+143210").title).toBe(
			"BTC at 2026-10-20 06:00 UTC: 84373 or above",
		);
		expect(nameIn(MAINNET, "+143180").title).toBe(
			"BTC at 2026-10-20 06:00 UTC: Other",
		);
	});

	it("gives every recorded outcome a name with nothing left to fill", () => {
		for (const r of [MAINNET, TESTNET])
			for (const o of r.outcomeMeta.outcomes)
				for (const side of [0, 1] as const) {
					const n = outcomeName(
						{ outcome: o.outcome, side, encoding: o.outcome * 10 + side },
						r.outcomeMeta,
						r.outcomeTemplates,
					);
					expect(n.unknown, `${r.network} ${o.outcome}`).toBe(false);
					expect(n.title).not.toMatch(/[{}]/);
					expect(n.side).not.toMatch(/[{}]/);
				}
	});
});

describe("outcomeName with less to go on", () => {
	const meta = (
		outcomes: RawOutcomeMeta["outcomes"],
		questions: RawOutcomeMeta["questions"] = [],
	): RawOutcomeMeta => ({ outcomes, questions });
	const share = { outcome: 7, side: 1 as const, encoding: 71 };
	const yesNo = [{ name: "Yes" }, { name: "No" }];

	it("says what it can while the lists are not read, or do not list it", () => {
		const none = { title: "Outcome 7", side: "side 1", unknown: true };
		expect(outcomeName(share, null, null)).toEqual(none);
		expect(outcomeName(share, meta([]), [])).toEqual(none);
	});

	it("falls back when a template, a class or a side cannot be read", () => {
		const o = (name: string, description = "", sideSpecs = yesNo) => ({
			outcome: 7,
			name,
			description,
			sideSpecs,
		});
		// a template that is not in the list
		expect(
			outcomeName(share, meta([o("template:gone", "a:b")]), null),
		).toMatchObject({
			title: "Outcome 7",
			unknown: true,
		});
		// a template with a word its description does not give
		const t = [{ id: "t", role: "question", name: "{a} and {b}" }];
		expect(
			outcomeName(share, meta([o("template:t", "a:1|junk")]), t).title,
		).toBe("Outcome 7");
		// a recurring class nobody described
		expect(
			outcomeName(share, meta([o("Recurring", "class:other")]), []).title,
		).toBe("Outcome 7");
		expect(
			outcomeName(
				share,
				meta([o("Recurring", "class:priceBinary|underlying:BTC")]),
				[],
			).title,
		).toBe("Outcome 7");
		// an empty plain name
		expect(outcomeName(share, meta([o("  ")]), []).unknown).toBe(true);
		// sides missing, or named by a template that cannot be filled
		expect(outcomeName(share, meta([o("Plain", "", [])]), []).side).toBe(
			"side 1",
		);
		expect(
			outcomeName(
				share,
				meta([o("Plain", "", [{ name: "x" }, { name: "template:{who}" }])]),
				[],
			).side,
		).toBe("side 1");
	});

	it("reads a bucket only from a question that gives its bounds", () => {
		const q = (description: string) => ({
			question: 1,
			name: "Recurring",
			description,
			fallbackOutcome: 9,
			namedOutcomes: [],
			settledNamedOutcomes: [7],
		});
		const bucket = (index: string, qd: string) =>
			outcomeName(
				share,
				meta(
					[
						{
							outcome: 7,
							name: "Recurring Named Outcome",
							description: index,
							sideSpecs: yesNo,
						},
					],
					[q(qd)],
				),
				[],
			).title;
		const head =
			"class:priceBucket|underlying:BTC|expiry:20260615-0600|priceThresholds:100,200";
		expect(bucket("index:0", head)).toBe(
			"BTC at 2026-06-15 06:00 UTC: below 100",
		);
		expect(bucket("index:1", head)).toBe(
			"BTC at 2026-06-15 06:00 UTC: 100 to 200",
		);
		expect(bucket("index:3", head)).toBe(
			"BTC at 2026-06-15 06:00 UTC: outcome 7",
		);
		expect(bucket("", head)).toBe("BTC at 2026-06-15 06:00 UTC: outcome 7");
		expect(
			bucket(
				"index:0",
				"class:priceBucket|underlying:BTC|expiry:20260615-0600",
			),
		).toBe("BTC at 2026-06-15 06:00 UTC: outcome 7");
		// a named outcome whose question is not listed
		expect(
			outcomeName(
				share,
				meta([
					{
						outcome: 7,
						name: "Recurring Named Outcome",
						description: "index:0",
						sideSpecs: yesNo,
					},
				]),
				[],
			).unknown,
		).toBe(true);
	});
});
