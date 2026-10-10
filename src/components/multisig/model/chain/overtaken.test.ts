import type { ExplorerTx, LedgerRow } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { LATER_SENDS_MAX, laterSends, shutOutByTx } from "./overtaken";

const T = `0x${"f8".repeat(20)}`;
const DEST = `0x${"5e".repeat(20)}`;
const NONCE = 1_791_400_180_224;
const DAY = 86_400_000;

const send = (time: number, over: Record<string, unknown> = {}) => ({
	type: "usdSend",
	signatureChainId: "0x66eee",
	hyperliquidChain: "Testnet",
	destination: DEST,
	amount: "1",
	time,
	...over,
});
const row = (time: number, over: Partial<LedgerRow> = {}): LedgerRow => ({
	key: `${time}`,
	time,
	hash: `0x${time.toString(16).padStart(64, "0")}`,
	type: "internalTransfer",
	direction: "out",
	token: "USDC",
	amount: "1.0",
	counterparty: DEST,
	fromVenue: "perp",
	toVenue: "perp",
	fee: null,
	feeToken: null,
	delta: {},
	...over,
});
const tx = (
	action: Record<string, unknown>,
	over: Partial<ExplorerTx> = {},
): ExplorerTx => ({
	time: NONCE + 5000,
	user: T,
	action: action as ExplorerTx["action"],
	block: 1,
	hash: `0x${"ab".repeat(32)}`,
	error: null,
	...over,
});

describe("laterSends", () => {
	it("picks the USDC sends that left after the pending one was proposed, newest first", () => {
		const got = laterSends(
			[row(NONCE + 1000), row(NONCE + 9000), row(NONCE - 3 * DAY)],
			send(NONCE),
		);
		expect(got.map((r) => r.time)).toEqual([NONCE + 9000, NONCE + 1000]);
	});
	it("also takes the day before: a send can land up to a day ahead of its own number", () => {
		expect(
			laterSends([row(NONCE - DAY + 1), row(NONCE - DAY)], send(NONCE)).map(
				(r) => r.time,
			),
		).toEqual([NONCE - DAY + 1]);
	});
	it("leaves out everything that is not a USDC send out of the account", () => {
		expect(
			laterSends(
				[
					row(NONCE + 1, { direction: "in" }),
					row(NONCE + 2, { type: "spotTransfer" }),
					row(NONCE + 3, { type: "accountClassTransfer", direction: "within" }),
					row(NONCE + 4, { type: "withdraw" }),
				],
				send(NONCE),
			),
		).toEqual([]);
	});
	it("asks about nothing for an action Hyperliquid takes in any order", () => {
		expect(
			laterSends([row(NONCE + 1)], {
				type: "usdClassTransfer",
				nonce: NONCE,
				toPerp: true,
			}),
		).toEqual([]);
		expect(laterSends([row(NONCE + 1)], null)).toEqual([]);
	});
	it("stops at the newest few", () => {
		const many = Array.from({ length: 30 }, (_, n) => row(NONCE + n + 1));
		const got = laterSends(many, send(NONCE));
		expect(got).toHaveLength(LATER_SENDS_MAX);
		expect(got[0]?.time).toBe(NONCE + 30);
	});
});

describe("shutOutByTx", () => {
	const pending = send(NONCE);
	it("is the send that went through with a later number", () => {
		const newer = tx(send(NONCE + 2000, { amount: "7" }));
		expect(shutOutByTx(pending, T, [newer])).toBe(newer);
		// compared without regard to letter case of the account
		expect(
			shutOutByTx(pending, T.toUpperCase().replace("0X", "0x"), [newer]),
		).toBe(newer);
	});
	it("is not an older send, a refused one, another account's, or another kind of action", () => {
		expect(shutOutByTx(pending, T, [tx(send(NONCE - 2000))])).toBeNull();
		expect(
			shutOutByTx(pending, T, [
				tx(send(NONCE + 2000), {
					error: "Insufficient balance for withdrawal.",
				}),
			]),
		).toBeNull();
		expect(
			shutOutByTx(pending, T, [
				tx(send(NONCE + 2000), { user: `0x${"11".repeat(20)}` }),
			]),
		).toBeNull();
		expect(
			shutOutByTx(pending, T, [
				tx({ type: "approveAgent", nonce: NONCE + 2000 }),
				tx({ type: "spotSend", time: NONCE + 2000 }),
			]),
		).toBeNull();
		expect(shutOutByTx(pending, T, [])).toBeNull();
	});
	it("is not the pending send's own transaction: that one carried it out", () => {
		expect(shutOutByTx(pending, T, [tx(send(NONCE))])).toBeNull();
		// a different send that happens to carry the same number does shut it out
		expect(
			shutOutByTx(pending, T, [tx(send(NONCE, { amount: "2" }))]),
		).not.toBeNull();
	});
	it("names the latest when several did", () => {
		const a = tx(send(NONCE + 1000));
		const b = tx(send(NONCE + 5000));
		expect(shutOutByTx(pending, T, [a, b])).toBe(b);
	});
});
