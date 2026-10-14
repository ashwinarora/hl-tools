import { readFileSync } from "node:fs";
import {
	ABSTRACTION_ENVELOPE_CODES,
	type ExplorerTx,
	type PlainObject,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { accountTxs } from "./accountTxs";
import { LANDS_BEFORE_NONCE_MS } from "./match";
import {
	asListed,
	onRecord,
	RECORD_LAG_MS,
	type RecordList,
	type RecordQuestion,
	recordQuestion,
	recordRereadDue,
	unnumbered,
} from "./record";

const fixture = (name: string) =>
	JSON.parse(
		readFileSync(
			new URL(
				`../../../../../packages/hl-core/fixtures/multisig/${name}.json`,
				import.meta.url,
			),
			"utf8",
		),
	);

/** What the explorer listed for two lab multi-sigs on testnet (complete lists). */
const recorded = fixture("explorer-record") as {
	accounts: {
		account: string;
		listed: number;
		truncated: boolean;
		oldest: number;
		txs: ExplorerTx[];
	}[];
};
const listOf = (i: number, readAt = Number.MAX_SAFE_INTEGER): RecordList => {
	const a = recorded.accounts[i];
	if (!a) throw new Error("no such account");
	return {
		state: "read",
		txs: {
			...accountTxs({ txs: a.txs, truncated: a.truncated }),
			oldest: a.oldest,
		},
		readAt,
	};
};
const LONG_NAME: Record<string, string> = Object.fromEntries(
	Object.entries(ABSTRACTION_ENVELOPE_CODES).map(([k, v]) => [v, k]),
);
/** The action as its signers signed it: a mode switch by its name. */
const asSigned = (action: PlainObject): PlainObject =>
	action.type === "userSetAbstraction" && typeof action.abstraction === "string"
		? {
				...action,
				abstraction: LONG_NAME[action.abstraction] ?? action.abstraction,
			}
		: action;
const numberOf = (tx: ExplorerTx): number => {
	const n = tx.action.nonce ?? tx.action.time;
	return typeof n === "number" ? n : tx.time;
};
const ask = (
	account: string,
	tx: ExplorerTx,
	over: Partial<RecordQuestion> = {},
): RecordQuestion => ({
	account,
	action: asSigned(tx.action as PlainObject),
	nonce: numberOf(tx),
	sentAt: tx.time,
	...over,
});
const NOW = 1_800_000_000_000;

describe("finding a proposal on Hyperliquid's record", () => {
	it("finds every action that was carried out, under its own entry", () => {
		let checked = 0;
		recorded.accounts.forEach((a, i) => {
			for (const tx of a.txs.filter((t) => t.error === null)) {
				const verdict = onRecord(ask(a.account, tx), listOf(i), NOW);
				expect(verdict).toEqual(
					unnumbered(tx.action as PlainObject)
						? { kind: "likely", hash: tx.hash, time: tx.time }
						: { kind: "found", hash: tx.hash, time: tx.time },
				);
				checked++;
			}
		});
		expect(checked).toBeGreaterThan(20);
	});

	it("finds a mode switch as it was posted, by the letter Hyperliquid lists it with", () => {
		const modes = fixture("mode-switch") as {
			requests: {
				request: {
					nonce: number;
					action: { payload: { multiSigUser: string; action: PlainObject } };
				};
				answer: { status: string };
			}[];
		};
		const posted = modes.requests.find((r) => r.answer.status === "ok");
		if (!posted) throw new Error("no accepted switch");
		const { multiSigUser, action } = posted.request.action.payload;
		expect(action.abstraction).toBe("unifiedAccount");
		const i = recorded.accounts.findIndex((a) => a.account === multiSigUser);
		const verdict = onRecord(
			{
				account: multiSigUser,
				action,
				nonce: posted.request.nonce,
				sentAt: null,
			},
			listOf(i),
			NOW,
		);
		expect(verdict.kind).toBe("found");
		// compared as posted, it is not there
		expect(
			onRecord(
				{
					account: multiSigUser,
					action: { ...action, abstraction: "UNIFIED" },
					nonce: posted.request.nonce,
					sentAt: null,
				},
				listOf(i),
				NOW,
			).kind,
		).toBe("missing");
	});

	it("says a refused submission was refused, with Hyperliquid's reason", () => {
		const a = recorded.accounts[0];
		const tx = a?.txs.find(
			(t) => t.error !== null && t.action.type === "usdSend",
		);
		if (!a || !tx) throw new Error("no refused send");
		expect(onRecord(ask(a.account, tx), listOf(0), NOW)).toEqual({
			kind: "refused",
			hash: tx.hash,
			time: tx.time,
			error: tx.error,
		});
	});

	it("takes a vault entry for likely at most, and a refused one like it for nobody's", () => {
		const i = recorded.accounts.findIndex((a) =>
			a.txs.some((t) => t.action.type === "vaultTransfer" && t.error !== null),
		);
		const a = recorded.accounts[i];
		const refused = a?.txs.find(
			(t) => t.action.type === "vaultTransfer" && t.error !== null,
		);
		if (!a || !refused) throw new Error("no refused vault step");
		// nothing like it was carried out, and the list is complete
		expect(onRecord(ask(a.account, refused), listOf(i), NOW).kind).toBe(
			"missing",
		);
	});

	it("does not take another proposal's number, or another account's entry", () => {
		const a = recorded.accounts[0];
		const tx = a?.txs.find(
			(t) => t.error === null && t.action.type === "usdSend",
		);
		if (!a || !tx) throw new Error("no send");
		const other = { ...tx.action, time: (tx.action.time as number) + 1 };
		expect(
			onRecord(
				ask(a.account, tx, { action: other as PlainObject }),
				listOf(0),
				NOW,
			).kind,
		).toBe("missing");
		expect(
			onRecord(
				ask("0x00000000000000000000000000000000000000aa", tx),
				listOf(0),
				NOW,
			).kind,
		).toBe("missing");
	});
});

describe("how far Hyperliquid's record can answer", () => {
	const send = (n: number): ExplorerTx => ({
		time: n,
		user: "0xaa",
		action: { type: "usdSend", amount: "1", time: n },
		block: 1,
		hash: `0x${n.toString(16).padStart(64, "0")}`,
		error: null,
	});
	const list = (
		times: number[],
		truncated: boolean,
		readAt = NOW,
	): RecordList => ({
		state: "read",
		txs: accountTxs({ txs: times.map(send), truncated }),
		readAt,
	});
	const mine: RecordQuestion = {
		account: "0xAA",
		action: { type: "usdSend", amount: "1", time: 5_000 },
		nonce: 5_000,
		sentAt: NOW - 3_600_000,
	};

	it("says nothing is there only where the list reaches back past the earliest landing", () => {
		expect(onRecord(mine, list([NOW - 10], false), NOW).kind).toBe("missing");
		// cut off: only an oldest entry before the earliest landing proves absence
		const earliest = mine.nonce - LANDS_BEFORE_NONCE_MS;
		expect(onRecord(mine, list([NOW - 10, earliest], true), NOW).kind).toBe(
			"missing",
		);
		expect(onRecord(mine, list([NOW - 10, earliest + 1], true), NOW).kind).toBe(
			"too-old",
		);
		expect(onRecord(mine, list([], true), NOW).kind).toBe("too-old");
		// and the entry itself answers wherever it is
		expect(onRecord(mine, list([5_000, NOW - 10], true), NOW).kind).toBe(
			"found",
		);
	});

	it("waits a moment after a submission before a list without it means anything", () => {
		const sent = { ...mine, sentAt: NOW - 60_000 };
		expect(onRecord(sent, list([NOW - 10], false), NOW).kind).toBe("just-sent");
		// the window has passed, but the list was read inside it
		const later = NOW + RECORD_LAG_MS;
		expect(onRecord(sent, list([NOW - 10], false, NOW), later).kind).toBe(
			"checking",
		);
		expect(
			onRecord(
				sent,
				list([NOW - 10], false, NOW - 60_000 + RECORD_LAG_MS),
				later,
			).kind,
		).toBe("missing");
		// a report with no time gets no grace
		expect(
			onRecord({ ...mine, sentAt: null }, list([NOW - 10], false), NOW).kind,
		).toBe("missing");
	});

	it("says it is checking while the list is read, and unchecked when it could not be", () => {
		expect(onRecord(mine, { state: "reading" }, NOW).kind).toBe("checking");
		expect(onRecord(mine, { state: "failed" }, NOW).kind).toBe("unchecked");
	});

	it("reads the list again once it can tell, and once a minute while the explorer may lag", () => {
		const sent = { ...mine, sentAt: NOW - 60_000 };
		const early = list([NOW - 10], false, NOW - 30_000);
		// inside the window: at most once a minute
		expect(recordRereadDue(sent, early, NOW, NOW - 30_000)).toBe(false);
		expect(recordRereadDue(sent, early, NOW, NOW - 60_000)).toBe(true);
		// after the window, read too soon: once more
		const after = NOW - 60_000 + RECORD_LAG_MS + 1;
		expect(recordRereadDue(sent, early, after, after - 1)).toBe(true);
		// a list that answers, or a report without a time, asks for nothing
		expect(
			recordRereadDue(sent, list([5_000], false, NOW - 30_000), NOW, 0),
		).toBe(false);
		expect(recordRereadDue(mine, list([NOW - 10], false), NOW, 0)).toBe(false);
		expect(recordRereadDue(sent, { state: "reading" }, NOW, 0)).toBe(false);
	});
});

describe("the action as the explorer lists it", () => {
	it("writes a mode switch with its letter, in its place, and leaves the rest alone", () => {
		const signed = {
			type: "userSetAbstraction",
			user: "0xaa",
			abstraction: "disabled",
			nonce: 1,
		};
		expect(Object.keys(asListed(signed))).toEqual(Object.keys(signed));
		expect(asListed(signed).abstraction).toBe("i");
		expect(asListed({ ...signed, abstraction: "portfolio" }).abstraction).toBe(
			"portfolio",
		);
		expect(asListed({ ...signed, abstraction: "toString" }).abstraction).toBe(
			"toString",
		);
		const send = { type: "usdSend", amount: "1", time: 1 };
		expect(asListed(send)).toBe(send);
	});
});

describe("the question a proposal asks", () => {
	it("is its treasury, action and number, with the time its report gives", () => {
		const p = {
			payload: {
				multiSigUser: "0xaa",
				action: { type: "usdSend", time: 7 },
				nonce: 7,
			},
			receipt: { submittedAt: 99 },
		} as unknown as Parameters<typeof recordQuestion>[0];
		expect(recordQuestion(p)).toEqual({
			account: "0xaa",
			action: { type: "usdSend", time: 7 },
			nonce: 7,
			sentAt: 99,
		});
		expect(recordQuestion({ ...p, receipt: null }).sentAt).toBeNull();
		expect(recordQuestion(p, 5).sentAt).toBe(5);
	});
});
