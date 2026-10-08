/**
 * The proposal document a page is showing: loaded from this browser's history
 * by digest, and written back through it (merged) whenever it changes. If the
 * history cannot be used (IndexedDB blocked), the document is kept in memory
 * so the page still works for as long as it stays open.
 */
import { type Issue, mergeProposals, type Proposal } from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { errorMessage } from "#/hooks/useHyperliquid";
import { loadProposal, saveProposal } from "../model/history";

export interface StoreResult {
	readonly proposal: Proposal;
	readonly issues: readonly Issue[];
}

export interface ProposalDoc {
	readonly proposal: Proposal | null;
	/** Notes from decoding the stored document (timing warnings and the like). */
	readonly issues: readonly Issue[];
	readonly loading: boolean;
	/** Set when the history could not be read or written. */
	readonly storageError: string | null;
	/** Merge a copy into the document and persist it. Never throws. */
	store(incoming: Proposal): Promise<StoreResult>;
}

export function useProposalDoc(digest: string | undefined): ProposalDoc {
	const client = useQueryClient();
	const query = useQuery({
		queryKey: ["multisig-proposal", digest],
		enabled: !!digest,
		queryFn: () => loadProposal(digest as string),
		retry: 0,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const [memory, setMemory] = useState<Proposal | null>(null);
	const [storageError, setStorageError] = useState<string | null>(null);

	const store = useCallback(
		async (incoming: Proposal): Promise<StoreResult> => {
			try {
				const saved = await saveProposal(incoming);
				setStorageError(null);
				await client.invalidateQueries({
					queryKey: ["multisig-proposal", saved.proposal.digest],
				});
				void client.invalidateQueries({ queryKey: ["multisig-proposals"] });
				return { proposal: saved.proposal, issues: saved.issues };
			} catch (e) {
				// no history: merge with what this page already holds, in memory
				setStorageError(errorMessage(e));
				const held =
					memory && memory.digest === incoming.digest ? memory : null;
				const merged = held ? await mergeProposals(incoming, held) : null;
				const next = merged?.merged ?? incoming;
				setMemory(next);
				return { proposal: next, issues: merged?.issues ?? [] };
			}
		},
		[client, memory],
	);

	const stored = query.data?.proposal ?? null;
	const held = memory && (!digest || memory.digest === digest) ? memory : null;
	return {
		proposal: stored ?? held,
		issues: stored ? (query.data?.issues ?? []) : [],
		loading: !!digest && query.isPending,
		storageError:
			storageError ?? (query.isError ? errorMessage(query.error) : null),
		store,
	};
}
