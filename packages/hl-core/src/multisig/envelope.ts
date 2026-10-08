/**
 * From a proposal with enough signatures to the exact request the leader
 * posts, and the two signing operations (inner for signers, outer for the
 * leader) through any EIP-712-capable signer.
 */
import type { Address } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { type Network, networkConfig } from "../network.ts";
import { OUTER_KEY_ORDER, PAYLOAD_KEY_ORDER } from "../rules/multisig.ts";
import { SIGNATURE_CHAIN_IDS } from "../rules/signing.ts";
import type { TypedDataPayload } from "../signing.ts";
import { normaliseAddress } from "./address.ts";
import { envelopeDigest, innerDigest } from "./digest.ts";
import {
	normaliseSig,
	padSig,
	recoverInnerSigner,
	trimSig,
} from "./signature.ts";
import type {
	ClassifiedSignature,
	EnvelopeRequest,
	Hex,
	PlainObject,
	Proposal,
	ProposalSignature,
	Sig,
	TypedDataSigner,
} from "./types.ts";

export interface BuildOptions {
	/** EIP-712 domain chainId for the envelope; defaults to the network's conventional id. */
	readonly signatureChainId?: Hex;
	/** When given, only `valid-authorized` signatures are included (one per signer). */
	readonly classified?: readonly ClassifiedSignature[];
}

export interface BuiltEnvelope {
	readonly request: EnvelopeRequest;
	readonly issues: readonly Issue[];
}

/** Assemble the `multiSig` request. Inner signatures are trimmed as the chain expects. */
export function buildEnvelope(
	p: Proposal,
	opts: BuildOptions = {},
): BuiltEnvelope {
	const issues: Issue[] = [];
	let chosen: readonly Sig[];
	if (opts.classified) {
		const seen = new Set<Address>();
		const kept: Sig[] = [];
		for (const c of opts.classified) {
			if (
				c.status === "valid-authorized" &&
				c.recovered &&
				!seen.has(c.recovered)
			) {
				seen.add(c.recovered);
				kept.push(c.signature);
			}
		}
		chosen = kept;
		const dropped = opts.classified.length - kept.length;
		if (dropped > 0) {
			issues.push(
				issue(
					"envelope.signatures_dropped",
					"info",
					`${dropped} signature(s) that would not count (invalid, unauthorized or duplicate) were left out of the envelope.`,
				),
			);
		}
	} else {
		chosen = p.signatures;
	}
	if (chosen.length === 0) {
		issues.push(
			issue(
				"envelope.no_signatures",
				"warning",
				'The envelope carries no inner signatures; the chain will answer "Multi-sig threshold not met".',
			),
		);
	}
	const signatureChainId = (
		opts.signatureChainId ?? SIGNATURE_CHAIN_IDS[p.payload.network]
	).toLowerCase() as Hex;
	return {
		request: {
			action: {
				type: "multiSig",
				signatureChainId,
				signatures: chosen.map((s) => trimSig({ r: s.r, s: s.s, v: s.v })),
				payload: {
					multiSigUser: p.payload.multiSigUser,
					outerSigner: p.payload.outerSigner,
					action: p.payload.action,
				},
			},
			nonce: p.payload.nonce,
			vaultAddress: p.payload.vaultAddress,
			expiresAfter: p.payload.expiresAfter,
		},
		issues,
	};
}

/** The JSON body to POST to /exchange once the leader has signed the envelope. */
export function exchangeRequestBody(
	req: EnvelopeRequest,
	outerSignature: Sig,
): PlainObject {
	const body: Record<string, unknown> = {
		action: req.action,
		nonce: req.nonce,
		signature: outerSignature,
		vaultAddress: req.vaultAddress,
	};
	if (req.expiresAfter !== null) body.expiresAfter = req.expiresAfter;
	return body as PlainObject;
}

async function signTyped(
	signer: TypedDataSigner,
	typedData: TypedDataPayload,
	path: string,
): Promise<{ sig: Sig | null; issues: Issue[] }> {
	let raw: Hex | Sig;
	try {
		raw = await signer.signTypedData(typedData);
	} catch (e) {
		return {
			sig: null,
			issues: [
				issue(
					"signer.failed",
					"error",
					`The signer refused or failed: ${(e as Error).message}`,
					{ path },
				),
			],
		};
	}
	const n = normaliseSig(raw, path);
	return {
		sig: n.sig ? padSig(n.sig) : null,
		issues: n.issues.filter((i) => i.severity === "error"),
	};
}

export interface SignedProposal {
	readonly signature: ProposalSignature | null;
	readonly issues: readonly Issue[];
}

/**
 * Produce an inner signature with any EIP-712 signer. The signer address is
 * recovered from the signature, never taken on trust; `expectedSigner`, when
 * given, must match.
 */
export async function signProposal(
	p: Proposal,
	signer: TypedDataSigner,
	opts: { expectedSigner?: string; at?: number } = {},
): Promise<SignedProposal> {
	const d = innerDigest(p.payload);
	if (!d.typedData || !d.digest) return { signature: null, issues: d.issues };
	const s = await signTyped(signer, d.typedData, "signature");
	if (!s.sig) return { signature: null, issues: s.issues };
	const recovered = await recoverInnerSigner(d.digest, s.sig);
	/* v8 ignore start -- a freshly produced, parseable signature always recovers */
	if (!recovered) {
		return {
			signature: null,
			issues: [
				issue(
					"signature.unrecoverable",
					"error",
					"The produced signature does not recover.",
				),
			],
		};
	}
	/* v8 ignore stop */
	const issues: Issue[] = [];
	if (opts.expectedSigner) {
		const e = normaliseAddress(opts.expectedSigner, "expectedSigner");
		issues.push(...e.issues);
		if (e.address && e.address !== recovered) {
			issues.push(
				issue(
					"signature.signer_mismatch",
					"error",
					`Expected ${e.address} to sign but the signature recovers to ${recovered}; the wallet signed with another key.`,
					{ path: "signature" },
				),
			);
			return { signature: null, issues };
		}
	}
	return {
		signature: { ...s.sig, signer: recovered, at: opts.at ?? Date.now() },
		issues,
	};
}

export interface SignedEnvelope {
	readonly signature: Sig | null;
	readonly recovered: Address | null;
	readonly digest: Hex | null;
	readonly issues: readonly Issue[];
}

/** The leader signs the envelope. The recovered address must be the named leader. */
export async function signEnvelope(
	req: EnvelopeRequest,
	network: Network,
	signer: TypedDataSigner,
): Promise<SignedEnvelope> {
	const d = envelopeDigest(req, network);
	if (!d.typedData || !d.digest)
		return { signature: null, recovered: null, digest: null, issues: d.issues };
	const s = await signTyped(signer, d.typedData, "envelope.signature");
	if (!s.sig)
		return {
			signature: null,
			recovered: null,
			digest: d.digest,
			issues: s.issues,
		};
	const recovered = await recoverInnerSigner(d.digest, s.sig);
	if (recovered !== req.action.payload.outerSigner) {
		return {
			signature: null,
			recovered,
			digest: d.digest,
			issues: [
				issue(
					"envelope.signer_mismatch",
					"error",
					`The envelope must be signed by the leader ${req.action.payload.outerSigner}, but the signature recovers to ${recovered ?? "nothing"}.`,
					{ path: "envelope.signature" },
				),
			],
		};
	}
	return { signature: s.sig, recovered, digest: d.digest, issues: [] };
}

/** Adapt a viem account (or anything with the same `signTypedData` shape) to a TypedDataSigner. */
export function viemSigner(account: {
	signTypedData(args: {
		domain: TypedDataPayload["domain"];
		types: Record<string, readonly { name: string; type: string }[]>;
		primaryType: string;
		message: Record<string, unknown>;
	}): Promise<Hex>;
}): TypedDataSigner {
	return {
		signTypedData: (td) =>
			account.signTypedData({
				domain: td.domain,
				types: td.types,
				primaryType: td.primaryType,
				message: td.message,
			}),
	};
}

export interface ParsedEnvelope {
	readonly request: EnvelopeRequest | null;
	readonly outerSignature: Sig | null;
	readonly issues: readonly Issue[];
}

/**
 * Parse a pasted exchange request body carrying a `multiSig` action. Reports
 * non-canonical key order and untrimmed inner signatures (both would have
 * failed on chain) and normalises them so the digest can be recomputed.
 */
export function parseEnvelope(body: unknown): ParsedEnvelope {
	const issues: Issue[] = [];
	const fail = (): ParsedEnvelope => ({
		request: null,
		outerSignature: null,
		issues,
	});
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		issues.push(
			issue(
				"envelope.shape",
				"error",
				"Expected a request body object with action, nonce and signature.",
			),
		);
		return fail();
	}
	const b = body as Record<string, unknown>;
	const action = (
		b.action && typeof b.action === "object" && !Array.isArray(b.action)
			? b.action
			: null
	) as Record<string, unknown> | null;
	if (!action || action.type !== "multiSig") {
		issues.push(
			issue(
				"envelope.not_multisig",
				"error",
				'action.type must be "multiSig".',
				{
					path: "action.type",
				},
			),
		);
		return fail();
	}
	const keys = Object.keys(action).filter((k) => k !== "type");
	if (keys.join(",") !== OUTER_KEY_ORDER.join(",")) {
		issues.push(
			issue(
				"envelope.key_order",
				"warning",
				`Envelope keys were ${keys.join(", ")}; the canonical order is ${OUTER_KEY_ORDER.join(", ")}. The digest below uses the canonical order.`,
				{ path: "action" },
			),
		);
	}
	if (
		typeof action.signatureChainId !== "string" ||
		!/^0x[0-9a-fA-F]+$/.test(action.signatureChainId)
	) {
		issues.push(
			issue(
				"envelope.shape",
				"error",
				"action.signatureChainId must be a hex string.",
				{ path: "action.signatureChainId" },
			),
		);
	}
	const payload = (
		action.payload &&
		typeof action.payload === "object" &&
		!Array.isArray(action.payload)
			? action.payload
			: null
	) as Record<string, unknown> | null;
	if (!payload) {
		issues.push(
			issue("envelope.shape", "error", "action.payload must be an object.", {
				path: "action.payload",
			}),
		);
		return fail();
	}
	const pkeys = Object.keys(payload);
	if (pkeys.join(",") !== PAYLOAD_KEY_ORDER.join(",")) {
		issues.push(
			issue(
				"envelope.key_order",
				"warning",
				`Payload keys were ${pkeys.join(", ")}; canonical order is ${PAYLOAD_KEY_ORDER.join(", ")}.`,
				{ path: "action.payload" },
			),
		);
	}
	const user = normaliseAddress(
		payload.multiSigUser,
		"action.payload.multiSigUser",
	);
	const leader = normaliseAddress(
		payload.outerSigner,
		"action.payload.outerSigner",
	);
	issues.push(...user.issues, ...leader.issues);
	const inner = payload.action;
	if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
		issues.push(
			issue(
				"envelope.shape",
				"error",
				"action.payload.action must be an object.",
				{ path: "action.payload.action" },
			),
		);
	}
	const sigs: Sig[] = [];
	if (!Array.isArray(action.signatures)) {
		issues.push(
			issue("envelope.shape", "error", "action.signatures must be an array.", {
				path: "action.signatures",
			}),
		);
	} else {
		for (const [i, s] of action.signatures.entries()) {
			const path = `action.signatures[${i}]`;
			const n = normaliseSig(s, path);
			issues.push(...n.issues.filter((x) => x.severity === "error"));
			if (!n.sig) continue;
			const o = s as { r?: unknown; s?: unknown };
			const t = trimSig(n.sig);
			if (o.r !== t.r || o.s !== t.s) {
				issues.push(
					issue(
						"envelope.untrimmed",
						"warning",
						`${path} was not in trimmed form (${String(o.r)}, ${String(o.s)}); the chain re-serialises it trimmed, which changes the envelope hash and fails as "Invalid multi-sig outer signer".`,
						{ path },
					),
				);
			}
			sigs.push(t);
		}
	}
	if (!Number.isSafeInteger(b.nonce)) {
		issues.push(
			issue("envelope.shape", "error", "nonce must be an integer.", {
				path: "nonce",
			}),
		);
	}
	let vaultAddress: Address | null = null;
	if (b.vaultAddress !== null && b.vaultAddress !== undefined) {
		const v = normaliseAddress(b.vaultAddress, "vaultAddress");
		issues.push(...v.issues);
		vaultAddress = v.address;
	}
	let expiresAfter: number | null = null;
	if (b.expiresAfter !== null && b.expiresAfter !== undefined) {
		if (!Number.isSafeInteger(b.expiresAfter)) {
			issues.push(
				issue(
					"envelope.shape",
					"error",
					"expiresAfter must be an integer or null.",
					{ path: "expiresAfter" },
				),
			);
		} else expiresAfter = b.expiresAfter as number;
	}
	let outerSignature: Sig | null = null;
	if (b.signature !== undefined) {
		const n = normaliseSig(b.signature, "signature");
		issues.push(...n.issues.filter((x) => x.severity === "error"));
		outerSignature = n.sig ? padSig(n.sig) : null;
	}
	if (issues.some((i) => i.severity === "error")) return fail();
	return {
		request: {
			action: {
				type: "multiSig",
				signatureChainId: (
					action.signatureChainId as string
				).toLowerCase() as Hex,
				signatures: sigs,
				payload: {
					multiSigUser: user.address as Address,
					outerSigner: leader.address as Address,
					action: inner as PlainObject,
				},
			},
			nonce: b.nonce as number,
			vaultAddress,
			expiresAfter,
		},
		outerSignature,
		issues,
	};
}

/** The network a pasted envelope was built for, from its inner user-signed action when possible. */
export function envelopeNetworkHint(req: EnvelopeRequest): Network | null {
	const hc = req.action.payload.action.hyperliquidChain;
	for (const n of ["mainnet", "testnet"] as const) {
		if (networkConfig(n).hyperliquidChain === hc) return n;
	}
	return null;
}
