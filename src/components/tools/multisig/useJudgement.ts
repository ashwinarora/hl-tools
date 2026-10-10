/**
 * The judgement of one proposal against the live signer set: every signature
 * recovered and classified, readiness, a diagnosis for each signature that
 * does not match, and the recovered envelope signer when there is one.
 *
 * Shared by the inspector's envelope view and the Multisig Signer, so the
 * panel a signer reads and the buttons a signer can press are derived from the
 * same result.
 */
import {
	type ClassifiedSignature,
	classifySignatures,
	type Diagnosis,
	diagnoseSignature,
	envelopeDigest,
	infoClient,
	type Network,
	type Observed,
	type Policy,
	type Proposal,
	type Readiness,
	readiness,
	recoverInnerSigner,
} from "@hl-tools/core";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ParsedEnvelopeInput } from "./model";

export type ProposalParsed = Extract<ParsedEnvelopeInput, { kind: "proposal" }>;

export interface Judgement {
	/** The proposal this judgement was computed for. */
	readonly proposal: Proposal;
	readonly policy: Policy | null;
	readonly classified: readonly ClassifiedSignature[];
	readonly ready: Readiness;
	readonly diagnoses: Readonly<Record<number, Diagnosis>>;
	readonly outerRecovered: `0x${string}` | null;
}

export type PolicyQuery = UseQueryResult<Observed<Policy | null, Network>>;

export interface JudgementState {
	/** Null while signatures are being recovered, or while it belongs to an older proposal. */
	readonly judgement: Judgement | null;
	/** Null until the lookup answers; an empty set when the user is not a multi-sig there. */
	readonly policy: Policy | null;
	readonly policyQuery: PolicyQuery;
	/** The network the proposal is *not* checked on, and its signer set when probed. */
	readonly other: Network;
	readonly otherQuery: PolicyQuery;
}

export function useJudgement(
	parsed: ProposalParsed,
	opts: { refetchInterval?: number } = {},
): JudgementState {
	const { proposal, network } = parsed;
	const user = proposal.payload.multiSigUser;
	const policyQuery = useQuery({
		queryKey: ["multisig-policy", network, user],
		queryFn: () => infoClient(network).multiSigSigners(user),
		staleTime: 10_000,
		retry: 1,
		refetchInterval: opts.refetchInterval,
	});
	// When this network's lookup succeeded but the address is not a multi-sig user, that is
	// a known (empty) policy, not an unknown one. Memoised: the effect below depends on it.
	const policy = useMemo<Policy | null>(
		() =>
			policyQuery.data
				? (policyQuery.data.data ?? {
						authorizedUsers: [],
						threshold: 0,
						observedAt: policyQuery.data.observedAt,
					})
				: null,
		[policyQuery.data],
	);
	// L1 payloads do not name their network; if this network says "not a multi-sig" but the
	// other one does, the caller can say so.
	const other: Network = network === "mainnet" ? "testnet" : "mainnet";
	const otherQuery = useQuery({
		queryKey: ["multisig-policy", other, user],
		queryFn: () => infoClient(other).multiSigSigners(user),
		staleTime: 10_000,
		retry: 1,
		enabled:
			!parsed.networkFromInput && policy !== null && policy.threshold === 0,
	});
	const [judgement, setJudgement] = useState<Judgement | null>(null);
	useEffect(() => {
		let cancelled = false;
		(async () => {
			const classified = await classifySignatures(proposal, policy);
			const ready = readiness(proposal, policy, classified);
			const diagnoses: Record<number, Diagnosis> = {};
			for (const c of classified) {
				// A raw envelope carries no claimed signer, so an unauthorized recovery may be an
				// authorized user who signed different bytes: diagnose those too.
				if (
					c.status === "invalid" ||
					(c.status === "valid-unauthorized" && parsed.source === "envelope")
				) {
					diagnoses[c.index] = await diagnoseSignature(
						c.signature,
						proposal,
						policy,
					);
				}
			}
			let outerRecovered: `0x${string}` | null = null;
			if (parsed.outerSignature && parsed.request) {
				const d = envelopeDigest(parsed.request, network);
				if (d.digest)
					outerRecovered = await recoverInnerSigner(
						d.digest,
						parsed.outerSignature,
					);
			}
			if (!cancelled)
				setJudgement({
					proposal,
					policy,
					classified,
					ready,
					diagnoses,
					outerRecovered,
				});
		})();
		return () => {
			cancelled = true;
		};
	}, [
		proposal,
		parsed.outerSignature,
		parsed.request,
		parsed.source,
		network,
		policy,
	]);
	return {
		// never hand out a judgement of a previous proposal
		judgement: judgement && judgement.proposal === proposal ? judgement : null,
		policy,
		policyQuery,
		other,
		otherQuery,
	};
}
