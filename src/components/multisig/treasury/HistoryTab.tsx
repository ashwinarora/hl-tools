import type { Address, Hex } from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";
import { formatTimestamp } from "#/components/hub/status";
import type { TreasuryRow } from "../model/relay/rows";
import { buildTimeline } from "../model/relay/timeline";
import { listEvents } from "../relay/api";
import { unwrap } from "../relay/queries";
import { queryIssue, useRelay } from "../relay/useRelay";
import { Card, Empty } from "../shell/kit";

/**
 * Who did what, and when: the relay's record for this treasury. Hyperliquid
 * itself only records what the treasury did, never who proposed or signed.
 */
export function HistoryTab({
	treasury,
	me,
	line = () => null,
}: {
	treasury: TreasuryRow;
	me: Address | null;
	/** The action in words for a proposal, when its document is at hand. */
	line?: (digest: Hex) => string | null;
}) {
	const relay = useRelay();
	const query = useQuery({
		queryKey: [
			"relay",
			relay.wallet,
			"history",
			treasury.network,
			treasury.address,
		],
		enabled: !!relay.client,
		queryFn: async () =>
			unwrap(
				await listEvents(
					relay.client as NonNullable<typeof relay.client>,
					treasury.network,
					treasury.address,
				),
			),
		staleTime: 15_000,
		retry: 1,
	});
	const issue = queryIssue(query.error);
	const entries = buildTimeline(query.data?.rows ?? [], { me, line });

	return (
		<>
			<Card title="History" flush>
				{query.isPending ? (
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
											// biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed sentence
											<span key={i}>{p.text}</span>
										),
									)}
								</span>
							</li>
						))}
					</ul>
				)}
			</Card>
			<p className="mx-0.5 mt-2 text-xs text-subtle-foreground">
				Who proposed and who signed is recorded here. Hyperliquid itself only
				records what the treasury did.
			</p>
		</>
	);
}
