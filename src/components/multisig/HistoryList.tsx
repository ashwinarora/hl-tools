import { decodeProposal, type Network, type Proposal } from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel } from "#/components/hub/layout";
import { Callout, NetworkBadge, Pill } from "#/components/hub/status";
import { short } from "#/components/tools/multisig/AddressLine";
import { errorMessage } from "#/hooks/useHyperliquid";
import {
	deleteProposal,
	listProposals,
	type StoredProposal,
} from "./model/history";
import { moveSentence, pairMoves } from "./model/move";
import { RELAY_COPY } from "./model/relay/copy";
import { actionLine } from "./model/staking";
import { useRelay } from "./relay/useRelay";
import { When } from "./shell/live";

/** One line of the list: a proposal, or the two steps of a move as one. */
interface Entry {
	readonly row: StoredProposal;
	/** The second step, when the line is a move. */
	readonly second: StoredProposal | null;
	/** The action in words. */
	readonly what: string;
}

/**
 * The stored proposals as lines: the two steps of a move are one line, as on
 * every other list. A document that no longer decodes stays a line of its own.
 */
function entriesOf(rows: readonly StoredProposal[]): Entry[] {
	const plain: Entry[] = [];
	const read: (Entry & { proposal: Proposal; proposedBy: null })[] = [];
	for (const row of rows) {
		const proposal = decodeProposal(row.doc).proposal;
		if (!proposal) plain.push({ row, second: null, what: row.actionType });
		else
			read.push({
				row,
				second: null,
				what: actionLine(
					proposal.payload.action,
					null,
					proposal.payload.network,
				),
				proposal,
				// no relay here: the documents' own word for who proposed them is compared
				proposedBy: null,
			});
	}
	const paired = pairMoves(read, (first, second, move) => ({
		...first,
		second: second.row,
		what: moveSentence(move),
	}));
	return [...paired, ...plain].sort(
		(a, b) => b.row.updatedAt - a.row.updatedAt,
	);
}

function Row({ entry, onDelete }: { entry: Entry; onDelete: () => void }) {
	const { row, second, what } = entry;
	const outcomes = [row.submitted, ...(second ? [second.submitted] : [])];
	return (
		<li className="flex items-start justify-between gap-3 px-3 py-2.5">
			<Link
				to="/multisig/proposal"
				search={{ digest: row.digest }}
				className="min-w-0 flex-1 space-y-1 no-underline hover:[&_.title]:underline"
			>
				<span className="title block truncate text-sm font-medium text-foreground">
					{row.title ?? what}
				</span>
				{row.title && (
					<span className="block truncate text-xs text-muted-foreground">
						{what}
					</span>
				)}
				<span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<NetworkBadge network={row.network} />
					<span className="font-mono" title={row.multiSigUser}>
						{short(row.multiSigUser)}
					</span>
					{second ? (
						<>
							<Pill tone="info">2 steps</Pill>
							<span>
								{row.signatures} and {second.signatures} signatures
							</span>
						</>
					) : (
						<span>
							{row.signatures} signature{row.signatures === 1 ? "" : "s"}
						</span>
					)}
					{outcomes.every((o) => o === "ok") ? (
						<Pill tone="success">submitted</Pill>
					) : outcomes.includes("error") ? (
						<Pill tone="danger">rejected</Pill>
					) : outcomes.includes("ok") ? (
						<Pill tone="info">step 1 submitted</Pill>
					) : null}
					<When at={row.updatedAt} />
				</span>
			</Link>
			<button
				type="button"
				onClick={onDelete}
				className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-danger"
				aria-label={`Remove ${row.title ?? what} from this browser`}
				title="Remove from this browser"
			>
				<Trash2 className="size-3.5" aria-hidden />
			</button>
		</li>
	);
}

/** Proposals this browser has opened or made. Not chain data. */
export function HistoryList({ network }: { network: Network }) {
	const client = useQueryClient();
	const [all, setAll] = useState(false);
	const query = useQuery({
		queryKey: ["multisig-proposals"],
		queryFn: () => listProposals(),
		retry: 0,
	});
	// "this browser only" is true of the list; with the relay in use it is not
	// true of every proposal in it, so the sentence does not say it there
	const relayOff = useRelay().mode === "off";
	const rows = useMemo(
		() => (query.data ?? []).filter((r) => all || r.network === network),
		[query.data, all, network],
	);
	const hidden = (query.data?.length ?? 0) - rows.length;
	const entries = useMemo(() => entriesOf(rows), [rows]);
	return (
		<Panel
			title="Recent in this browser"
			description={
				relayOff
					? "Proposals you made or opened here. Stored in this browser only (IndexedDB); the chain knows nothing of a proposal until it is submitted."
					: RELAY_COPY.recentHere
			}
			actions={
				<label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
					<input
						name="all-networks"
						type="checkbox"
						checked={all}
						onChange={(e) => setAll(e.target.checked)}
						className="size-3.5 accent-[var(--brand)]"
					/>
					all networks
				</label>
			}
			bodyClassName="p-0"
		>
			{query.isError ? (
				<div className="p-4">
					<Callout tone="warning" title="Local storage unavailable">
						{errorMessage(query.error)}
					</Callout>
				</div>
			) : rows.length === 0 ? (
				<p className="p-4 text-sm text-muted-foreground">
					{query.isPending
						? "Reading…"
						: hidden > 0
							? `Nothing on ${network}; ${hidden} on the other network.`
							: "Nothing yet."}
				</p>
			) : (
				<ul className="divide-y divide-border/60">
					{entries.map((entry) => (
						<Row
							key={entry.row.digest}
							entry={entry}
							onDelete={async () => {
								await deleteProposal(entry.row.digest);
								// a move leaves this browser whole
								if (entry.second) await deleteProposal(entry.second.digest);
								await client.invalidateQueries({
									queryKey: ["multisig-proposals"],
								});
							}}
						/>
					))}
				</ul>
			)}
		</Panel>
	);
}
