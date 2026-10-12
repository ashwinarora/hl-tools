/**
 * Every proposal still collecting signatures across the wallet's treasuries,
 * verified in this browser and counted against the relay's stored signer
 * copy. This feeds the inbox, the rail's counts and a treasury's pending tab;
 * the proposal page itself re-judges against the live chain.
 */
import {
	describeAction,
	type Issue,
	orderMark,
	overtakenBy,
	type Proposal,
	type RiskFlag,
} from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loneStep, moveSentence, pairMoves } from "../model/move";
import { assembleProposal, countedSigners } from "../model/relay/assemble";
import { type InboxEntry, moveEntry } from "../model/relay/inbox";
import { standing } from "../model/relay/positions";
import type { ProposalRow } from "../model/relay/rows";
import { finaliserLeft, refusedForGood } from "../model/stage";
import { listCarriedOutAfter, listOpenProposals } from "./api";
import { treasuriesQuery, unwrap } from "./queries";
import { queryIssue, useRelay } from "./useRelay";

export interface OpenProposal extends InboxEntry {
	readonly row: ProposalRow;
	readonly proposal: Proposal;
	/** The action in words: what signers sign. */
	readonly line: string;
	readonly title: string | null;
	readonly flags: readonly RiskFlag[];
	/**
	 * Set on the one item that stands for a move: its two steps as they were
	 * judged by themselves. The item's own fields are then the first step's,
	 * except what `moveEntry` says of the two together.
	 */
	readonly steps?: readonly [OpenProposal, OpenProposal];
	/**
	 * Set on an item that stands alone and is one step of a move whose other
	 * step is not in this list (`loneStep`): its number.
	 */
	readonly lone?: 1 | 2;
}

type Assembly = Awaited<ReturnType<typeof assembleProposal>>;

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
			const assembled = new Map<ProposalRow, Assembly>();
			for (const row of got.rows)
				assembled.set(row, await assembleProposal(row, { now }));
			// Sends Hyperliquid takes only in order: those carried out since the
			// oldest one still pending decide which pending ones are shut out.
			const marks = [...assembled.values()].flatMap((a) => {
				const m = a.assembled
					? orderMark(a.assembled.proposal.payload.action)
					: null;
				return m ? [m.time] : [];
			});
			const done: { row: ProposalRow; action: unknown }[] = [];
			if (marks.length > 0) {
				// without this read nothing is called shut out: the proposal page judges again
				const newer = await listCarriedOutAfter(client, Math.min(...marks) - 1);
				for (const row of newer.data?.rows ?? []) {
					const a = await assembleProposal(row, { now });
					if (a.assembled)
						done.push({ row, action: a.assembled.proposal.payload.action });
				}
			}
			for (const row of got.rows) {
				const stored = treasuries.rows.find(
					(t) => t.network === row.network && t.address === row.treasury,
				);
				const a = assembled.get(row) as Assembly;
				issues.push(...a.issues);
				if (!a.assembled || !stored) {
					if (!a.assembled) unverified += 1;
					continue;
				}
				const p = a.assembled.proposal;
				const described = describeAction(p.payload.action);
				// who said no, counted against the stored signers like a signature is
				const position = standing({
					signers: stored.signers,
					threshold: stored.threshold,
					finaliser: row.finaliser,
					objections: row.objections.map((o) => ({
						signer: o.signer,
						at: o.createdAt,
					})),
				});
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
					objected: position.objected.map((o) => o.signer),
					blocked: position.blocked,
					stuck:
						// refused once: its number is used up, whoever signs now
						refusedForGood(p) ||
						finaliserLeft(p, {
							authorizedUsers: stored.signers,
							threshold: stored.threshold,
							observedAt: stored.checkedAt,
						}) ||
						overtakenBy(
							p.payload.action,
							done.filter(
								(d) =>
									d.row.network === row.network &&
									d.row.treasury === row.treasury &&
									d.row.digest !== row.digest,
							),
						) !== null,
					line: described.headline,
					title: p.meta.title,
					flags: described.flags,
				});
			}
			// the two steps of a move are one item: one row, one thing to count
			const listed = pairMoves(
				items.map((item) => ({
					item,
					proposal: item.proposal,
					proposedBy: item.createdBy,
				})),
				(first, second, move) => ({
					...first,
					item: {
						...first.item,
						...moveEntry(first.item, second.item),
						line: moveSentence(move),
						steps: [first.item, second.item] as const,
					},
				}),
			).map((x) => x.item);
			const digests = new Set(items.map((item) => item.digest));
			return {
				items: listed.map((item) => {
					const lone = item.steps ? null : loneStep(item.proposal, digests);
					return lone ? { ...item, lone } : item;
				}),
				unverified,
				issues,
			};
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
