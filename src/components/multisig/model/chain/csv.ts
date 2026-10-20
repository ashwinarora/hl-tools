import type {
	FillRow,
	FundingRow,
	LedgerRow,
	OrderHistoryRow,
} from "@hl-tools/core";
import { Decimal } from "@hl-tools/core";
import { type CsvCell, csvTime } from "#/lib/download";
import {
	fillValue,
	ledgerAmount,
	ledgerFeePaid,
	ledgerWhat,
	orderSide,
	orderTypeText,
} from "./columns";
import type { RowProposal } from "./match";

/** A figure as digits, whatever form Hyperliquid wrote it in ("1e-7" is 0.0000001). */
const canonical = (v: string): string => Decimal.tryParse(v)?.toString() ?? v;

/**
 * The "On Hyperliquid" tables as CSV: the rows the page holds, each figure
 * to its last decimal (never cut or rounded), moments in UTC.
 * Pure: `toCsv` writes them.
 */
export interface CsvTable {
	readonly columns: readonly string[];
	readonly rows: readonly (readonly CsvCell[])[];
}

const oldestFirst = <T>(rows: readonly T[], time: (r: T) => number): T[] =>
	[...rows].sort((a, b) => time(a) - time(b));

/**
 * The proposal a row is tied to, as far as the page could tell, in the
 * words of its "Proposal" cell: a row not checked yet never reads as one
 * with no proposal.
 */
export function proposalCell(p: RowProposal): string {
	switch (p.kind) {
		case "matched":
			return p.digest;
		// a vault action carries no number: never more than likely
		case "likely":
			return `likely ${p.digest}`;
		case "ambiguous":
			return `one of ${p.digests.join(" ")}`;
		case "none":
			return "none on record";
		case "checking":
		case "unchecked":
			return "not checked";
		case "own-step":
			return "Hyperliquid's own step";
		default:
			return "";
	}
}

export function transfersCsv(
	rows: readonly LedgerRow[],
	proposalOf: (r: LedgerRow) => RowProposal,
): CsvTable {
	return {
		columns: [
			"Time (UTC)",
			"What",
			"Account",
			"Amount",
			"Token",
			"Fee",
			"Fee token",
			"Requested",
			"Transaction",
			"Proposal",
		],
		rows: oldestFirst(rows, (r) => r.time).map((r) => {
			const what = ledgerWhat(r);
			const fee = ledgerFeePaid(r);
			return [
				csvTime(r.time),
				what.text,
				what.party,
				ledgerAmount(r),
				r.token,
				// every figure written out in full, never in exponent form (audit F-053)
				fee === null ? null : canonical(fee),
				fee === null ? null : r.feeToken,
				r.requested === null ? null : canonical(r.requested),
				r.hash,
				proposalCell(proposalOf(r)),
			];
		}),
	};
}

export function tradesCsv(rows: readonly FillRow[]): CsvTable {
	return {
		columns: [
			"Time (UTC)",
			"Market",
			"Side",
			"Price",
			"Size",
			"Value",
			"Fee",
			"Fee token",
			"Closed profit",
			"Transaction",
		],
		rows: oldestFirst(rows, (r) => r.time).map((r) => [
			csvTime(r.time),
			r.coin,
			r.dir,
			r.px,
			r.sz,
			fillValue(r),
			r.fee,
			r.feeToken,
			r.closedPnl,
			r.hash,
		]),
	};
}

export function ordersCsv(rows: readonly OrderHistoryRow[]): CsvTable {
	return {
		columns: [
			"Time (UTC)",
			"Market",
			"Side",
			"Type",
			"Price",
			"Size",
			"Status",
			"Order id",
		],
		rows: oldestFirst(rows, (r) => r.statusTimestamp).map((r) => [
			csvTime(r.statusTimestamp),
			r.coin,
			orderSide(r.side),
			orderTypeText(r),
			r.limitPx,
			r.origSz,
			r.status,
			r.oid,
		]),
	};
}

export function fundingCsv(rows: readonly FundingRow[]): CsvTable {
	return {
		columns: [
			"Time (UTC)",
			"Market",
			"Position size",
			"Payment (USDC)",
			"Rate",
		],
		rows: oldestFirst(rows, (r) => r.time).map((r) => [
			csvTime(r.time),
			r.coin,
			r.szi,
			r.usdc,
			r.fundingRate,
		]),
	};
}

/** "hl-transfers-testnet-0x1234abcd-2026-10-14.csv": what, where, whose, when. */
export function csvFilename(
	what: string,
	network: string,
	address: string,
	now: number,
): string {
	return `hl-${what}-${network}-${address.slice(0, 10)}-${new Date(now).toISOString().slice(0, 10)}.csv`;
}
