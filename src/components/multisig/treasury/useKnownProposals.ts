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
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { DoneProposal, MatchCandidate } from "../model/chain/match";
import { listProposals as listLocal, receiptOk } from "../model/history";
import { assembleProposal } from "../model/relay/assemble";
import { listProposals } from "../relay/api";
import { unwrap } from "../relay/queries";
import { useRelay } from "../relay/useRelay";

export interface KnownProposal extends MatchCandidate, DoneProposal {
	/** The proposer's title, or the action in words. */
	readonly title: string;
	readonly proposal: Proposal;
}

function known(p: Proposal, accepted: boolean): KnownProposal {
	return {
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
		queryKey: ["relay", relay.wallet, "proposals", network, address],
		enabled: enabled && !!client,
		queryFn: async (): Promise<readonly KnownProposal[]> => {
			const got = unwrap(
				await listProposals(
					client as NonNullable<typeof client>,
					network,
					address,
				),
			);
			const out: KnownProposal[] = [];
			for (const row of got.rows) {
				const a = await assembleProposal(row);
				if (a.assembled)
					out.push(known(a.assembled.proposal, row.status === "accepted"));
			}
			return out;
		},
		staleTime: 15_000,
		retry: 1,
	});
	const local = useQuery({
		queryKey: ["multisig-local-proposals", network, address],
		enabled,
		queryFn: async (): Promise<readonly KnownProposal[]> => {
			const out: KnownProposal[] = [];
			for (const stored of await listLocal(network)) {
				if (stored.multiSigUser !== address) continue;
				const p = decodeProposal(stored.doc).proposal;
				if (p) out.push(known(p, !!p.receipt && receiptOk(p.receipt)));
			}
			return out;
		},
		staleTime: 15_000,
		retry: 0,
	});
	const proposals = useMemo(() => {
		const byDigest = new Map<string, KnownProposal>();
		// the relay's copy last: it knows what became of a proposal
		for (const p of [...(local.data ?? NONE), ...(shared.data ?? NONE)]) {
			const have = byDigest.get(p.digest);
			byDigest.set(
				p.digest,
				have ? { ...p, accepted: p.accepted || have.accepted } : p,
			);
		}
		return [...byDigest.values()];
	}, [local.data, shared.data]);
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
