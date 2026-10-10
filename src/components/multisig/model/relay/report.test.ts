import type { Hex } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, NOW } from "#/test/keys";
import { eventRow } from "#/test/relayRows";
import type { RowProposal } from "../chain/match";
import { carriedOutOf, REPORT_AFTER_MS, reportKey, reportsDue } from "./report";
import type { ProposalStatus } from "./rows";

const D1 = `0x${"d1".repeat(32)}` as Hex;
const D2 = `0x${"d2".repeat(32)}` as Hex;
const TX1 = `0x${"71".repeat(32)}` as Hex;
const TX2 = `0x${"72".repeat(32)}` as Hex;
const matched = (digest: Hex): RowProposal => ({ kind: "matched", digest });
const row = (hash: string, match: RowProposal, age = 60_000) => ({
	time: NOW - age,
	hash,
	match,
});
const due = (
	rows: ReturnType<typeof row>[],
	status: Partial<Record<Hex, ProposalStatus>>,
	told: string[] = [],
) =>
	reportsDue({
		rows,
		statusOf: (d) => status[d] ?? null,
		now: NOW,
		told: new Set(told),
	});

describe("reportsDue", () => {
	it("reports a transfer matched to a proposal the relay still holds as open", () => {
		expect(due([row(TX1, matched(D1))], { [D1]: "open" })).toEqual([
			{ digest: D1, txHash: TX1 },
		]);
	});
	it("also when it was withdrawn or declined: what happened on chain is what happened", () => {
		expect(due([row(TX1, matched(D1))], { [D1]: "withdrawn" })).toHaveLength(1);
		expect(due([row(TX1, matched(D1))], { [D1]: "declined" })).toHaveLength(1);
	});
	it("says nothing about a proposal that is already settled, unknown to the relay, or of an unknown status", () => {
		for (const status of ["accepted", "carried_out", "unknown"] as const)
			expect(due([row(TX1, matched(D1))], { [D1]: status })).toEqual([]);
		expect(due([row(TX1, matched(D1))], {})).toEqual([]);
	});
	it("only reports what this browser matched for certain", () => {
		const others: RowProposal[] = [
			{ kind: "none" },
			{ kind: "checking" },
			{ kind: "unchecked" },
			{ kind: "not-applicable" },
			{ kind: "ambiguous", digests: [D1, D2] },
		];
		expect(
			due(
				others.map((m) => row(TX1, m)),
				{ [D1]: "open", [D2]: "open" },
			),
		).toEqual([]);
	});
	it("gives the finaliser's own result a moment to be recorded first", () => {
		const fresh = row(TX1, matched(D1), REPORT_AFTER_MS - 1);
		expect(due([fresh], { [D1]: "open" })).toEqual([]);
		expect(
			due([row(TX1, matched(D1), REPORT_AFTER_MS)], { [D1]: "open" }),
		).toHaveLength(1);
	});
	it("files each claim once, and one claim per proposal", () => {
		const told = reportKey({ digest: D1, txHash: TX1 });
		expect(due([row(TX1, matched(D1))], { [D1]: "open" }, [told])).toEqual([]);
		expect(
			due(
				[row(TX1, matched(D1)), row(TX2, matched(D1)), row(TX2, matched(D2))],
				{
					[D1]: "open",
					[D2]: "open",
				},
			),
		).toEqual([
			{ digest: D1, txHash: TX1 },
			{ digest: D2, txHash: TX2 },
		]);
	});
	it("never reports a hash that is not a transaction's", () => {
		for (const hash of [
			"0x12",
			`0x${"0".repeat(64)}`,
			"",
			`0x${"g".repeat(64)}`,
		])
			expect(due([row(hash, matched(D1))], { [D1]: "open" })).toEqual([]);
		// written in capitals, it is the same transaction
		expect(
			due([row(TX1.toUpperCase().replace("0X", "0x"), matched(D1))], {
				[D1]: "open",
			}),
		).toEqual([{ digest: D1, txHash: TX1 }]);
	});
});

describe("carriedOutOf", () => {
	it("reads the transaction and who noticed from the relay's entry", () => {
		const e = eventRow("proposal_carried_out", {
			id: 9,
			digest: D1,
			data: { tx_hash: TX1, tx_time: 1791400180792, reported_by: B },
		});
		expect(
			carriedOutOf([
				eventRow("proposal_created", { id: 1, digest: D1, actor: A }),
				e,
			]),
		).toEqual({
			txHash: TX1,
			txTime: 1791400180792,
			reportedBy: B,
			at: e.at,
		});
	});
	it("is null without such an entry, and tolerant of one that is malformed", () => {
		expect(carriedOutOf([])).toBeNull();
		expect(
			carriedOutOf([eventRow("signature_added", { digest: D1 })]),
		).toBeNull();
		expect(
			carriedOutOf([
				eventRow("proposal_carried_out", {
					digest: D1,
					data: { tx_hash: "0x12", tx_time: "soon", reported_by: "someone" },
				}),
			]),
		).toMatchObject({ txHash: null, txTime: null, reportedBy: null });
	});
	it("takes the newest when there is more than one", () => {
		expect(
			carriedOutOf([
				eventRow("proposal_carried_out", {
					id: 3,
					digest: D1,
					data: { tx_hash: TX1 },
				}),
				eventRow("proposal_carried_out", {
					id: 7,
					digest: D1,
					data: { tx_hash: TX2 },
				}),
			])?.txHash,
		).toBe(TX2);
	});
});
