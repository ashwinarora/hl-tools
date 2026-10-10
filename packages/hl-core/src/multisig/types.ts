/**
 * Native multi-sig proposal document (v1) and the types the module computes
 * from it. Everything here is plain data: no methods, no network, no clock.
 *
 * Signed vs unsigned: every field of `payload` is bound into each inner
 * signature (the network through the signing domain, vault and expiry through
 * the hash preimage). `digest`, `signatures`, `meta` and `receipt` are not.
 */
import type { Address } from "../identity.ts";
import type { Issue } from "../issues.ts";
import type { PlainJson } from "../json.ts";
import type { Network } from "../network.ts";

export type Hex = `0x${string}`;

/** Which hashing scheme the inner action uses (see rules/signing.ts). */
export type Kind = "l1" | "user-signed";

/** An ECDSA signature in exchange-request form. In documents r and s are 32-byte, lowercase. */
export interface Sig {
	readonly r: Hex;
	readonly s: Hex;
	readonly v: 27 | 28;
}

/** A plain JSON object; integers outside 2^53 are carried as bigint, never floats. */
export type PlainObject = { readonly [key: string]: PlainJson };

/** The on-chain signer set of a multi-sig user, as observed at a point in time. */
export interface Policy {
	/** Lowercase, sorted ascending (the chain stores them that way). */
	readonly authorizedUsers: readonly Address[];
	readonly threshold: number;
	/** Unix ms when the info endpoint reported this. */
	readonly observedAt: number;
}

/** The fields every signer commits to. Changing any of them invalidates all signatures. */
export interface ProposalPayload {
	readonly network: Network;
	/** The multi-sig account the action executes for. */
	readonly multiSigUser: Address;
	/** The leader: the authorized user (or funded agent of one) who will submit the envelope. */
	readonly outerSigner: Address;
	/** Canonical inner action, including its `type`. Never `multiSig`. */
	readonly action: PlainObject;
	/** Unix ms. Shared by every inner signature and the envelope. */
	readonly nonce: number;
	/** Vault or sub-account the action acts for; part of the hash preimage. */
	readonly vaultAddress: Address | null;
	/** Unix ms after which the chain rejects the action; part of the hash preimage. */
	readonly expiresAfter: number | null;
}

export interface ProposalSignature extends Sig {
	/** Address the signature is claimed to come from; verified by recovery, never trusted. */
	readonly signer: Address;
	/** Unix ms when it was produced, if known. */
	readonly at: number | null;
}

export interface ProposalMeta {
	readonly kind: Kind;
	readonly title: string | null;
	readonly note: string | null;
	readonly createdBy: Address | null;
	readonly createdAt: number | null;
	/** Digest of the proposal this one replaces (e.g. after the nonce expired). */
	readonly supersedes: Hex | null;
	/** Signer set observed when the proposal was created; the chain's current set wins. */
	readonly policyAtCreation: Policy | null;
}

/** Appended by the leader after submission so an offline copy can prove what happened. */
export interface Receipt {
	readonly submittedAt: number;
	/** EIP-712 domain chainId the leader signed the envelope with. */
	readonly signatureChainId: Hex;
	readonly outerSignature: Sig;
	readonly httpStatus: number;
	readonly response: PlainJson;
}

export interface Proposal {
	readonly v: 1;
	readonly payload: ProposalPayload;
	/** The EIP-712 digest signers put their key to. Recomputed on every load. */
	readonly digest: Hex;
	readonly signatures: readonly ProposalSignature[];
	readonly meta: ProposalMeta;
	readonly receipt: Receipt | null;
}

/** Input to `createProposal`; everything optional is derived or defaulted. */
export interface ProposalInput {
	readonly network: Network;
	readonly multiSigUser: string;
	readonly outerSigner: string;
	/** Inner action as plain JSON (will be canonicalised). */
	readonly action: unknown;
	/** Defaults to `now`. */
	readonly nonce?: number;
	readonly vaultAddress?: string | null;
	readonly expiresAfter?: number | null;
	readonly title?: string | null;
	readonly note?: string | null;
	readonly createdBy?: string | null;
	readonly supersedes?: Hex | null;
	readonly policyAtCreation?: Policy | null;
}

/** Why a proposal deserves a second look. Derived from the action, never stored. */
export type RiskFlag =
	| "agent_bypass"
	| "destructive"
	| "policy_change"
	| "funds_out"
	| "evm_warning";

export type SignatureStatus =
	/** Recovers to a current authorized user; counts toward the threshold. */
	| "valid-authorized"
	/** Recovers to the claimed signer, who is not an authorized user (or is the multi-sig user). */
	| "valid-unauthorized"
	/** Recovers to a current authorized user, but no policy was given to check it against. */
	| "valid-unknown"
	/** Does not recover to the claimed signer (garbage, or signed over different bytes). */
	| "invalid"
	/** A second valid signature from a signer already counted. */
	| "duplicate";

export interface ClassifiedSignature {
	readonly index: number;
	readonly signature: ProposalSignature;
	/** Address recovered from the digest, or null if recovery threw. */
	readonly recovered: Address | null;
	readonly status: SignatureStatus;
	readonly issues: readonly Issue[];
}

export type LeaderStatus =
	/** The leader is a current authorized user. */
	| "authorized"
	/** The leader is the multi-sig user itself or otherwise cannot lead. */
	| "not-authorized"
	/** Not in the signer set; may be a *funded* API wallet of a signer, which only the info API can confirm. */
	| "needs-lookup";

export type ReadinessStatus =
	| "ready"
	| "not-ready"
	| "expired"
	| "not-yet-valid"
	| "not-multisig"
	| "unknown";

export interface Readiness {
	readonly status: ReadinessStatus;
	/** Distinct authorized signers counted. */
	readonly have: number;
	/** Threshold, or null when no policy is known. */
	readonly need: number | null;
	readonly counted: readonly Address[];
	/** Authorized users who have not signed yet. */
	readonly missing: readonly Address[];
	readonly leader: LeaderStatus | null;
	readonly validFrom: number;
	readonly validUntil: number;
	readonly issues: readonly Issue[];
}

/** The exact `multiSig` request body the leader signs and posts. */
export interface EnvelopeAction {
	readonly type: "multiSig";
	readonly signatureChainId: Hex;
	/** Inner signatures, trimmed (no leading zero bytes) as the chain re-serialises them. */
	readonly signatures: readonly Sig[];
	readonly payload: {
		readonly multiSigUser: Address;
		readonly outerSigner: Address;
		readonly action: PlainObject;
	};
}

export interface EnvelopeRequest {
	readonly action: EnvelopeAction;
	readonly nonce: number;
	readonly vaultAddress: Address | null;
	readonly expiresAfter: number | null;
}

/** Anything that can sign EIP-712 typed data: a viem account, a wagmi client, a test key. */
export interface TypedDataSigner {
	signTypedData(typedData: {
		readonly domain: {
			readonly name: string;
			readonly version: string;
			readonly chainId: number;
			readonly verifyingContract: Hex;
		};
		readonly types: Record<string, readonly { name: string; type: string }[]>;
		readonly primaryType: string;
		readonly message: Record<string, unknown>;
	}): Promise<Hex | Sig>;
}

/** What `diagnoseSignature` found when a signature does not match the proposal. */
export type DiagnosisCause =
	| "matches"
	| "other-network"
	| "other-leader"
	| "other-nonce"
	| "vault-omitted"
	| "expires-omitted"
	| "other-signature-chain-id"
	| "non-canonical-action"
	| "unknown";

export interface Diagnosis {
	readonly cause: DiagnosisCause;
	/** Address the signature recovers to under the matching variant (or the proposal). */
	readonly recovered: Address | null;
	/** Human explanation of the variant that matched, if any. */
	readonly detail: string;
	/** Number of recoveries performed (bounded). */
	readonly attempts: number;
}

/** A parsed `convertToMultiSigUser.signers` value. */
export interface SignerSet {
	readonly authorizedUsers: readonly Address[];
	readonly threshold: number;
}

/** A chain error explained. */
export interface ErrorExplanation {
	/** Catalogue id, or "unknown" / "ok". */
	readonly id: string;
	readonly message: string;
	readonly cause: string;
	readonly fix: string;
	/** Values extracted from the message (nonces, addresses, bounds). */
	readonly details: Readonly<Record<string, string>>;
	/** Where in the response the error came from. */
	readonly source: "status" | "http" | "order-status" | "none";
}
