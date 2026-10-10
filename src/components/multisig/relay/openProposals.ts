/**
 * Every proposal still collecting signatures across the wallet's treasuries,
 * verified in this browser and counted against the relay's stored signer
 * copy. This feeds the inbox, the rail's counts and a treasury's pending tab;
 * the proposal page itself re-judges against the live chain.
 */
import {
	describeAction,
	type Issue,
	type Proposal,
	type RiskFlag,
} from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { assembleProposal, countedSigners } from "../model/relay/assemble";
import type { InboxEntry } from "../model/relay/inbox";
import type { ProposalRow } from "../model/relay/rows";
import { listOpenProposals } from "./api";
import { treasuriesQuery, unwrap } from "./queries";
import { queryIssue, useRelay } from "./useRelay";

export interface OpenProposal extends InboxEntry {
	readonly row: ProposalRow;
	readonly proposal: Proposal;
	/** The action in words: what signers sign. */
	readonly line: string;
	readonly title: string | null;
	readonly flags: readonly RiskFlag[];
}

interface OpenData {
	readonly items: readonly OpenProposal[];
	/** Rows that did not verify (a document that does not match its digest, a malformed row). */
	readonly unverified: number;
	readonly issues: readonly Issue[];
}

const NONE: readonly OpenProposal[] = [];

export function useOpenProposals() {
	const relay = useRelay();
	const queries = useQueryClient();
	const client = relay.client;
	const me = relay.wallet;
	const query = useQuery({
		queryKey: ["relay", me, "open"],
		enabled: !!client && !!me,
		queryFn: async (): Promise<OpenData> => {
			if (!client || !me) return { items: [], unverified: 0, issues: [] };
			const now = Date.now();
			const [got, treasuries] = await Promise.all([
				listOpenProposals(client, now).then(unwrap),
				queries.fetchQuery(treasuriesQuery(client, me)),
			]);
			const items: OpenProposal[] = [];
			const issues: Issue[] = [];
			let unverified = got.dropped;
			for (const row of got.rows) {
				const stored = treasuries.rows.find(
					(t) => t.network === row.network && t.address === row.treasury,
				);
				const a = await assembleProposal(row, { now });
				issues.push(...a.issues);
				if (!a.assembled || !stored) {
					if (!a.assembled) unverified += 1;
					continue;
				}
				const p = a.assembled.proposal;
				const described = describeAction(p.payload.action);
				items.push({
					row,
					proposal: p,
					network: row.network,
					treasury: row.treasury,
					digest: row.digest,
					createdBy: row.createdBy,
					finaliser: row.finaliser,
					counted: await countedSigners(p, stored.signers, stored.threshold),
					threshold: stored.threshold,
					open: row.status === "open" && row.expiresAt > now,
					frozen: stored.frozenAt !== null,
					line: described.headline,
					title: p.meta.title,
					flags: described.flags,
				});
			}
			return { items, unverified, issues };
		},
		staleTime: 5_000,
		// a ping can be missed (a dropped connection): look again once a minute anyway
		refetchInterval: 60_000,
		retry: 1,
	});
	return {
		items: query.data?.items ?? NONE,
		unverified: query.data?.unverified ?? 0,
		loading: !!client && query.isPending,
		issue: queryIssue(query.error),
	};
}
