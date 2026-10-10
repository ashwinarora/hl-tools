/**
 * Relay rows built from test proposals, for the relay model's suites: the
 * parsed form the model works with, and the raw form PostgREST returns.
 */
import type { Proposal } from "@hl-tools/core";
import {
	bareDocument,
	receiptText,
} from "#/components/multisig/model/relay/assemble";
import type {
	EventKind,
	EventRow,
	ProposalRow,
} from "#/components/multisig/model/relay/rows";
import { A, NOW } from "./keys";

const DAY = 86_400_000;

/** The row the relay would hold for `p`: bare document, its signatures and receipt as child rows. */
export function rowFor(
	p: Proposal,
	over: Partial<ProposalRow> = {},
): ProposalRow {
	return {
		network: p.payload.network,
		treasury: p.payload.multiSigUser,
		digest: p.digest,
		document: bareDocument(p),
		createdBy: p.meta.createdBy ?? A,
		finaliser: p.payload.outerSigner,
		nonce: p.payload.nonce,
		expiresAt: p.payload.nonce + 2 * DAY,
		status: "open",
		closedAt: null,
		createdAt: NOW,
		signatures: p.signatures.map((s) => ({
			signer: s.signer,
			r: s.r,
			s: s.s,
			v: s.v,
			createdAt: s.at ?? NOW,
		})),
		ending: null,
		receipts: p.receipt
			? [
					{
						submittedAt: p.receipt.submittedAt,
						submittedBy: p.payload.outerSigner,
						signatureChainId: p.receipt.signatureChainId,
						outerR: p.receipt.outerSignature.r,
						outerS: p.receipt.outerSignature.s,
						outerV: p.receipt.outerSignature.v,
						httpStatus: p.receipt.httpStatus,
						response: receiptText(p.receipt),
						accepted: false,
						recordedAt: NOW,
					},
				]
			: [],
		...over,
	};
}

const iso = (ms: number) => new Date(ms).toISOString();

/** `row` as PostgREST returns it: snake_case, ISO timestamps, embedded children. */
export function rawProposal(row: ProposalRow): Record<string, unknown> {
	return {
		network: row.network,
		treasury: row.treasury,
		digest: row.digest,
		document: row.document,
		created_by: row.createdBy,
		finaliser: row.finaliser,
		nonce: row.nonce,
		expires_at: iso(row.expiresAt),
		status: row.status,
		closed_at: row.closedAt === null ? null : iso(row.closedAt),
		created_at: iso(row.createdAt),
		signatures: row.signatures.map((s) => ({
			signer: s.signer,
			r: s.r,
			s: s.s,
			v: s.v,
			created_at: iso(s.createdAt),
		})),
		endings: row.ending
			? {
					kind: row.ending.kind,
					ended_by: row.ending.endedBy,
					ended_at: iso(row.ending.endedAt),
				}
			: null,
		receipts: row.receipts.map((r) => ({
			submitted_at: r.submittedAt,
			submitted_by: r.submittedBy,
			signature_chain_id: r.signatureChainId,
			outer_r: r.outerR,
			outer_s: r.outerS,
			outer_v: r.outerV,
			http_status: r.httpStatus,
			response: r.response,
			accepted: r.accepted,
			recorded_at: iso(r.recordedAt),
		})),
	};
}

let nextEvent = 1;
export function eventRow(
	kind: EventKind,
	over: Partial<EventRow> = {},
): EventRow {
	const id = over.id ?? nextEvent++;
	return {
		id,
		network: "testnet",
		treasury:
			"0x0000000000000000000000000000000000000abc" as EventRow["treasury"],
		digest: null,
		kind,
		actor: null,
		data: {},
		at: NOW + id * 1000,
		...over,
	};
}
