/**
 * When a signature does not match a proposal the chain says only
 * "Invalid multi-sig inner signer". This bounded search re-derives the digest
 * under the divergences the lab showed are common and reports the first one
 * the signature actually matches.
 */
import type { Address } from "../identity.ts";
import { DIAGNOSE_MAX_ATTEMPTS } from "../rules/multisig.ts";
import { SIGNATURE_CHAIN_IDS } from "../rules/signing.ts";
import { ZERO_ADDRESS } from "./address.ts";
import { innerDigest } from "./digest.ts";
import { recoverInnerSigner } from "./signature.ts";
import type {
	Diagnosis,
	DiagnosisCause,
	PlainObject,
	Policy,
	Proposal,
	ProposalPayload,
	ProposalSignature,
} from "./types.ts";

export interface DiagnoseOptions {
	/** Extra leaders to try besides the policy's signers (e.g. the proposer's agent). */
	readonly candidateLeaders?: readonly Address[];
	/** The action as the signer may have seen it before canonicalisation. */
	readonly originalAction?: PlainObject;
	/** Attempt budget; defaults to DIAGNOSE_MAX_ATTEMPTS. */
	readonly maxAttempts?: number;
}

interface Variant {
	readonly cause: DiagnosisCause;
	readonly detail: string;
	readonly payload: ProposalPayload;
}

function variants(
	p: Proposal,
	policy: Policy | null,
	opts: DiagnoseOptions,
): Variant[] {
	const pl = p.payload;
	const out: Variant[] = [];
	const userSigned = p.meta.kind === "user-signed";
	const otherNet = pl.network === "testnet" ? "mainnet" : "testnet";
	const otherChain = otherNet === "testnet" ? "Testnet" : "Mainnet";
	// For user-signed actions the network is bound only through `hyperliquidChain`,
	// so "signed for the other network" and "wrong hyperliquidChain string" are one variant.
	out.push({
		cause: "other-network",
		detail: userSigned
			? `signed with hyperliquidChain "${otherChain}" (${otherNet})`
			: `signed for ${otherNet}`,
		payload: userSigned
			? {
					...pl,
					network: otherNet,
					action: { ...pl.action, hyperliquidChain: otherChain },
				}
			: { ...pl, network: otherNet },
	});
	const leaders = new Set<Address>([
		...(policy?.authorizedUsers ?? []),
		...(opts.candidateLeaders ?? []),
	]);
	leaders.delete(pl.outerSigner);
	for (const leader of leaders) {
		out.push({
			cause: "other-leader",
			detail: `signed for leader ${leader}`,
			payload: { ...pl, outerSigner: leader },
		});
	}
	for (const delta of [-1, 1, -2, 2]) {
		const nonce = pl.nonce + delta;
		out.push({
			cause: "other-nonce",
			detail: `signed with nonce ${nonce} (${delta > 0 ? "+" : ""}${delta})`,
			payload: userSigned
				? {
						...pl,
						nonce,
						action: { ...pl.action, [nonceField(pl.action)]: nonce },
					}
				: { ...pl, nonce },
		});
	}
	if (pl.vaultAddress !== null) {
		out.push({
			cause: "vault-omitted",
			detail: "signed without the vaultAddress",
			payload: { ...pl, vaultAddress: null },
		});
	}
	if (pl.expiresAfter !== null) {
		out.push({
			cause: "expires-omitted",
			detail: "signed without expiresAfter",
			payload: { ...pl, expiresAfter: null },
		});
	}
	if (userSigned) {
		const current = String(pl.action.signatureChainId).toLowerCase();
		for (const id of new Set([
			SIGNATURE_CHAIN_IDS.mainnet,
			SIGNATURE_CHAIN_IDS.testnet,
			"0x1",
		])) {
			if (id === current) continue;
			out.push({
				cause: "other-signature-chain-id",
				detail: `signed under EIP-712 chainId ${id}`,
				payload: { ...pl, action: { ...pl.action, signatureChainId: id } },
			});
		}
	}
	if (opts.originalAction) {
		out.push({
			cause: "non-canonical-action",
			detail:
				"signed the action as originally written (before canonicalisation)",
			payload: { ...pl, action: opts.originalAction },
		});
	}
	return out;
}

function nonceField(action: PlainObject): "time" | "nonce" {
	return "time" in action ? "time" : "nonce";
}

/**
 * Try the proposal itself, then each variant, until the signature recovers to
 * its claimed signer. Bounded by `maxAttempts` recoveries.
 */
export async function diagnoseSignature(
	sig: ProposalSignature,
	p: Proposal,
	policy: Policy | null,
	opts: DiagnoseOptions = {},
): Promise<Diagnosis> {
	const budget = opts.maxAttempts ?? DIAGNOSE_MAX_ATTEMPTS;
	let attempts = 0;
	const claimed = sig.signer;
	// Without a claimed signer (zero address, as in a raw envelope) a variant counts as a
	// match when it recovers to any current authorized user.
	const unclaimed = claimed === ZERO_ADDRESS;
	const matches = (recovered: Address | null): boolean =>
		recovered !== null &&
		(unclaimed
			? (policy?.authorizedUsers.includes(recovered) ?? false)
			: recovered === claimed);
	const tryPayload = async (
		payload: ProposalPayload,
	): Promise<Address | null> => {
		attempts += 1;
		const d = innerDigest(payload).digest;
		return d ? recoverInnerSigner(d, sig) : null;
	};
	const baseline = await tryPayload(p.payload);
	if (matches(baseline)) {
		return {
			cause: "matches",
			recovered: baseline,
			detail: "The signature matches the proposal.",
			attempts,
		};
	}
	if (unclaimed && !policy) {
		return {
			cause: "unknown",
			recovered: baseline,
			detail:
				"No claimed signer and no signer set: nothing to match variants against.",
			attempts,
		};
	}
	for (const v of variants(p, policy, opts)) {
		if (attempts >= budget) break;
		const recovered = await tryPayload(v.payload);
		if (matches(recovered)) {
			return {
				cause: v.cause,
				recovered,
				detail: `${recovered} ${v.detail}.`,
				attempts,
			};
		}
	}
	return {
		cause: "unknown",
		recovered: baseline,
		detail: `No tried variant matches; the signature recovers to ${baseline ?? "nothing"} against the proposal. The signer may have signed a different action or used another key.`,
		attempts,
	};
}
