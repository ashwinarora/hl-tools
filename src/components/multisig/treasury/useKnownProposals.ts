/**
 * Every proposal this browser can know of for one treasury: the relay's (all
 * of them, whatever became of them) and the ones kept in this browser. They
 * explain Hyperliquid's own record: which proposal caused a transfer, which
 * one approved an API wallet. Each document is verified here before it is used.
 */
import {
	type Address,
	decodeProposal,
	describeAction,
	type Network,
	type Proposal,
} from "@hl-tools/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { DoneProposal, MatchCandidate } from "../model/chain/match";
import { listProposals as listLocal, receiptOk } from "../model/history";
import { assembleProposal } from "../model/relay/assemble";
import type { ProposalStatus } from "../model/relay/rows";
import { listProposals } from "../relay/api";
import type { RelayClient } from "../relay/client";
import { unwrap } from "../relay/queries";
import { useRelay } from "../relay/useRelay";

export interface KnownProposal extends MatchCandidate, DoneProposal {
	/** The proposer's title, or the action in words. */
	readonly title: string;
	readonly proposal: Proposal;
	/** The relay's status; null for a proposal only this browser holds. */
	readonly status: ProposalStatus | null;
}

function known(
	p: Proposal,
	accepted: boolean,
	status: ProposalStatus | null,
): KnownProposal {
	return {
		status,
		digest: p.digest,
		action: p.payload.action,
		nonce: p.payload.nonce,
		finaliser: p.payload.outerSigner,
		accepted,
		title: p.meta.title ?? describeAction(p.payload.action).headline,
		proposal: p,
	};
}

/**
 * loading      not read yet: nothing may be called "none on record"
 * ready        everything on record is in `proposals`
 * unavailable  the relay's record could not be read; `proposals` holds this
 *              browser's own copies only
 */
export type KnownState = "loading" | "ready" | "unavailable";

const NONE: readonly KnownProposal[] = [];

/** The relay's proposals for a treasury, each verified here. Under the relay's key: a ping re-reads it. */
export function sharedProposalsQuery(
	client: RelayClient,
	wallet: Address | null,
	network: Network,
	address: Address,
) {
	return queryOptions({
		queryKey: ["relay", wallet, "proposals", network, address],
		queryFn: async (): Promise<readonly KnownProposal[]> => {
			const got = unwrap(await listProposals(client, network, address));
			const out: KnownProposal[] = [];
			for (const row of got.rows) {
				const a = await assembleProposal(row);
				if (a.assembled)
					out.push(
						known(
							a.assembled.proposal,
							// carried out is done too, whoever sent it
							row.status === "accepted" || row.status === "carried_out",
							row.status,
						),
					);
			}
			return out;
		},
		staleTime: 15_000,
		retry: 1,
	});
}

/** The proposals this browser keeps for a treasury. */
export function localProposalsQuery(network: Network, address: Address) {
	return queryOptions({
		queryKey: ["multisig-local-proposals", network, address],
		queryFn: async (): Promise<readonly KnownProposal[]> => {
			const out: KnownProposal[] = [];
			for (const stored of await listLocal(network)) {
				if (stored.multiSigUser !== address) continue;
				const p = decodeProposal(stored.doc).proposal;
				if (p) out.push(known(p, !!p.receipt && receiptOk(p.receipt), null));
			}
			return out;
		},
		staleTime: 15_000,
		retry: 0,
	});
}

/** One list from both: the relay's copy last, since it knows what became of a proposal. */
export function mergeKnown(
	local: readonly KnownProposal[],
	shared: readonly KnownProposal[],
): KnownProposal[] {
	const byDigest = new Map<string, KnownProposal>();
	for (const p of [...local, ...shared]) {
		const have = byDigest.get(p.digest);
		byDigest.set(
			p.digest,
			have
				? {
						...p,
						accepted: p.accepted || have.accepted,
						status: p.status ?? have.status,
					}
				: p,
		);
	}
	return [...byDigest.values()];
}

export function useKnownProposals(
	network: Network,
	address: Address,
	enabled: boolean,
): {
	readonly proposals: readonly KnownProposal[];
	readonly state: KnownState;
} {
	const relay = useRelay();
	const client = relay.client;
	const shared = useQuery({
		...(client
			? sharedProposalsQuery(client, relay.wallet, network, address)
			: {
					queryKey: ["relay", relay.wallet, "proposals", network, address],
					queryFn: async (): Promise<readonly KnownProposal[]> => NONE,
				}),
		enabled: enabled && !!client,
	});
	const local = useQuery({
		...localProposalsQuery(network, address),
		enabled,
	});
	const proposals = useMemo(
		() => mergeKnown(local.data ?? NONE, shared.data ?? NONE),
		[local.data, shared.data],
	);
	const state: KnownState = !enabled
		? "loading"
		: client
			? shared.data !== undefined
				? "ready"
				: shared.isError
					? "unavailable"
					: "loading"
			: // no relay to ask: this browser's copies are all there is to go by
				local.isPending
				? "loading"
				: "unavailable";
	return { proposals, state };
}
