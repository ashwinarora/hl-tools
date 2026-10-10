import type { LedgerRow, OrderRow } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	amountText,
	compareAmount,
	compareNumber,
	compareText,
	explorerAccountUrl,
	explorerTxUrl,
	fillValue,
	isNonZero,
	ledgerAmount,
	ledgerWhat,
	orderSide,
	orderTypeText,
	percentText,
	positionSide,
	signedText,
	signOf,
	sizeOf,
	viewMoreUrl,
} from "./columns";

const sorted = <T>(xs: T[], cmp: (a: T, b: T) => number) => [...xs].sort(cmp);

describe("comparators", () => {
	it("amounts are compared as decimals, not as text or floats", () => {
		expect(
			sorted(["10", "9", "-3", "9.5", "0.1", "100.0"], compareAmount),
		).toEqual(["-3", "0.1", "9", "9.5", "10", "100.0"]);
		// beyond what a float can tell apart
		expect(
			compareAmount("9007199254740993.000000001", "9007199254740993.000000002"),
		).toBe(-1);
		expect(compareAmount("1.0", "1")).toBe(0);
	});
	it("a missing amount comes after every number", () => {
		expect(
			sorted(["2", null, "1", "x", undefined, "3"], compareAmount),
		).toEqual(["1", "2", "3", null, "x", undefined]);
		expect(compareAmount(null, null)).toBe(0);
	});
	it("numbers: ascending, missing last", () => {
		expect(sorted([3, null, 1, undefined, 2], compareNumber)).toEqual([
			1,
			2,
			3,
			null,
			undefined,
		]);
		expect(compareNumber(5, 5)).toBe(0);
		expect(compareNumber(null, undefined)).toBe(0);
	});
	it("text: by letters, then by case, the same everywhere", () => {
		expect(
			sorted(["eth", "BTC", "btc", "ATOM", null, "ETH"], compareText),
		).toEqual([null, "ATOM", "BTC", "btc", "ETH", "eth"]);
		expect(compareText("a", "a")).toBe(0);
	});
});

describe("amount text", () => {
	it("separates thousands and drops trailing zeros, exactly", () => {
		expect(amountText("82689.0")).toBe("82,689");
		expect(amountText("163.403954")).toBe("163.403954");
		expect(amountText("1234567.5")).toBe("1,234,567.5");
		expect(amountText("0.00019")).toBe("0.00019");
		expect(amountText("-12.50")).toBe("-12.5");
	});
	it("rounds only when asked, and can pad", () => {
		expect(amountText("163.403954", { maxDecimals: 2 })).toBe("163.4");
		expect(amountText("163.405", { maxDecimals: 2 })).toBe("163.4");
		expect(amountText("163.415", { maxDecimals: 2 })).toBe("163.42");
		expect(amountText("10.5", { maxDecimals: 2, minDecimals: 2 })).toBe(
			"10.50",
		);
		expect(amountText("7", { minDecimals: 2 })).toBe("7.00");
	});
	it("says so when there is nothing to show", () => {
		for (const v of [null, undefined, "", "abc"]) {
			expect(amountText(v)).toBe("—");
			expect(signedText(v)).toBe("—");
			expect(percentText(v)).toBe("—");
			expect(signOf(v)).toBe(0);
			expect(isNonZero(v)).toBe(false);
		}
	});
	it("spells the sign out for gains and losses", () => {
		expect(signedText("1.5")).toBe("+1.5");
		expect(signedText("-0.0012")).toBe("−0.0012");
		expect(signedText("0.0")).toBe("0");
		// a loss too small to show at two places is not shown as "−0"
		expect(signedText("-0.0012", { maxDecimals: 2 })).toBe("0");
		expect(signedText("-0.006", { maxDecimals: 2 })).toBe("−0.01");
		expect(signOf("-0.0")).toBe(0);
		expect(signOf("-1")).toBe(-1);
		expect(signOf("3")).toBe(1);
		expect(isNonZero("0.000")).toBe(false);
		expect(isNonZero("0.001")).toBe(true);
	});
	it("turns a rate into a percentage", () => {
		expect(percentText("0.0000131")).toBe("0.0013%");
		// a tie rounds to the even digit, like every other figure here
		expect(percentText("0.0000125")).toBe("0.0012%");
		expect(percentText("-0.000532081")).toBe("−0.0532%");
		expect(percentText("0")).toBe("0.0000%");
		expect(percentText("0.01", 2)).toBe("1.00%");
	});
});

describe("cells", () => {
	it("sides and sizes", () => {
		expect(positionSide("0.00019")).toBe("Long");
		expect(positionSide("-2")).toBe("Short");
		expect(sizeOf("-2.50")).toBe("2.5");
		expect(sizeOf("0.00019")).toBe("0.00019");
		expect(sizeOf("?")).toBe("?");
		expect(orderSide("B")).toBe("Buy");
		expect(orderSide("A")).toBe("Sell");
	});
	it("order types, with their trigger and reduce-only", () => {
		const o: OrderRow = {
			key: "1",
			oid: 1,
			coin: "BTC",
			side: "A",
			limitPx: "66149.0",
			sz: "0.00019",
			origSz: "0.00019",
			timestamp: 1,
			orderType: "Limit",
			tif: "Gtc",
			reduceOnly: false,
			isTrigger: false,
			triggerPx: null,
			triggerCondition: null,
			cloid: null,
		};
		expect(orderTypeText(o)).toBe("Limit");
		expect(orderTypeText({ ...o, reduceOnly: true })).toBe(
			"Limit, reduce only",
		);
		expect(
			orderTypeText({
				...o,
				orderType: "Stop Market",
				isTrigger: true,
				triggerPx: "60000.0",
				reduceOnly: true,
			}),
		).toBe("Stop Market at 60,000, reduce only");
		// channels that do not send the type
		expect(orderTypeText({ ...o, orderType: null })).toBe("Limit");
		expect(orderTypeText({ ...o, orderType: null, isTrigger: true })).toBe(
			"Trigger",
		);
	});
	it("a fill's value is price × size, exactly", () => {
		expect(fillValue({ px: "82689.0", sz: "0.00019" })).toBe("15.71091");
		expect(fillValue({ px: "x", sz: "1" })).toBeNull();
	});
});

describe("ledger wording", () => {
	const row = (over: Partial<LedgerRow>): LedgerRow => ({
		key: "k",
		time: 1,
		hash: `0x${"ab".repeat(32)}`,
		type: "internalTransfer",
		direction: "out",
		token: "USDC",
		amount: "40.0",
		counterparty: `0x${"1".repeat(40)}`,
		fromVenue: "perp",
		toVenue: "perp",
		fee: "1.0",
		feeToken: "USDC",
		delta: {},
		...over,
	});
	const P = `0x${"1".repeat(40)}`;
	it("says which way money went and names the other account", () => {
		expect(ledgerWhat(row({}))).toEqual({ text: "Sent to", party: P });
		expect(ledgerWhat(row({ direction: "in" }))).toEqual({
			text: "Received from",
			party: P,
		});
		expect(
			ledgerWhat(row({ type: "spotTransfer", direction: "out" })).text,
		).toBe("Sent to");
		expect(ledgerWhat(row({ type: "send", direction: "in" })).text).toBe(
			"Received from",
		);
	});
	it("describes moves between the account's own balances", () => {
		const move = (
			fromVenue: string,
			toVenue: string,
			type = "accountClassTransfer",
		) =>
			ledgerWhat(
				row({
					type,
					direction: "within",
					counterparty: null,
					fromVenue,
					toVenue,
				}),
			);
		expect(move("spot", "perp")).toEqual({
			text: "Moved spot → perps",
			party: null,
		});
		expect(move("perp", "spot").text).toBe("Moved perps → spot");
		expect(move("spot", "staking", "cStakingTransfer").text).toBe(
			"Moved spot → staking",
		);
		expect(move("perp", "xyz", "send").text).toBe(
			"Moved perps → the xyz market",
		);
		expect(
			ledgerWhat(
				row({
					type: "send",
					direction: "within",
					fromVenue: null,
					toVenue: "spot",
				}),
			).text,
		).toBe("Moved ? → spot");
	});
	it("names the bridge, vaults, rewards and liquidations", () => {
		const what = (type: string, over: Partial<LedgerRow> = {}) =>
			ledgerWhat(row({ type, ...over }));
		expect(what("deposit", { direction: "in", counterparty: null })).toEqual({
			text: "Deposited from Arbitrum",
			party: null,
		});
		expect(what("withdraw").text).toBe("Withdrawn to Arbitrum");
		expect(what("vaultCreate")).toEqual({ text: "Created vault", party: P });
		expect(what("vaultDeposit").text).toBe("Deposited into vault");
		expect(what("vaultWithdraw").text).toBe("Withdrawn from vault");
		expect(what("vaultDistribution").text).toBe("Distribution from vault");
		expect(what("rewardsClaim").text).toBe("Claimed rewards");
		expect(what("spotGenesis").text).toBe("Token genesis");
		expect(what("liquidation", { direction: "other" }).text).toBe(
			"Liquidation",
		);
	});
	it("shows a kind it does not know by its own name", () => {
		expect(
			ledgerWhat(
				row({ type: "borrowLend", direction: "other", counterparty: null }),
			),
		).toEqual({ text: "borrowLend", party: null });
	});
	it("signs the amount by direction", () => {
		expect(ledgerAmount(row({}))).toBe("-40");
		expect(ledgerAmount(row({ direction: "in" }))).toBe("40");
		expect(ledgerAmount(row({ direction: "within" }))).toBe("40");
		expect(ledgerAmount(row({ direction: "out", amount: "-40" }))).toBe("-40");
		expect(ledgerAmount(row({ amount: null }))).toBeNull();
	});
});

describe("links to Hyperliquid", () => {
	const A = "0xBB82AAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaBB82";
	it("uses the host of the network the treasury is on", () => {
		expect(viewMoreUrl("mainnet", "tradeHistory", A)).toBe(
			`https://app.hyperliquid.xyz/tradeHistory/${A.toLowerCase()}`,
		);
		expect(viewMoreUrl("testnet", "historicalOrders", A)).toBe(
			`https://app.hyperliquid-testnet.xyz/historicalOrders/${A.toLowerCase()}`,
		);
		expect(viewMoreUrl("mainnet", "transferHistory", A)).toContain(
			"app.hyperliquid.xyz/transferHistory/0xbb82",
		);
		expect(viewMoreUrl("testnet", "fundingHistory", A)).toContain(
			"app.hyperliquid-testnet.xyz/fundingHistory/0xbb82",
		);
		expect(explorerAccountUrl("testnet", A)).toBe(
			`https://app.hyperliquid-testnet.xyz/explorer/address/${A.toLowerCase()}`,
		);
		expect(explorerTxUrl("mainnet", `0x${"AB".repeat(32)}`)).toBe(
			`https://app.hyperliquid.xyz/explorer/tx/0x${"ab".repeat(32)}`,
		);
	});
});
