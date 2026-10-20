import { accountMode } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { RECIPIENT } from "#/test/keys";
import { amountWarnings } from "./actions";
import { HELP_JARGON } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

const PURR = {
	name: "PURR",
	tokenId: "0xc4bf3f870c0e9465323c0b6ed28096c2",
	weiDecimals: 5,
};
const HYPE = {
	name: "HYPE",
	tokenId: "0x7317beb7cceed72ef0b346074cc8e7ab",
	weiDecimals: 8,
};
const USDC = {
	name: "USDC",
	tokenId: "0xeb62eee3685fc4c43992febcd9e75443",
	weiDecimals: 8,
};
const tokens = [PURR, HYPE, USDC];
const MANUAL = accountMode("default");
const usdSend = (amount: string) => ({
	type: "usdSend",
	destination: RECIPIENT,
	amount,
});
const spotSend = (token: string, amount: string) => ({
	type: "spotSend",
	destination: RECIPIENT,
	token,
	amount,
});
const sendAsset = (over: Record<string, unknown>) => ({
	type: "sendAsset",
	destination: RECIPIENT,
	sourceDex: "spot",
	destinationDex: "spot",
	token: `USDC:${USDC.tokenId}`,
	fromSubAccount: "",
	amount: "1",
	...over,
});
const codes = (action: Record<string, unknown>, over = {}) =>
	amountWarnings(action as never, { tokens, ...over }).map((i) => i.code);

describe("what Hyperliquid would make of a pasted amount (decision D9)", () => {
	it("says a 7th decimal of perps USDC is dropped, as measured (audit F-004)", () => {
		const [w] = amountWarnings(usdSend("0.0100001") as never, { tokens });
		expect(w?.code).toBe("amount.usdc_precision");
		expect(w?.severity).toBe("warning");
		expect(w?.message).toBe(
			"Hyperliquid moves USDC from the perps balance in whole millionths: it would move 0.01 USDC, not 0.0100001.",
		);
		expect(codes(usdSend("0.010000"))).toEqual([]);
		expect(codes(usdSend(".01"))).toEqual([]);
	});

	it("says more decimals than a token takes are refused and use up the number (audit F-006)", () => {
		expect(codes(spotSend(`HYPE:${HYPE.tokenId}`, "0.000000001"))).toEqual([
			"amount.token_precision",
		]);
		expect(codes(spotSend(`HYPE:${HYPE.tokenId}`, "0.00000001"))).toEqual([]);
		// USDC from spot takes its own 8 (measured: 0.00000001 went through)
		expect(codes(sendAsset({ amount: "0.00000001" }))).toEqual([]);
		// from perps it is whole millionths, as Send USDC has it
		expect(codes(sendAsset({ sourceDex: "", amount: "0.00000001" }))).toEqual([
			"amount.usdc_precision",
		]);
	});

	it("says a token whose name and id disagree is refused (audit F-008)", () => {
		const [w] = amountWarnings(
			sendAsset({ token: `USDC:${HYPE.tokenId}`, amount: "0.0001" }) as never,
			{ tokens },
		);
		expect(w?.code).toBe("token.name_mismatch");
		expect(w?.message).toContain("its id belongs to HYPE");
		expect(codes(spotSend(`HYPE:0x${"0".repeat(32)}`, "1"))).toEqual([
			"token.unlisted",
		]);
		// with the list unread, nothing is said about the token
		expect(
			amountWarnings(spotSend(`HYPE:0x${"0".repeat(32)}`, "1") as never, {}),
		).toEqual([]);
	});

	it("says an amount that is not a plain decimal may be read otherwise (audit F-091)", () => {
		for (const amount of ["1e3", "1E-2", "0x10", "-1", "1,000"])
			expect(codes(usdSend(amount))).toEqual(["amount.not_plain"]);
	});

	it("says an amount over the balance it comes from, as the guided forms do", () => {
		const balances = {
			perpWithdrawable: "5",
			spot: [{ coin: "USDC", total: "125", hold: "0" }],
		};
		expect(codes(usdSend("6"), { balances, mode: MANUAL })).toEqual([
			"amount.exceeds_balance",
		]);
		expect(
			codes(sendAsset({ amount: "1000" }), { balances, mode: MANUAL }),
		).toEqual(["amount.exceeds_balance"]);
		expect(
			codes(sendAsset({ amount: "100" }), { balances, mode: MANUAL }),
		).toEqual([]);
		// with the mode unread, nothing is said about balances
		expect(codes(usdSend("6"), { balances })).toEqual([]);
	});

	it("says nothing about actions without an amount, and in plain words when it does", () => {
		expect(codes({ type: "approveAgent" })).toEqual([]);
		const all = [
			...amountWarnings(usdSend("0.0100001") as never, { tokens }),
			...amountWarnings(usdSend("1e3") as never, { tokens }),
			...amountWarnings(
				{
					type: "withdraw3",
					destination: RECIPIENT,
					amount: "2.0000001",
				} as never,
				{ tokens },
			),
			...amountWarnings(sendAsset({ token: `USDC:${HYPE.tokenId}` }) as never, {
				tokens,
			}),
		];
		expect(all).toHaveLength(4);
		for (const w of all) {
			for (const c of FORBIDDEN_CLAIMS) expect(w.message).not.toMatch(c);
			for (const j of HELP_JARGON) expect(w.message).not.toMatch(j);
		}
	});
});
