import type { ExplorerTx } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	accountsOf,
	indexTxs,
	type ListState,
	listedTx,
	listState,
	rereadDue,
	routeTx,
} from "./accountTxs";

const T = `0x${"1".repeat(40)}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const tx = (n: number, over: Partial<ExplorerTx> = {}): ExplorerTx => ({
	time: 1_791_800_000_000 + n,
	user: T,
	action: { type: "usdClassTransfer", amount: "1", toPerp: true, nonce: n },
	block: 730_000_000 + n,
	hash: hash(n),
	error: null,
	...over,
});
const read = (at: number, ...ns: number[]): ListState => ({
	kind: "read",
	at,
	txs: indexTxs(ns.map((n) => tx(n))),
});

describe("indexTxs", () => {
	it("finds a transaction by its id, whatever the case, and leaves out an entry without one", () => {
		const list = indexTxs([
			tx(1),
			tx(2, { hash: hash(2).toUpperCase().replace("0X", "0x") }),
			tx(3, { hash: "" }),
		]);
		expect(list.size).toBe(2);
		expect(list.get(hash(1))?.action.nonce).toBe(1);
		expect(list.get(hash(2))?.action.nonce).toBe(2);
		expect(
			listedTx({ kind: "read", at: 0, txs: list }, hash(2).toUpperCase())
				?.block,
		).toBe(730_000_002);
		expect(listedTx({ kind: "read", at: 0, txs: list }, hash(9))).toBeNull();
		expect(listedTx({ kind: "reading" }, hash(1))).toBeNull();
	});
});

describe("routeTx: from the account's list, or a request of its own", () => {
	const SINCE = 1_000;

	it("takes a transaction the list holds, with nothing more to ask", () => {
		expect(routeTx(hash(1), SINCE, read(2_000, 1, 2))).toBe("listed");
		// also from a list read before it was wanted: it is there all the same
		expect(routeTx(hash(1), SINCE, read(500, 1))).toBe("listed");
	});

	it("waits while the list is not there yet", () => {
		expect(routeTx(hash(1), SINCE, { kind: "unread" })).toBe("wait");
		expect(routeTx(hash(1), SINCE, { kind: "reading" })).toBe("wait");
	});

	it("asks about the one transaction when a list read since it was wanted does not hold it", () => {
		// older than what the list reaches back to
		expect(routeTx(hash(9), SINCE, read(2_000, 1, 2))).toBe("single");
		expect(routeTx(hash(9), SINCE, read(SINCE, 1))).toBe("single");
	});

	it("gives the list one more chance at a transaction wanted after it was read", () => {
		// a transfer that landed while the page was open
		expect(routeTx(hash(9), 3_000, read(2_000, 1, 2))).toBe("wait");
	});

	it("falls back to the one transaction when the list could not be read", () => {
		expect(routeTx(hash(1), SINCE, { kind: "failed", at: 2_000 })).toBe(
			"single",
		);
		// a failure from before this was wanted is not an answer about it
		expect(routeTx(hash(1), 3_000, { kind: "failed", at: 2_000 })).toBe("wait");
	});
});

describe("rereadDue: when an account's list is read again", () => {
	const wanted = (...pairs: [number, number][]) =>
		pairs.map(([n, since]) => ({ hash: hash(n), since }));

	it("is not due while everything wanted is in the list, or was wanted before it was read", () => {
		expect(rereadDue(read(2_000, 1, 2), wanted([1, 1_000], [2, 1_000]))).toBe(
			false,
		);
		// not in the list, but the list was read after it was wanted: its own request
		expect(rereadDue(read(2_000, 1), wanted([9, 1_000]))).toBe(false);
		expect(rereadDue(read(2_000, 1), [])).toBe(false);
	});

	it("is due once for a transaction wanted after the list was read", () => {
		const list = read(2_000, 1);
		expect(rereadDue(list, wanted([1, 1_000], [9, 3_000]))).toBe(true);
		// the read that follows answers for it, whatever it holds: never twice
		expect(rereadDue(read(3_500, 1), wanted([1, 1_000], [9, 3_000]))).toBe(
			false,
		);
		expect(routeTx(hash(9), 3_000, read(3_500, 1))).toBe("single");
		expect(rereadDue(read(3_500, 1, 9), wanted([9, 3_000]))).toBe(false);
		expect(routeTx(hash(9), 3_000, read(3_500, 1, 9))).toBe("listed");
	});

	it("tries a list that failed once more for something wanted later, and not again", () => {
		expect(rereadDue({ kind: "failed", at: 2_000 }, wanted([9, 1_000]))).toBe(
			false,
		);
		expect(rereadDue({ kind: "failed", at: 2_000 }, wanted([9, 3_000]))).toBe(
			true,
		);
		expect(rereadDue({ kind: "failed", at: 3_500 }, wanted([9, 3_000]))).toBe(
			false,
		);
	});

	it("is never due while a read is on its way, or before the first", () => {
		expect(rereadDue({ kind: "reading" }, wanted([9, 3_000]))).toBe(false);
		expect(rereadDue({ kind: "unread" }, wanted([9, 3_000]))).toBe(false);
	});

	it("never asks in a loop: every state leads to an answer in at most one more read", () => {
		// whatever the list holds after a read made at or after `since`,
		// the transaction is either taken from it or asked about by itself
		for (const since of [0, 1_000, 5_000])
			for (const at of [since, since + 1, since + 60_000])
				for (const list of [
					read(at),
					read(at, 1),
					read(at, 9),
					{ kind: "failed", at } as ListState,
				]) {
					expect(rereadDue(list, wanted([9, since]))).toBe(false);
					expect(["listed", "single"]).toContain(routeTx(hash(9), since, list));
				}
	});
});

describe("listState: a read, in the rule's terms", () => {
	const txs = indexTxs([tx(1)]);
	it("is unread before anything was tried, and reading while a try is on its way", () => {
		expect(
			listState({ txs: undefined, reading: false, readAt: 0, failedAt: 0 }),
		).toEqual({ kind: "unread" });
		expect(
			listState({ txs: undefined, reading: true, readAt: 0, failedAt: 0 }),
		).toEqual({ kind: "reading" });
	});
	it("keeps a list at hand while it is read again: what it answered is not taken back", () => {
		const again = listState({ txs, reading: true, readAt: 5, failedAt: 0 });
		expect(again).toEqual({ kind: "read", at: 5, txs, again: true });
		// the transaction it holds stays answered for the length of the request
		expect(routeTx(hash(1), 1, again)).toBe("listed");
		expect(listedTx(again, hash(1))?.block).toBe(730_000_001);
		// the one that made it read again waits for the answer, with no request of its own
		expect(routeTx(hash(9), 6, again)).toBe("wait");
		expect(routeTx(hash(9), 1, again)).toBe("wait");
		// and no second read is started on top of the first
		expect(rereadDue(again, [{ hash: hash(9), since: 6 }])).toBe(false);
	});
	it("is read with the moment of the last try, also when that try failed and the older list is kept", () => {
		expect(listState({ txs, reading: false, readAt: 5, failedAt: 0 })).toEqual({
			kind: "read",
			at: 5,
			txs,
		});
		expect(listState({ txs, reading: false, readAt: 5, failedAt: 9 })).toEqual({
			kind: "read",
			at: 9,
			txs,
		});
	});
	it("is failed when no list was ever read", () => {
		expect(
			listState({ txs: null, reading: false, readAt: 0, failedAt: 7 }),
		).toEqual({ kind: "failed", at: 7 });
	});
});

describe("accountsOf", () => {
	it("names each account once, however it is written, and none for nothing", () => {
		const B = `0x${"b".repeat(40)}`;
		expect(
			accountsOf([
				{ account: T, hash: hash(1) },
				{ account: B.toUpperCase().replace("0X", "0x"), hash: hash(2) },
				{ account: B, hash: hash(3) },
				{ account: "", hash: hash(4) },
			]),
		).toEqual([T, B.toUpperCase().replace("0X", "0x")]);
		expect(accountsOf([])).toEqual([]);
	});
});
