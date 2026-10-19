import type { Network } from "@hl-tools/core";
import { ExternalLink } from "lucide-react";
import { cn } from "#/lib/utils";
import { explorerTxUrl } from "../model/chain/columns";
import { TIMELINE_COPY, type Timeline } from "../model/proposalTimeline";
import { Sentence } from "../names/Sentence";
import { Card, Tag } from "../shell/kit";
import { When } from "../shell/live";

/**
 * A proposal's timeline (`model/proposalTimeline.ts`), oldest first: each
 * entry with its moment in the reader's time (UTC on hover), and the
 * transaction on Hyperliquid where there is one.
 */
export function TimelineCard({
	timeline,
	network,
}: {
	timeline: Timeline;
	network: Network;
}) {
	if (timeline.items.length === 0) return null;
	return (
		<Card
			title={TIMELINE_COPY.title}
			footer={
				timeline.fromCopy ? <span>{TIMELINE_COPY.fromCopy}</span> : undefined
			}
		>
			<ol className="flex flex-col gap-3">
				{timeline.items.map((i) => (
					<li key={i.key} className="flex gap-2.5 text-[13px]">
						<span
							aria-hidden
							className={cn(
								"mt-[7px] size-2 shrink-0 rounded-full",
								i.tone === "ok"
									? "bg-success"
									: i.tone === "wrong"
										? "bg-danger"
										: "bg-border-strong",
							)}
						/>
						<div className="min-w-0">
							<p className="[overflow-wrap:anywhere]">
								{i.step !== null && (
									<Tag className="mr-1.5 align-middle">Step {i.step}</Tag>
								)}
								<Sentence parts={i.parts} />
								{i.hash && (
									<>
										{" "}
										<a
											href={explorerTxUrl(network, i.hash)}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-0.5 text-brand underline underline-offset-2"
										>
											{TIMELINE_COPY.transaction}
											<ExternalLink className="size-3" aria-hidden />
										</a>
									</>
								)}
							</p>
							<p className="text-xs text-subtle-foreground">
								{i.at === null ? TIMELINE_COPY.undated : <When at={i.at} />}
							</p>
						</div>
					</li>
				))}
			</ol>
		</Card>
	);
}
