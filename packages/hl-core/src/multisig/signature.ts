/**
 * Signature forms and recovery.
 *
 * Documents keep r and s as 32-byte lowercase hex. The chain (and both SDKs)
 * send inner signatures *trimmed* (no leading zero digits), and the chain
 * re-serialises them that way before re-hashing the envelope, so the envelope
 * builder trims and recovery pads.
 */
import type { Address } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { parseSignature, recoverSigner } from "../signing.ts";
import { ZERO_ADDRESS } from "./address.ts";
import { innerDigest } from "./digest.ts";
import type {
	ClassifiedSignature,
	Hex,
	Policy,
	Proposal,
	Sig,
	SignatureStatus,
} from "./types.ts";

/** secp256k1 group order and its half; s above the half is "high-s" (malleable form). */
export const SECP256K1_N =
	0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const SECP256K1_HALF_N = SECP256K1_N >> 1n;

export interface SigCheck {
	readonly sig: Sig | null;
	readonly issues: readonly Issue[];
}

/** Parse any accepted form ({r,s,v}, 65-byte hex, EIP-2098 compact) into padded lowercase form. */
export function normaliseSig(input: unknown, path = "signature"): SigCheck {
	try {
		const p = parseSignature(input);
		const sig: Sig = { r: p.r, s: p.s, v: p.v as 27 | 28 };
		const issues: Issue[] = [];
		if (BigInt(sig.r) === 0n || BigInt(sig.s) === 0n) {
			issues.push(
				issue("signature.zero", "error", "r and s must be non-zero.", { path }),
			);
			return { sig: null, issues };
		}
		if (isHighS(sig)) {
			issues.push(
				issue(
					"signature.high_s",
					"info",
					"s is in the upper half of the curve order (high-s). Recovery works; the chain's acceptance of high-s signatures has not been verified.",
					{ path },
				),
			);
		}
		return { sig, issues };
	} catch (e) {
		return {
			sig: null,
			issues: [
				issue("signature.invalid", "error", (e as Error).message, { path }),
			],
		};
	}
}

function trimHex(h: Hex): Hex {
	const t = h.toLowerCase().replace(/^0x0+/, "0x");
	return t === "0x" ? "0x0" : (t as Hex);
}

function padHex(h: Hex): Hex {
	return `0x${h.toLowerCase().slice(2).padStart(64, "0")}`;
}

/** Wire form: minimal hex digits, as `to_hex(int)` in Python and nktkas' trimSignature produce. */
export function trimSig(sig: Sig): Sig {
	return { r: trimHex(sig.r), s: trimHex(sig.s), v: sig.v };
}

/** Document form: 32 bytes, lowercase. */
export function padSig(sig: Sig): Sig {
	return { r: padHex(sig.r), s: padHex(sig.s), v: sig.v };
}

export function isHighS(sig: Sig): boolean {
	return BigInt(sig.s) > SECP256K1_HALF_N;
}

/** Recover the address that produced `sig` over `digest`, or null when recovery fails. */
export async function recoverInnerSigner(
	digest: Hex,
	sig: Sig,
): Promise<Address | null> {
	try {
		const parsed = parseSignature(padSig(sig));
		return (await recoverSigner(digest, parsed)) as Address;
	} catch {
		return null;
	}
}

/**
 * Verify every signature of a proposal against its digest and, when a policy is
 * given, against the signer set. Never throws; a signature that cannot be
 * parsed or recovered is `invalid` with the reason attached.
 */
export async function classifySignatures(
	proposal: Proposal,
	policy: Policy | null,
): Promise<ClassifiedSignature[]> {
	const { digest, issues: digestIssues } = innerDigest(proposal.payload);
	const counted = new Set<Address>();
	const out: ClassifiedSignature[] = [];
	for (const [index, signature] of proposal.signatures.entries()) {
		const path = `signatures[${index}]`;
		const issues: Issue[] = [];
		let status: SignatureStatus = "invalid";
		let recovered: Address | null = null;
		if (!digest) {
			issues.push(
				issue(
					"signature.undigestable",
					"error",
					"The proposal payload cannot be hashed, so no signature can be checked.",
					{ path },
				),
				...digestIssues,
			);
		} else {
			const parsed = normaliseSig(signature, path);
			issues.push(...parsed.issues);
			if (parsed.sig) {
				recovered = await recoverInnerSigner(digest, parsed.sig);
				const claimed = signature.signer.toLowerCase();
				// A raw envelope carries no claimed signer (zero address): judge the recovered address alone.
				const unclaimed = claimed === ZERO_ADDRESS;
				if (!recovered) {
					issues.push(
						issue(
							"signature.unrecoverable",
							"error",
							"The signature does not recover to any address.",
							{ path },
						),
					);
				} else if (!unclaimed && recovered !== claimed) {
					issues.push(
						issue(
							"signature.signer_mismatch",
							"error",
							`Claimed signer ${claimed} but the signature recovers to ${recovered}: it was made over different bytes (another nonce, action, leader, treasury, vault, expiry or network), or by another key.`,
							{ path },
						),
					);
				} else if (recovered === proposal.payload.multiSigUser) {
					status = "valid-unauthorized";
					issues.push(
						issue(
							"signature.multisig_user_key",
							"warning",
							"Signed by the multi-sig account's own key, which is not an authorized user; it does not count.",
							{ path },
						),
					);
				} else if (!policy) {
					status = "valid-unknown";
				} else if (!policy.authorizedUsers.includes(recovered)) {
					status = "valid-unauthorized";
					issues.push(
						issue(
							"signature.unauthorized",
							"warning",
							unclaimed
								? `${recovered} is not in the signer set (as of ${new Date(policy.observedAt).toISOString()}): either an outsider signed, or an authorized user signed different bytes (diagnoseSignature can tell).`
								: `${recovered} is not in the signer set (as of ${new Date(policy.observedAt).toISOString()}). API wallets of signers cannot sign inner actions either.`,
							{
								path,
								fix: "Collect a signature from an authorized user's own key.",
							},
						),
					);
				} else if (counted.has(recovered)) {
					status = "duplicate";
					issues.push(
						issue(
							"signature.duplicate",
							"info",
							`${recovered} already counted; the chain counts distinct signers.`,
							{ path },
						),
					);
				} else {
					status = "valid-authorized";
					counted.add(recovered);
				}
			}
		}
		out.push({ index, signature, recovered, status, issues });
	}
	return out;
}
