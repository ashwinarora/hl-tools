/**
 * From relay rows to a proposal this browser is willing to show: the stored
 * document is decoded and its digest recomputed by the core, the row's columns
 * must agree with it, and every stored signature must recover to the signer
 * it is filed under. What fails is dropped and reported. The relay can
 * withhold a proposal or a signature; it cannot make this function accept one.
 */
import {
	type Address,
	classifySignatures,
	decodeProposal,
	deepEqual,
	encodeProposal,
	fromPlain,
	type Hex,
	type Issue,
	issue,
	mergeProposals,
	type PlainJson,
	type Policy,
	type Proposal,
	type ProposalSignature,
	type Receipt,
	stringifyJson,
	toPlain,
	tryParseJson,
} from "@hl-tools/core";
import { betterReceipt } from "../history";
import type { EventRow, ProposalRow, ReceiptRow } from "./rows";

export interface RelayProposal {
	readonly row: ProposalRow;
	/** The document with the signatures that verified and the best receipt. */
	readonly proposal: Proposal;
}

export interface Assembled {
	readonly assembled: RelayProposal | null;
	readonly issues: readonly Issue[];
}

/** The document as it is shared: no signatures, no receipt (they are rows of their own). */
export function bareDocument(p: Proposal): string {
	return encodeProposal({ ...p, signatures: [], receipt: null });
}

/** The exchange's answer as the text stored in a receipt row. */
export function receiptText(receipt: Receipt): string {
	return stringifyJson(fromPlain(receipt.response, true), 0);
}

export function receiptFromRow(r: ReceiptRow): Receipt {
	const parsed = tryParseJson(r.response);
	// text that is not JSON (it should always be) is kept as a string
	const response: PlainJson = parsed.ok ? toPlain(parsed.node) : r.response;
	return {
		submittedAt: r.submittedAt,
		signatureChainId: r.signatureChainId,
		outerSignature: { r: r.outerR, s: r.outerS, v: r.outerV },
		httpStatus: r.httpStatus,
		response,
	};
}

export async function assembleProposal(
	row: ProposalRow,
	opts: { now?: number } = {},
): Promise<Assembled> {
	const decoded = decodeProposal(row.document, opts);
	const p = decoded.proposal;
	if (!p) {
		return {
			assembled: null,
			issues: [
				issue(
					"relay.row_invalid",
					"error",
					"A shared proposal is not one this page can read, and was ignored. Ask its proposer to share it again.",
				),
				...decoded.issues,
			],
		};
	}
	// `decodeProposal` recomputed the digest from the payload; the row must be filed under it
	const agrees =
		p.digest === row.digest &&
		p.payload.network === row.network &&
		p.payload.multiSigUser === row.treasury &&
		p.payload.outerSigner === row.finaliser &&
		p.payload.nonce === row.nonce &&
		p.signatures.length === 0 &&
		p.receipt === null;
	if (!agrees) {
		return {
			assembled: null,
			issues: [
				issue(
					"relay.row_mismatch",
					"error",
					"A shared proposal did not match its own details and was ignored. Nothing needs doing; ask its proposer to share it again if it is missing.",
				),
			],
		};
	}

	const issues: Issue[] = decoded.issues.filter(
		(i) => i.code !== "proposal.large",
	);
	const claimed: ProposalSignature[] = row.signatures.map((s) => ({
		signer: s.signer,
		r: s.r,
		s: s.s,
		v: s.v,
		at: s.createdAt,
	}));
	// merging with the bare copy runs every signature through recovery
	const merged = await mergeProposals({ ...p, signatures: claimed }, p);
	/* v8 ignore next 3 -- equal digests always merge */
	if (!merged.merged) {
		return { assembled: null, issues: [...issues, ...merged.issues] };
	}
	const dropped = merged.issues.filter(
		(i) => i.code === "merge.signature_dropped",
	);
	// whose they were filed under: the claimed copy is the merge's first side
	const named = dropped.flatMap((i) => {
		const at = /^a\.signatures\[(\d+)\]$/.exec(i.path ?? "");
		const signer = at ? claimed[Number(at[1])]?.signer : undefined;
		return signer ? [`${signer.slice(0, 6)}…${signer.slice(-4)}`] : [];
	});
	const under =
		named.length === dropped.length ? ` (filed under ${named.join(", ")})` : "";
	if (dropped.length > 0) {
		issues.push(
			issue(
				"relay.signature_dropped",
				"warning",
				dropped.length === 1
					? `1 stored signature${under} does not verify and was ignored.`
					: `${dropped.length} stored signatures${under} do not verify and were ignored.`,
				{
					fix: "Nothing to do: a signature that does not recover to its signer never counts. Its signer can sign again.",
				},
			),
		);
	}
	// A receipt on the relay is taken as the relay files it: it accepts one only
	// from the finaliser's own session (`receipt_before`). It is not checked
	// here the way a copy opened from a link or a file is (`saveProposal`),
	// because the check needs every signature that was sent, and the relay
	// holds only the ones their signers put there themselves: one that
	// travelled by link and was sent all the same would make a true receipt
	// fail. Until the relay keeps what was sent, or Hyperliquid's own record is
	// asked, this is the finaliser's report by the relay's word.
	const receipt = row.receipts
		.map(receiptFromRow)
		.reduce<Receipt | null>((best, r) => betterReceipt(best, r), null);
	return {
		assembled: { row, proposal: { ...merged.merged, receipt } },
		issues,
	};
}

/**
 * Signers whose latest signature event for this proposal is a removal: they
 * took their signature back, so a copy of it lingering in some browser's
 * history must not be shown as theirs again.
 */
export function removedSigners(
	events: readonly EventRow[],
	digest: Hex,
): Set<Address> {
	const last = new Map<Address, { id: number; removed: boolean }>();
	for (const e of events) {
		if (e.digest !== digest || !e.actor) continue;
		if (e.kind !== "signature_added" && e.kind !== "signature_removed")
			continue;
		const seen = last.get(e.actor);
		if (!seen || e.id > seen.id) {
			last.set(e.actor, { id: e.id, removed: e.kind === "signature_removed" });
		}
	}
	return new Set(
		[...last].filter(([, v]) => v.removed).map(([signer]) => signer),
	);
}

export interface Effective {
	readonly proposal: Proposal | null;
	readonly issues: readonly Issue[];
}

/**
 * What the page shows: the relay's copy merged with this browser's copy.
 * Signatures only this browser holds stay (a co-signer may have signed from a
 * link), except those of signers who took theirs back on the relay.
 */
export async function effectiveProposal(
	relay: Proposal | null,
	local: Proposal | null,
	removed: ReadonlySet<Address>,
): Promise<Effective> {
	if (!relay) return { proposal: local, issues: [] };
	if (!local) return { proposal: relay, issues: [] };
	if (!deepEqual(relay.payload, local.payload)) {
		return {
			proposal: relay,
			issues: [
				issue(
					"relay.local_conflict",
					"error",
					"This browser holds another copy of this proposal with different extra fields (a vault address or an expiry), which signers do not sign. The shared copy is shown; the one in this browser was not merged.",
					{
						fix: "Compare both in the Multisig Inspector before signing anything.",
					},
				),
			],
		};
	}
	const merged = await mergeProposals(relay, local);
	/* v8 ignore next -- equal digests always merge */
	if (!merged.merged) return { proposal: relay, issues: merged.issues };
	const onRelay = new Set(relay.signatures.map((s) => s.signer));
	const signatures = merged.merged.signatures.filter(
		(s) => onRelay.has(s.signer) || !removed.has(s.signer),
	);
	return {
		proposal: {
			...merged.merged,
			signatures,
			receipt: betterReceipt(relay.receipt, local.receipt),
		},
		issues: merged.issues,
	};
}

/**
 * Keeps the previous object when nothing changed, so a refetch that returns
 * the same proposal does not restart everything that depends on its identity.
 */
export function stabilise(
	prev: Proposal | null,
	next: Proposal | null,
): Proposal | null {
	if (prev && next && encodeProposal(prev) === encodeProposal(next))
		return prev;
	return next;
}

/**
 * Distinct signers whose signature verifies and who are in `signers`. Used
 * for lists and counts against the relay's stored signer copy; the proposal
 * page judges readiness against the live chain instead.
 */
export async function countedSigners(
	proposal: Proposal,
	signers: readonly Address[],
	threshold: number,
): Promise<Address[]> {
	const policy: Policy = {
		authorizedUsers: [...signers].sort(),
		threshold,
		observedAt: 0,
	};
	const classified = await classifySignatures(proposal, policy);
	const out: Address[] = [];
	for (const c of classified) {
		if (
			c.status === "valid-authorized" &&
			c.recovered &&
			!out.includes(c.recovered)
		) {
			out.push(c.recovered);
		}
	}
	return out;
}
