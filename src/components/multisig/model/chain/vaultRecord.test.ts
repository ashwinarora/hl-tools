import type { LedgerRow } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { LANDS_AFTER_NONCE_MS } from "./match";
import { MADE_BEFORE_SLACK_MS } from "./stakingRecord";
import { vaultRecord } from "./vaultRecord";

const VAULT = "0x49d05977597b22e3c73d654c351adde9d9920e18";
const NONCE = 1_791_836_212_259;
const deposit = {
	type: "vaultTransfer",
	vaultAddress: VAULT,
	isDeposit: true,
	usd: 5_000_000,
};
const withdraw = { ...deposit, isDeposit: false };
const row = (
	type: "vaultDeposit" | "vaultWithdraw",
	time: number,
	delta: Record<string, unknown>,
	n = 1,
): LedgerRow => ({
	key: `k${n}`,
	time,
	hash: `0x${n.toString(16).padStart(64, "0")}`,
	type,
	direction: "within",
	token: "USDC",
	amount: "5.0",
	counterparty: VAULT,
	fromVenue: "perp",
	toVenue: "vault",
	fee: null,
	feeToken: null,
	delta: { type, vault: VAULT, ...delta },
});
const dep = (time: number, usdc = "5.0", n = 1) =>
	row("vaultDeposit", time, { usdc }, n);
const of = (
	ledger: readonly LedgerRow[] | null,
	action = deposit,
	madeAt: number | null = NONCE,
) => vaultRecord({ action, nonce: NONCE, madeAt, ledger });

describe("vaultRecord: whether a vault step may be carried out already", () => {
	it("says nothing it has not read", () => {
		expect(of(null)).toEqual({ kind: "unread" });
	});

	it("finds the one row like the action, made since the proposal", () => {
		expect(of([dep(NONCE + 4_000)])).toEqual({
			kind: "likely",
			time: NONCE + 4_000,
			hash: `0x${"0".repeat(63)}1`,
		});
		// the proposer's clock and Hyperliquid's are not one clock
		expect(of([dep(NONCE - MADE_BEFORE_SLACK_MS)]).kind).toBe("likely");
	});

	it("is none for a row from before the proposal, another amount, another vault, the other direction", () => {
		expect(of([dep(NONCE - MADE_BEFORE_SLACK_MS - 1)])).toEqual({
			kind: "none",
		});
		expect(of([dep(NONCE + 1, "6.0")])).toEqual({ kind: "none" });
		expect(
			of([
				row("vaultDeposit", NONCE + 1, {
					usdc: "5.0",
					vault: `0x${"11".repeat(20)}`,
				}),
			]),
		).toEqual({ kind: "none" });
		expect(
			of([row("vaultWithdraw", NONCE + 1, { requestedUsd: "5.0" })]),
		).toEqual({ kind: "none" });
		// after the window in which its number could have landed
		expect(of([dep(NONCE + LANDS_AFTER_NONCE_MS + 1)])).toEqual({
			kind: "none",
		});
		expect(of([])).toEqual({ kind: "none" });
	});

	it("does not choose between several rows like it", () => {
		expect(of([dep(NONCE + 1, "5.0", 1), dep(NONCE + 9, "5.0", 2)])).toEqual({
			kind: "several",
		});
	});

	it("ties a withdrawal by what was asked for, a millionth short at most", () => {
		const w = (requestedUsd: string) =>
			of([row("vaultWithdraw", NONCE + 1, { requestedUsd })], withdraw);
		expect(w("4.999999").kind).toBe("likely");
		expect(w("5.0").kind).toBe("likely");
		expect(w("4.9").kind).toBe("none");
	});

	it("looks at every row when the proposal does not say when it was made", () => {
		expect(of([dep(NONCE - 3_600_000)], deposit, null).kind).toBe("likely");
	});
});
