/**
 * Proposal documents as text: deterministic encoding (fixed key order, exact
 * integer lexemes, no bigint in the output), strict decoding through
 * `validateProposal`, and merging two copies of the same proposal.
 */
import { type Issue, issue } from "../issues.ts";
import {
	fromPlain,
	type JsonEntry,
	type JsonNode,
	type JsonObject,
	parseJson,
	stringifyJson,
	toPlain,
} from "../json.ts";
import { PROPOSAL_SIZE_WARN_BYTES } from "../rules/multisig.ts";
import { innerDigest } from "./digest.ts";
import { validateProposal } from "./proposal.ts";
import { recoverInnerSigner } from "./signature.ts";
import type { Proposal, ProposalMeta, ProposalSignature } from "./types.ts";

const pos = { start: 0, end: 0 };
const obj = (entries: [string, JsonNode][]): JsonObject => ({
	kind: "object",
	entries: entries.map(
		([key, value]): JsonEntry => ({ key, keyStart: 0, value }),
	),
	...pos,
});
const plain = (v: unknown): JsonNode => fromPlain(v);

/**
 * Serialise a proposal. Key order is fixed by this function, not by the
 * object, so two equal proposals always encode to the same bytes. `pretty`
 * adds indentation for files; the compact form suits links and relays.
 */
export function encodeProposal(
	p: Proposal,
	opts: { pretty?: boolean } = {},
): string {
	const node = obj([
		["v", plain(1)],
		[
			"payload",
			obj([
				["network", plain(p.payload.network)],
				["multiSigUser", plain(p.payload.multiSigUser)],
				["outerSigner", plain(p.payload.outerSigner)],
				["action", plain(p.payload.action)],
				["nonce", plain(p.payload.nonce)],
				["vaultAddress", plain(p.payload.vaultAddress)],
				["expiresAfter", plain(p.payload.expiresAfter)],
			]),
		],
		["digest", plain(p.digest)],
		[
			"signatures",
			{
				kind: "array",
				items: p.signatures.map((s) =>
					obj([
						["signer", plain(s.signer)],
						["r", plain(s.r)],
						["s", plain(s.s)],
						["v", plain(s.v)],
						["at", plain(s.at)],
					]),
				),
				...pos,
			},
		],
		[
			"meta",
			obj([
				["kind", plain(p.meta.kind)],
				["title", plain(p.meta.title)],
				["note", plain(p.meta.note)],
				["createdBy", plain(p.meta.createdBy)],
				["createdAt", plain(p.meta.createdAt)],
				["supersedes", plain(p.meta.supersedes)],
				[
					"policyAtCreation",
					p.meta.policyAtCreation
						? obj([
								[
									"authorizedUsers",
									plain(p.meta.policyAtCreation.authorizedUsers),
								],
								["threshold", plain(p.meta.policyAtCreation.threshold)],
								["observedAt", plain(p.meta.policyAtCreation.observedAt)],
							])
						: plain(null),
				],
			]),
		],
		[
			"receipt",
			p.receipt
				? obj([
						["submittedAt", plain(p.receipt.submittedAt)],
						["signatureChainId", plain(p.receipt.signatureChainId)],
						[
							"outerSignature",
							obj([
								["r", plain(p.receipt.outerSignature.r)],
								["s", plain(p.receipt.outerSignature.s)],
								["v", plain(p.receipt.outerSignature.v)],
							]),
						],
						["httpStatus", plain(p.receipt.httpStatus)],
						// the exchange response is foreign JSON and may legitimately carry floats
						["response", fromPlain(p.receipt.response, true)],
					])
				: plain(null),
		],
	]);
	return stringifyJson(node, opts.pretty ? 2 : 0);
}

export interface DecodeResult {
	readonly proposal: Proposal | null;
	readonly issues: readonly Issue[];
}

/** Parse text with the order- and lexeme-preserving parser, then validate. */
export function decodeProposal(
	text: string,
	opts: { now?: number } = {},
): DecodeResult {
	const issues: Issue[] = [];
	if (text.length > PROPOSAL_SIZE_WARN_BYTES) {
		issues.push(
			issue(
				"proposal.large",
				"warning",
				`The document is ${text.length} bytes; links and relays may reject documents over ${PROPOSAL_SIZE_WARN_BYTES}.`,
			),
		);
	}
	let node: JsonNode;
	try {
		node = parseJson(text);
	} catch (e) {
		return {
			proposal: null,
			issues: [
				...issues,
				issue(
					"proposal.parse",
					"error",
					`Not a JSON document: ${(e as Error).message}`,
				),
			],
		};
	}
	const v = validateProposal(toPlain(node), opts);
	return { proposal: v.proposal, issues: [...issues, ...v.issues] };
}

export interface MergeResult {
	readonly merged: Proposal | null;
	readonly issues: readonly Issue[];
}

/**
 * Merge two copies of the same proposal (same digest). Signatures form a set
 * keyed by signer: `a`'s come first, then new signers from `b`. A signature
 * that does not recover to its claimed signer is dropped with an issue, so the
 * result never carries garbage from either side. Meta: `a` wins, nulls are
 * filled from `b`. Receipt: whichever exists, `a` first.
 */
export async function mergeProposals(
	a: Proposal,
	b: Proposal,
): Promise<MergeResult> {
	const issues: Issue[] = [];
	if (a.digest !== b.digest) {
		return {
			merged: null,
			issues: [
				issue(
					"merge.digest_mismatch",
					"error",
					`These are different proposals (${a.digest} vs ${b.digest}); only copies of the same proposal merge.`,
				),
			],
		};
	}
	const digest = innerDigest(a.payload).digest;
	/* v8 ignore start -- a Proposal with a stated digest always re-hashes (validateProposal guarantees it) */
	if (!digest) {
		return {
			merged: null,
			issues: [
				issue("digest.failed", "error", "The payload cannot be hashed."),
			],
		};
	}
	/* v8 ignore stop */
	const bySigner = new Map<string, ProposalSignature>();
	for (const [side, list] of [
		["a", a.signatures],
		["b", b.signatures],
	] as const) {
		for (const [i, s] of list.entries()) {
			const recovered = await recoverInnerSigner(digest, s);
			if (recovered !== s.signer) {
				issues.push(
					issue(
						"merge.signature_dropped",
						"warning",
						`${side}.signatures[${i}] claims ${s.signer} but recovers to ${recovered ?? "nothing"}; dropped.`,
						{ path: `${side}.signatures[${i}]` },
					),
				);
				continue;
			}
			if (!bySigner.has(s.signer)) bySigner.set(s.signer, s);
		}
	}
	const meta: ProposalMeta = {
		kind: a.meta.kind,
		title: a.meta.title ?? b.meta.title,
		note: a.meta.note ?? b.meta.note,
		createdBy: a.meta.createdBy ?? b.meta.createdBy,
		createdAt: a.meta.createdAt ?? b.meta.createdAt,
		supersedes: a.meta.supersedes ?? b.meta.supersedes,
		policyAtCreation: a.meta.policyAtCreation ?? b.meta.policyAtCreation,
	};
	return {
		merged: {
			v: 1,
			payload: a.payload,
			digest: a.digest,
			signatures: [...bySigner.values()],
			meta,
			receipt: a.receipt ?? b.receipt,
		},
		issues,
	};
}
