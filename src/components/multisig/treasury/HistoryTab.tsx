import {
	type Address,
	describeAction,
	type Hex,
	type Proposal,
} from "@hl-tools/core";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { formatTimestamp } from "#/components/hub/status";
import { download } from "#/lib/download";
import { assembleProposal } from "../model/relay/assemble";
import type { EventRow, TreasuryRow } from "../model/relay/rows";
import {
	buildTimeline,
	historyExport,
	historyFilename,
} from "../model/relay/timeline";
import { HISTORY_PAGE, listEvents, listProposalsByDigest } from "../relay/api";
import { unwrap } from "../relay/queries";
import { queryIssue, useRelay } from "../relay/useRelay";
import { Btn, Card, Empty } from "../shell/kit";

/**
 * Who did what, and when: the relay's record for this treasury, in sentences.
 * The action named in a sentence is read from the proposal's own verified
 * document; the record itself holds identifiers only. Hyperliquid's ledger
 * shows what the treasury did, never who proposed or signed.
 */
export function HistoryTab({
	treasury,
	me,
}: {
	treasury: TreasuryRow;
	me: Address | null;
}) {
	const relay = useRelay();
	const client = relay.client;
	const { network, address } = treasury;

	const pages = useInfiniteQuery({
		queryKey: ["relay", relay.wallet, "history", network, address],
		enabled: !!client,
		initialPageParam: undefined as number | undefined,
		queryFn: async ({ pageParam }) =>
			unwrap(
				await listEvents(
					client as NonNullable<typeof client>,
					network,
					address,
					{ before: pageParam },
				),
			).rows,
		// a full page means there may be older entries below its last id
		getNextPageParam: (last: readonly EventRow[]) =>
			last.length === HISTORY_PAGE ? last[last.length - 1]?.id : undefined,
		staleTime: 15_000,
		retry: 1,
	});
	const events = useMemo(() => pages.data?.pages.flat() ?? [], [pages.data]);
	const digests = useMemo(
		() =>
			[
				...new Set(events.map((e) => e.digest).filter((d): d is Hex => !!d)),
			].sort(),
		[events],
	);

	// the documents the events refer to, verified, for the action lines and the export
	const docs = useQuery({
		queryKey: [
			"relay",
			relay.wallet,
			"history-docs",
			network,
			address,
			digests.join(","),
		],
		enabled: !!client && digests.length > 0,
		queryFn: async () => {
			const got = unwrap(
				await listProposalsByDigest(
					client as NonNullable<typeof client>,
					network,
					address,
					digests,
				),
			);
			const out = new Map<Hex, Proposal>();
			for (const row of got.rows) {
				const a = await assembleProposal(row);
				if (a.assembled) out.set(row.digest, a.assembled.proposal);
			}
			return out;
		},
		staleTime: 15_000,
		retry: 1,
	});

	const entries = useMemo(
		() =>
			buildTimeline(events, {
				me,
				line: (digest) => {
					const p = docs.data?.get(digest);
					return p ? describeAction(p.payload.action).headline : null;
				},
				title: (digest) => docs.data?.get(digest)?.meta.title ?? null,
			}),
		[events, docs.data, me],
	);
	const issue = queryIssue(pages.error);

	const save = () =>
		download(
			historyFilename(network, address),
			historyExport({
				network,
				treasury: address,
				exportedAt: Date.now(),
				events,
				proposals: [...(docs.data?.values() ?? [])],
			}),
			"application/json",
		);

	return (
		<>
			<Card
				title="History"
				flush
				actions={
					<Btn
						size="sm"
						variant="outline"
						disabled={events.length === 0}
						onClick={save}
					>
						Export as a file
					</Btn>
				}
			>
				{pages.isPending ? (
					<Empty>Reading the history…</Empty>
				) : entries.length === 0 ? (
					<Empty>
						{issue ? issue.message : "Nothing has happened here yet."}
					</Empty>
				) : (
					<ul>
						{entries.map((e) => (
							<li
								key={e.id}
								className="grid grid-cols-1 gap-0.5 border-t border-border px-4 py-2.5 first:border-t-0 min-[861px]:grid-cols-[150px_minmax(0,1fr)] min-[861px]:gap-3"
							>
								<time
									dateTime={new Date(e.at).toISOString()}
									className="pt-0.5 font-mono text-xs text-subtle-foreground"
								>
									{formatTimestamp(e.at).slice(0, 16)} UTC
								</time>
								<span className="text-sm [overflow-wrap:anywhere]">
									{e.parts.map((p, i) =>
										p.strong ? (
											// biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed sentence
											<b key={i} className="font-semibold">
												{p.text}
											</b>
										) : (
											<span
												// biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed sentence
												key={i}
												className={
													p.quiet ? "text-muted-foreground" : undefined
												}
											>
												{p.text}
											</span>
										),
									)}
									{e.digest && (
										<>
											{" "}
											<Link
												to="/multisig/proposal"
												search={{ digest: e.digest }}
												className="whitespace-nowrap text-xs text-brand underline underline-offset-2"
											>
												open
											</Link>
										</>
									)}
								</span>
							</li>
						))}
					</ul>
				)}
				{pages.hasNextPage && (
					<div className="border-t border-border px-4 py-2.5">
						<Btn
							size="sm"
							variant="ghost"
							disabled={pages.isFetchingNextPage}
							onClick={() => void pages.fetchNextPage()}
						>
							{pages.isFetchingNextPage ? "Reading…" : "Older entries"}
						</Btn>
					</div>
				)}
			</Card>
			<p className="mx-0.5 mt-2 text-xs text-subtle-foreground">
				Who proposed and who signed is recorded here. Hyperliquid itself only
				records what the treasury did. The export holds every entry loaded above
				and the proposals they refer to.
			</p>
		</>
	);
}
