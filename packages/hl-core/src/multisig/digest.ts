/**
 * What signers sign.
 *
 * Inner L1 action:   keccak(msgpack([multiSigUser, outerSigner, action]) ‖ nonce ‖ vault ‖ expires)
 *                    → EIP-712 Agent{source, connectionId} in Exchange/1/1337.
 * Inner user-signed: EIP-712 HyperliquidTransaction:<T>{hyperliquidChain, payloadMultiSigUser,
 *                    outerSigner, …fields} in HyperliquidSignTransaction/1/signatureChainId.
 * Envelope (outer):  keccak(msgpack({signatureChainId, signatures, payload}) ‖ nonce ‖ vault ‖ expires)
 *                    → EIP-712 HyperliquidTransaction:SendMultiSig{hyperliquidChain, multiSigActionHash, nonce}.
 */
import { type Issue, issue } from "../issues.ts";
import { fromPlain, type JsonObject } from "../json.ts";
import { type Network, networkConfig } from "../network.ts";
import {
	enrichSpecForMultiSig,
	SEND_MULTISIG_SPEC,
	signingFamilyFor,
	userSignedSpec,
} from "../rules/signing.ts";
import {
	eip712Hashes,
	type L1HashBreakdown,
	l1ActionHash,
	l1TypedData,
	type TypedDataPayload,
	userSignedTypedData,
} from "../signing.ts";
import { trimSig } from "./signature.ts";
import type {
	EnvelopeRequest,
	Hex,
	Kind,
	PlainObject,
	ProposalPayload,
} from "./types.ts";

export interface InnerDigestResult {
	readonly kind: Kind;
	/** The EIP-712 digest signers sign, or null when the payload cannot be hashed. */
	readonly digest: Hex | null;
	readonly typedData: TypedDataPayload | null;
	/** L1 only: the msgpack preimage breakdown (connectionId = action hash). */
	readonly l1: L1HashBreakdown | null;
	readonly issues: readonly Issue[];
}

function hashTyped(td: TypedDataPayload): {
	digest: Hex | null;
	issues: Issue[];
} {
	try {
		return { digest: eip712Hashes(td).digest, issues: [] };
	} catch (e) {
		return {
			digest: null,
			issues: [
				issue(
					"digest.failed",
					"error",
					`Could not hash the typed data: ${(e as Error).message}`,
				),
			],
		};
	}
}

export function innerDigest(payload: ProposalPayload): InnerDigestResult {
	const type = payload.action.type;
	const kind: Kind =
		typeof type === "string" && signingFamilyFor(type) === "user-signed"
			? "user-signed"
			: "l1";
	const vault = payload.vaultAddress ?? null;
	const expires =
		payload.expiresAfter === null ? null : BigInt(payload.expiresAfter);
	if (kind === "l1") {
		let l1: L1HashBreakdown;
		try {
			l1 = l1ActionHash(
				fromPlain([payload.multiSigUser, payload.outerSigner, payload.action]),
				BigInt(payload.nonce),
				vault,
				expires,
			);
		} catch (e) {
			return {
				kind,
				digest: null,
				typedData: null,
				l1: null,
				issues: [
					issue(
						"digest.failed",
						"error",
						`Could not hash the inner action: ${(e as Error).message}`,
					),
				],
			};
		}
		const typedData = l1TypedData(l1.connectionId, payload.network);
		const h = hashTyped(typedData);
		return { kind, digest: h.digest, typedData, l1, issues: h.issues };
	}
	const spec = userSignedSpec(type as string);
	/* v8 ignore next 3 -- kind is user-signed only when a spec exists */
	if (!spec) {
		return { kind, digest: null, typedData: null, l1: null, issues: [] };
	}
	const enriched = fromPlain({
		...payload.action,
		payloadMultiSigUser: payload.multiSigUser,
		outerSigner: payload.outerSigner,
	}) as JsonObject;
	const build = userSignedTypedData(enriched, enrichSpecForMultiSig(spec));
	if (!build.typedData) {
		return {
			kind,
			digest: null,
			typedData: null,
			l1: null,
			issues: build.issues,
		};
	}
	const h = hashTyped(build.typedData);
	return {
		kind,
		digest: h.digest,
		typedData: build.typedData,
		l1: null,
		issues: [...build.issues, ...h.issues],
	};
}

/**
 * The envelope action exactly as hashed and sent: canonical key order, inner
 * signatures trimmed and lowercased (the chain re-serialises them that way
 * before re-hashing, so anything else fails as "Invalid multi-sig outer signer").
 */
export function canonicalEnvelopeAction(req: EnvelopeRequest): PlainObject {
	return {
		type: "multiSig",
		signatureChainId: req.action.signatureChainId.toLowerCase(),
		signatures: req.action.signatures.map((s) => {
			const t = trimSig(s);
			return { r: t.r, s: t.s, v: t.v };
		}),
		payload: {
			multiSigUser: req.action.payload.multiSigUser.toLowerCase(),
			outerSigner: req.action.payload.outerSigner.toLowerCase(),
			action: req.action.payload.action,
		},
	};
}

export interface EnvelopeDigestResult {
	readonly digest: Hex | null;
	readonly typedData: TypedDataPayload | null;
	/** `multiSigActionHash`: the L1-style hash of the envelope action without `type`. */
	readonly actionHash: Hex | null;
	readonly issues: readonly Issue[];
}

export function envelopeDigest(
	req: EnvelopeRequest,
	network: Network,
): EnvelopeDigestResult {
	const { type: _type, ...hashed } = canonicalEnvelopeAction(req);
	let actionHash: Hex;
	try {
		actionHash = l1ActionHash(
			fromPlain(hashed),
			BigInt(req.nonce),
			req.vaultAddress,
			req.expiresAfter === null ? null : BigInt(req.expiresAfter),
		).connectionId;
	} catch (e) {
		return {
			digest: null,
			typedData: null,
			actionHash: null,
			issues: [
				issue(
					"digest.failed",
					"error",
					`Could not hash the envelope: ${(e as Error).message}`,
				),
			],
		};
	}
	const build = userSignedTypedData(
		fromPlain({
			signatureChainId: hashed.signatureChainId,
			hyperliquidChain: networkConfig(network).hyperliquidChain,
			multiSigActionHash: actionHash,
			nonce: req.nonce,
		}) as JsonObject,
		SEND_MULTISIG_SPEC,
	);
	/* v8 ignore next 9 -- the synthetic struct is always complete */
	if (!build.typedData) {
		return {
			digest: null,
			typedData: null,
			actionHash,
			issues: build.issues,
		};
	}
	const h = hashTyped(build.typedData);
	return {
		digest: h.digest,
		typedData: build.typedData,
		actionHash,
		issues: [...build.issues, ...h.issues],
	};
}
