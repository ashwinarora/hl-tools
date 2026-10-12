import {
	type Address,
	type Hex,
	type Proposal,
	stakingActionOf,
} from "@hl-tools/core";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { download } from "#/lib/download";
import { useValidators } from "../live/useStaking";
import { type Listed, moveRefs } from "../model/move";
import { assembleProposal } from "../model/relay/assemble";
import type { EventRow, TreasuryRow } from "../model/relay/rows";
import {
	buildTimeline,
	historyExport,
	historyFilename,
} from "../model/relay/timeline";
import { actionLine } from "../model/staking";
import { Sentence } from "../names/Sentence";
import { HISTORY_PAGE, listEvents, listProposalsByDigest } from "../relay/api";
import { unwrap } from "../relay/queries";
import { queryIssue, useRelay } from "../relay/useRelay";
import { Help } from "../shell/Help";
import { Btn, Card, Empty } from "../shell/kit";
import { When } from "../shell/live";

/**
 * Who did what, and when: the relay's record for this treasury, in sentences.
 * The action named in a sentence is read from the proposal's own verified
 * document; the record itself holds identifiers only. Hyperliquid's ledger
 * shows what the treasury did, never who proposed or signed.
 */
export function SigningLogTab({
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
			const listed: Listed[] = [];
			for (const row of got.rows) {
				const a = await assembleProposal(row);
				if (!a.assembled) continue;
				out.set(row.digest, a.assembled.proposal);
				// who proposed each is the relay's word, never the document's
				listed.push({
					proposal: a.assembled.proposal,
					proposedBy: row.createdBy,
				});
			}
			return { proposals: out, listed };
		},
		staleTime: 15_000,
		retry: 1,
	});

	// a staking step names its validator as its own page does: the list of
	// validators is asked for only when the log holds such a step
	const listed = docs.data?.listed;
	const validators = useValidators(
		network,
		!!listed?.some((x) => stakingActionOf(x.proposal.payload.action)),
	);
	const entries = useMemo(() => {
		const moves = moveRefs(listed ?? [], validators);
		return buildTimeline(events, {
			me,
			line: (digest) => {
				const p = docs.data?.proposals.get(digest);
				return p ? actionLine(p.payload.action, validators) : null;
			},
			title: (digest) => docs.data?.proposals.get(digest)?.meta.title ?? null,
			// the two steps of a move read as one entry where both say the same
			move: (digest) => moves.get(digest) ?? null,
		});
	}, [events, docs.data, listed, validators, me]);
	const issue = queryIssue(pages.error);

	const save = () =>
		download(
			historyFilename(network, address),
			historyExport({
				network,
				treasury: address,
				exportedAt: Date.now(),
				events,
				proposals: [...(docs.data?.proposals.values() ?? [])],
			}),
			"application/json",
		);

	return (
		<>
			<Card
				title={
					<span className="inline-flex items-center gap-1.5">
						Signing log <Help k="recordAndLog" />
					</span>
				}
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
					<Empty>Reading the signing log…</Empty>
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
								<When
									at={e.at}
									className="pt-0.5 text-xs text-subtle-foreground"
								/>
								<span className="text-sm [overflow-wrap:anywhere]">
									<Sentence parts={e.parts} />
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
				Kept by this tool: who proposed, who signed and who submitted. What
				Hyperliquid itself recorded (transfers, trades) is under “On
				Hyperliquid”. The export holds every entry loaded above and the
				proposals they refer to.
			</p>
		</>
	);
}
