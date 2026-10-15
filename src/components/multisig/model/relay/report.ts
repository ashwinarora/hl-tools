/**
 * Telling the relay that a proposal was carried out without it.
 *
 * This browser has already looked the transaction up and compared its action
 * with the proposal's (see model/chain/match). The relay will do the same
 * check itself before it believes anything, so a report is only a pointer:
 * "look at this transaction for that proposal".
 */
import type { Address, Hex } from "@hl-tools/core";
import type { RowProposal } from "../chain/match";
import { addressList, type EventRow, type ProposalStatus } from "./rows";

/**
 * How old a ledger row must be before it is reported. A finaliser who
 * submitted through the tool records the result within a second or two; a
 * row that fresh is almost always theirs, and reporting it would only be
 * answered with "already accepted".
 */
export const REPORT_AFTER_MS = 15_000;

export interface ReportDue {
	readonly digest: Hex;
	readonly txHash: Hex;
}

const TX_HASH = /^0x[0-9a-f]{64}$/;
const ZERO_HASH = /^0x0+$/;
/** Statuses a carried-out proposal can still be in on the relay. */
const UNSETTLED: ReadonlySet<ProposalStatus> = new Set([
	"open",
	"withdrawn",
	"declined",
]);

export const reportKey = (r: ReportDue): string => `${r.digest}:${r.txHash}`;

/** The reports to file now: one per proposal, for rows matched to a proposal the relay still holds as not carried out. */
export function reportsDue(i: {
	readonly rows: readonly {
		readonly time: number;
		readonly hash: string;
		readonly match: RowProposal;
	}[];
	/** The relay's status of a proposal; null when the relay does not have it. */
	readonly statusOf: (digest: Hex) => ProposalStatus | null;
	readonly now: number;
	/** `reportKey`s already filed from this browser. */
	readonly told: ReadonlySet<string>;
}): ReportDue[] {
	const out = new Map<Hex, ReportDue>();
	for (const row of i.rows) {
		if (row.match.kind !== "matched") continue;
		const digest = row.match.digest;
		const txHash = row.hash.toLowerCase() as Hex;
		if (!TX_HASH.test(txHash) || ZERO_HASH.test(txHash)) continue;
		if (i.now - row.time < REPORT_AFTER_MS) continue;
		const status = i.statusOf(digest);
		if (!status || !UNSETTLED.has(status)) continue;
		const due = { digest, txHash };
		if (i.told.has(reportKey(due)) || out.has(digest)) continue;
		out.set(digest, due);
	}
	return [...out.values()];
}

/** What the relay recorded when it closed a proposal as carried out outside the tool. */
export interface CarriedOut {
	readonly txHash: Hex | null;
	/** The transaction's time on Hyperliquid, unix ms. */
	readonly txTime: number | null;
	/** The signer whose browser noticed. */
	readonly reportedBy: Address | null;
	/** When the relay closed it. */
	readonly at: number;
}

/** The newest "carried out" entry among a proposal's events, if there is one. */
export function carriedOutOf(events: readonly EventRow[]): CarriedOut | null {
	const e = [...events]
		.filter((x) => x.kind === "proposal_carried_out")
		.sort((a, b) => b.id - a.id)[0];
	if (!e) return null;
	const hash = e.data.tx_hash;
	const time = e.data.tx_time;
	return {
		txHash:
			typeof hash === "string" && TX_HASH.test(hash) ? (hash as Hex) : null,
		txTime:
			typeof time === "number" && Number.isSafeInteger(time) ? time : null,
		reportedBy: addressList([e.data.reported_by])[0] ?? null,
		at: e.at,
	};
}
