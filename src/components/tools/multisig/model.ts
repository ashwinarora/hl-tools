/**
 * Pure parsing for the envelope view: text → a proposal the engine can judge,
 * whatever form the text came in (a raw exchange request body carrying a
 * `multiSig` action, or a Phase 0 proposal document).
 */
import {
	decodeProposal,
	type EnvelopeRequest,
	envelopeNetworkHint,
	type Issue,
	innerDigest,
	type Network,
	type Proposal,
	parseEnvelope,
	type Sig,
	signingFamilyFor,
	toPlain,
	tryParseJson,
} from "@hl-tools/core";

export type ParsedEnvelopeInput =
	| { readonly kind: "empty" }
	| { readonly kind: "json-error"; readonly message: string }
	| { readonly kind: "not-multisig"; readonly issues: readonly Issue[] }
	| {
			readonly kind: "proposal";
			readonly source: "document";
			readonly proposal: Proposal;
			readonly network: Network;
			/** True when the network came from the input rather than the toggle. */
			readonly networkFromInput: true;
			readonly outerSignature: null;
			readonly request: null;
			readonly issues: readonly Issue[];
	  }
	| {
			readonly kind: "proposal";
			readonly source: "envelope";
			readonly proposal: Proposal;
			readonly network: Network;
			readonly networkFromInput: boolean;
			readonly outerSignature: Sig | null;
			readonly request: EnvelopeRequest;
			readonly issues: readonly Issue[];
	  };

function looksLikeDocument(value: unknown): boolean {
	return (
		!!value &&
		typeof value === "object" &&
		(value as { v?: unknown }).v === 1 &&
		typeof (value as { payload?: unknown }).payload === "object"
	);
}

/** Build the proposal an envelope implies, so the engine can classify its signatures. */
export function proposalFromRequest(
	req: EnvelopeRequest,
	network: Network,
): { proposal: Proposal | null; issues: readonly Issue[] } {
	const payload = {
		network,
		multiSigUser: req.action.payload.multiSigUser,
		outerSigner: req.action.payload.outerSigner,
		action: req.action.payload.action,
		nonce: req.nonce,
		vaultAddress: req.vaultAddress,
		expiresAfter: req.expiresAfter,
	};
	const d = innerDigest(payload);
	if (!d.digest) return { proposal: null, issues: d.issues };
	const type = String(req.action.payload.action.type);
	return {
		issues: d.issues,
		proposal: {
			v: 1,
			payload,
			digest: d.digest,
			signatures: req.action.signatures.map((s) => ({
				...s,
				signer:
					"0x0000000000000000000000000000000000000000" as Proposal["payload"]["multiSigUser"],
				at: null,
			})),
			meta: {
				kind: signingFamilyFor(type) === "user-signed" ? "user-signed" : "l1",
				title: null,
				note: null,
				createdBy: null,
				createdAt: null,
				supersedes: null,
				policyAtCreation: null,
			},
			receipt: null,
		},
	};
}

export function parseEnvelopeText(
	text: string,
	fallbackNetwork: Network,
	now = Date.now(),
): ParsedEnvelopeInput {
	const trimmed = text.trim();
	if (!trimmed) return { kind: "empty" };
	const parsed = tryParseJson(trimmed);
	if (!parsed.ok) return { kind: "json-error", message: parsed.error.message };
	const plain = toPlain(parsed.node);
	if (looksLikeDocument(plain)) {
		const d = decodeProposal(trimmed, { now });
		if (!d.proposal) return { kind: "not-multisig", issues: d.issues };
		return {
			kind: "proposal",
			source: "document",
			proposal: d.proposal,
			network: d.proposal.payload.network,
			networkFromInput: true,
			outerSignature: null,
			request: null,
			issues: d.issues,
		};
	}
	// A bare `{ type: "multiSig", … }` action is accepted as a body without nonce/signature.
	const body =
		plain &&
		typeof plain === "object" &&
		!("action" in plain) &&
		(plain as { type?: unknown }).type === "multiSig"
			? { action: plain, nonce: 0 }
			: plain;
	const env = parseEnvelope(body);
	if (!env.request) return { kind: "not-multisig", issues: env.issues };
	const hint = envelopeNetworkHint(env.request);
	const network = hint ?? fallbackNetwork;
	const built = proposalFromRequest(env.request, network);
	if (!built.proposal)
		return { kind: "not-multisig", issues: [...env.issues, ...built.issues] };
	return {
		kind: "proposal",
		source: "envelope",
		proposal: built.proposal,
		network,
		networkFromInput: hint !== null,
		outerSignature: env.outerSignature,
		request: env.request,
		issues: [...env.issues, ...built.issues],
	};
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
