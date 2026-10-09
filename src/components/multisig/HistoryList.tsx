import { decodeProposal, describeAction, type Network } from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel } from "#/components/hub/layout";
import {
	Callout,
	formatTimestamp,
	NetworkBadge,
	Pill,
} from "#/components/hub/status";
import { short } from "#/components/tools/multisig/AddressLine";
import { errorMessage } from "#/hooks/useHyperliquid";
import {
	deleteProposal,
	listProposals,
	type StoredProposal,
} from "./model/history";
import { RELAY_COPY } from "./model/relay/copy";
import { useRelay } from "./relay/useRelay";

function headline(row: StoredProposal): string {
	const p = decodeProposal(row.doc).proposal;
	return p ? describeAction(p.payload.action).headline : row.actionType;
}

function Row({ row, onDelete }: { row: StoredProposal; onDelete: () => void }) {
	const what = useMemo(() => headline(row), [row]);
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
					<span>
						{row.signatures} signature{row.signatures === 1 ? "" : "s"}
					</span>
					{row.submitted === "ok" && <Pill tone="success">submitted</Pill>}
					{row.submitted === "error" && <Pill tone="danger">rejected</Pill>}
					<span className="font-mono">
						{formatTimestamp(row.updatedAt).slice(0, 16)} UTC
					</span>
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
	const rows = (query.data ?? []).filter((r) => all || r.network === network);
	const hidden = (query.data?.length ?? 0) - rows.length;
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
					{rows.map((row) => (
						<Row
							key={row.digest}
							row={row}
							onDelete={async () => {
								await deleteProposal(row.digest);
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
