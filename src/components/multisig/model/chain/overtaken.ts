/**
 * Whether a pending USDC send has been shut out by a send the tool has no
 * proposal for: one made with another tool, or by a co-signer's script.
 *
 * Hyperliquid takes an account's USDC sends only in the order of their
 * numbers (see the core's `multisig/order`). The proposals on record tell
 * about sends made here. For the rest there is the account's ledger: each
 * row has the transaction's hash, and the explorer returns the action behind
 * it, number included.
 */
import {
	type ExplorerTx,
	type LedgerRow,
	orderMark,
	overtakenBy,
} from "@hl-tools/core";
import { LANDS_BEFORE_NONCE_MS, sameAction } from "./match";

/** The ledger entry a `usdSend` leaves. */
const SEND_ROW = "internalTransfer";

/** Rows looked up at most: the newest ones decide. */
export const LATER_SENDS_MAX = 8;

/**
 * Ledger rows whose transaction could carry a number above the pending
 * send's: USDC sends that left the account no earlier than a day before that
 * number (an action lands at most a day ahead of its own number). Newest
 * first, at most `LATER_SENDS_MAX`. Empty for an action that is not ordered.
 */
export function laterSends(
	ledger: readonly LedgerRow[],
	action: unknown,
): LedgerRow[] {
	const mine = orderMark(action);
	if (!mine) return [];
	return ledger
		.filter(
			(r) =>
				r.type === SEND_ROW &&
				r.direction === "out" &&
				r.time > mine.time - LANDS_BEFORE_NONCE_MS,
		)
		.sort((a, b) => b.time - a.time)
		.slice(0, LATER_SENDS_MAX);
}

/**
 * The transaction that shuts the pending send out, if one of these does: a
 * send of the same account that went through, with a number that is not
 * smaller. The pending send's own transaction (it was carried out) is not
 * one that shuts it out.
 */
export function shutOutByTx(
	action: unknown,
	account: string,
	txs: readonly ExplorerTx[],
): ExplorerTx | null {
	const done = txs
		.filter(
			(tx) =>
				tx.error === null &&
				tx.user.toLowerCase() === account.toLowerCase() &&
				!sameAction(tx.action, action),
		)
		.map((tx) => ({ action: tx.action, tx }));
	return overtakenBy(action, done)?.tx ?? null;
}
