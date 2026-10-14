import type {
	FillRow,
	FundingRow,
	LedgerRow,
	OrderHistoryRow,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { toCsv } from "#/lib/download";
import {
	csvFilename,
	fundingCsv,
	ordersCsv,
	proposalCell,
	tradesCsv,
	transfersCsv,
} from "./csv";

const P = `0x${"1".repeat(40)}`;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const D = `0x${"d".repeat(64)}` as const;
const T0 = Date.UTC(2026, 9, 14, 2, 0, 0);

const ledger = (over: Partial<LedgerRow>): LedgerRow => ({
	key: "k",
	time: T0,
	hash: H(1),
	type: "send",
	direction: "out",
	token: "USDC",
	amount: "40.123456",
	counterparty: P,
	fromVenue: "perp",
	toVenue: "perp",
	fee: "1.0",
	feeToken: "USDC",
	requested: null,
	delta: {},
	...over,
});

describe("On Hyperliquid as CSV", () => {
	it("lists transfers oldest first, every figure exact, the fee only where this account paid it", () => {
		const t = transfersCsv(
			[
				ledger({ time: T0 + 2000, hash: H(3), direction: "in" }),
				ledger({
					time: T0 + 1000,
					hash: H(2),
					type: "withdraw",
					amount: "1.0",
					counterparty: null,
					requested: "2",
				}),
				ledger({}),
			],
			(r) =>
				r.hash === H(1) ? { kind: "matched", digest: D } : { kind: "none" },
		);
		expect(t.columns).toContain("Requested");
		expect(t.rows).toEqual([
			[
				"2026-10-14 02:00:00",
				"Sent to",
				P,
				"-40.123456",
				"USDC",
				"1.0",
				"USDC",
				null,
				H(1),
				D,
			],
			[
				"2026-10-14 02:00:01",
				"Withdrawn to Arbitrum",
				null,
				"-1",
				"USDC",
				"1.0",
				"USDC",
				"2",
				H(2),
				"",
			],
			[
				"2026-10-14 02:00:02",
				"Received from",
				P,
				"40.123456",
				"USDC",
				null,
				null,
				null,
				H(3),
				"",
			],
		]);
	});

	it("says no more about a row's proposal than the page could tell", () => {
		expect(proposalCell({ kind: "matched", digest: D })).toBe(D);
		expect(proposalCell({ kind: "likely", digest: D })).toBe(`likely ${D}`);
		expect(proposalCell({ kind: "ambiguous", digests: [D, D] })).toBe(
			`one of ${D} ${D}`,
		);
		for (const kind of [
			"none",
			"checking",
			"unchecked",
			"own-step",
			"not-applicable",
		] as const)
			expect(proposalCell({ kind })).toBe("");
	});

	it("writes trades, orders and funding with their exact figures", () => {
		const fill: FillRow = {
			key: "1",
			tid: 1,
			time: T0,
			coin: "BTC",
			side: "B",
			dir: "Open Long",
			px: "82689.0",
			sz: "0.00019",
			fee: "0.001",
			feeToken: "USDC",
			closedPnl: "0.0",
			oid: 7,
			hash: H(4),
			crossed: true,
		};
		expect(tradesCsv([fill]).rows).toEqual([
			[
				"2026-10-14 02:00:00",
				"BTC",
				"Open Long",
				"82689.0",
				"0.00019",
				"15.71091",
				"0.001",
				"USDC",
				"0.0",
				H(4),
			],
		]);
		const order: OrderHistoryRow = {
			key: "7",
			oid: 7,
			coin: "ETH",
			side: "A",
			limitPx: "3000.5",
			sz: "0",
			origSz: "0.5",
			timestamp: T0,
			orderType: "Limit",
			tif: "Gtc",
			reduceOnly: true,
			isTrigger: false,
			triggerPx: null,
			triggerCondition: null,
			cloid: null,
			status: "filled",
			statusTimestamp: T0 + 5000,
		};
		expect(ordersCsv([order]).rows).toEqual([
			[
				"2026-10-14 02:00:05",
				"ETH",
				"Sell",
				"Limit, reduce only",
				"3000.5",
				"0.5",
				"filled",
				7,
			],
		]);
		const funding: FundingRow = {
			key: "f",
			time: T0,
			coin: "BTC",
			usdc: "-0.012345",
			szi: "-0.5",
			fundingRate: "0.0000125",
		};
		expect(fundingCsv([funding]).rows).toEqual([
			["2026-10-14 02:00:00", "BTC", "-0.5", "-0.012345", "0.0000125"],
		]);
	});

	it("keeps a negative figure a number in the file", () => {
		const t = fundingCsv([
			{
				key: "f",
				time: T0,
				coin: "BTC",
				usdc: "-0.5",
				szi: null,
				fundingRate: null,
			},
		]);
		expect(toCsv(t.columns, t.rows)).toContain(",-0.5,");
	});

	it("names the file by what, network, account and day", () => {
		expect(csvFilename("transfers", "testnet", P, T0)).toBe(
			"hl-transfers-testnet-0x11111111-2026-10-14.csv",
		);
	});
});
