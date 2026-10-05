import {
	type ChannelState,
	diffChannelState,
	infoClient,
	type Network,
	WS_CHANNELS,
	type WsChannelSpec,
} from "@hl-tools/core";
import { Activity, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import { DiffView } from "#/components/hub/DiffView";
import { KeyValueGrid, Panel } from "#/components/hub/layout";
import { Callout, formatTimestamp, Pill } from "#/components/hub/status";
import { cn } from "#/lib/utils";
import type {
	DisconnectInfo,
	ReconnectInfo,
	StreamItem,
} from "./useWsWorkbench";

function pretty(text: string): string {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

function sortedJson(state: ChannelState): string {
	const keys = Object.keys(state).sort();
	return JSON.stringify(
		Object.fromEntries(keys.map((k) => [k, state[k]])),
		null,
		2,
	);
}

/** Time since the last data message, coloured by staleness. */
export function Freshness({
	lastDataAt,
	spec,
	live,
}: {
	lastDataAt: number | null;
	spec: WsChannelSpec | null;
	live: boolean;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(t);
	}, []);
	if (!lastDataAt)
		return <span className="text-xs text-muted-foreground">no data yet</span>;
	const age = Math.max(0, now - lastDataAt);
	const sparse =
		spec?.type === "bbo" || spec?.semantics === "events" || spec?.userSpecific;
	const tone = !live
		? "text-muted-foreground"
		: age < 2_000
			? "text-success"
			: age < 10_000
				? "text-warning"
				: sparse
					? "text-muted-foreground"
					: "text-danger";
	return (
		<span
			className={cn("inline-flex items-center gap-1.5 font-mono text-xs", tone)}
		>
			<span
				className={cn(
					"size-2 rounded-full bg-current",
					live && age < 2_000 && "animate-pulse",
				)}
				aria-hidden
			/>
			last data {(age / 1000).toFixed(1)} s ago
			{sparse && age >= 10_000 && live && (
				<span className="font-sans text-muted-foreground">
					(silence is normal on this channel)
				</span>
			)}
		</span>
	);
}

export function StreamList({ items }: { items: StreamItem[] }) {
	const [open, setOpen] = useState<number | null>(null);
	if (items.length === 0)
		return (
			<p className="px-4 py-6 text-center text-sm text-muted-foreground">
				Messages appear here as they arrive, newest first.
			</p>
		);
	return (
		<ul
			className="scrollbar-thin max-h-[30rem] divide-y divide-border overflow-y-auto"
			aria-label="Live messages"
			aria-live="off"
		>
			{items.map((m) => (
				<li key={m.id}>
					<button
						type="button"
						onClick={() => setOpen((o) => (o === m.id ? null : m.id))}
						aria-expanded={open === m.id}
						className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-1.5 text-left font-mono text-xs hover:bg-surface-2"
					>
						<ChevronRight
							className={cn(
								"size-3 text-subtle-foreground transition-transform",
								open === m.id && "rotate-90",
							)}
							aria-hidden
						/>
						<span className="text-subtle-foreground">
							{new Date(m.at).toISOString().slice(11, 23)}
						</span>
						<span className="min-w-0 truncate">
							<span
								className={cn(
									"mr-2",
									m.dir === "out"
										? "text-info"
										: m.dir === "event"
											? "text-warning"
											: "text-syn-key",
								)}
							>
								{m.dir === "out" ? "→" : m.dir === "event" ? "•" : "←"}{" "}
								{m.channel}
							</span>
							<span className="text-muted-foreground">{m.summary}</span>
						</span>
						<span className="text-subtle-foreground">
							{m.size ? `${m.size} B` : ""}
						</span>
					</button>
					{open === m.id && m.text && (
						<pre className="scrollbar-thin max-h-72 overflow-auto bg-surface-2/60 px-4 py-2 font-mono text-[11.5px] leading-relaxed">
							{pretty(m.text)}
						</pre>
					)}
				</li>
			))}
		</ul>
	);
}

export function MessageBlock({
	title,
	item,
	empty,
}: {
	title: string;
	item: StreamItem | null;
	empty: string;
}) {
	return item ? (
		<CodeBlock
			title={`${title} · ${new Date(item.at).toISOString().slice(11, 23)} UTC`}
			content={pretty(item.text)}
			maxHeight="16rem"
		/>
	) : (
		<div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
			{empty}
		</div>
	);
}

export function SemanticsCard({ spec }: { spec: WsChannelSpec }) {
	return (
		<Panel title={`${spec.label} semantics`} description={spec.description}>
			<KeyValueGrid
				columns={1}
				items={[
					{ label: "Message channel", value: spec.channel, mono: true },
					{
						label: "Model",
						value:
							spec.semantics === "snapshot"
								? "Each message is the full current state"
								: spec.semantics === "snapshot-then-deltas"
									? "Snapshot first, then only new items"
									: "Events only, no snapshot",
					},
					{
						label: "Sequence number / resume cursor",
						value: <Pill tone="unknown">none</Pill>,
					},
					{
						label: "Dedupe / ordering key",
						value: spec.identity ?? "—",
						mono: true,
					},
					{
						label: "Ordering & recovery",
						value: (
							<span className="text-sm leading-relaxed text-muted-foreground">
								{spec.ordering}
							</span>
						),
					},
				]}
			/>
		</Panel>
	);
}

export function ChannelTable() {
	return (
		<div className="scrollbar-thin overflow-x-auto rounded-lg border border-border">
			<table className="w-full min-w-[720px] border-collapse text-sm">
				<thead>
					<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
						<th className="px-4 py-2 font-medium">channel</th>
						<th className="px-3 py-2 font-medium">snapshot on subscribe</th>
						<th className="px-3 py-2 font-medium">sequence / cursor</th>
						<th className="px-3 py-2 font-medium">dedupe key</th>
						<th className="px-3 py-2 font-medium">after a reconnect</th>
					</tr>
				</thead>
				<tbody>
					{WS_CHANNELS.map((c) => (
						<tr
							key={c.type}
							className="border-b border-border/60 align-top last:border-0"
						>
							<td className="px-4 py-2">
								<div className="font-mono text-[13px]">{c.type}</div>
								{c.channel !== c.type && (
									<div className="text-2xs text-muted-foreground">
										arrives on "{c.channel}"
									</div>
								)}
							</td>
							<td className="px-3 py-2">
								{c.semantics === "events" ? (
									<Pill>no</Pill>
								) : c.semantics === "snapshot" ? (
									<Pill tone="success">every message</Pill>
								) : (
									<Pill tone="info">first message</Pill>
								)}
							</td>
							<td className="px-3 py-2">
								<Pill tone="unknown">none</Pill>
							</td>
							<td className="px-3 py-2 font-mono text-xs">
								{c.identity ?? "—"}
							</td>
							<td className="px-3 py-2 text-xs text-muted-foreground">
								{c.semantics === "snapshot"
									? "Replace state with the next message."
									: c.semantics === "snapshot-then-deltas"
										? "Re-subscribe, merge the snapshot by key; gaps longer than the snapshot need REST backfill."
										: "Events during the gap are lost; backfill via REST (e.g. openOrders, historicalOrders)."}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

interface GapResult {
	missedTotal: number;
	recovered: number;
	source: string;
	observedAt: number;
}

function useGapAnalysis(
	network: Network | null,
	spec: WsChannelSpec | null,
	sub: Record<string, unknown> | null,
	disconnect: DisconnectInfo | null,
	reconnect: ReconnectInfo | null,
) {
	const [gap, setGap] = useState<GapResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setGap(null);
		setError(null);
		if (
			!network ||
			!spec ||
			!sub ||
			!disconnect ||
			!reconnect?.settledAt ||
			!reconnect.stateAfter
		)
			return;
		const after = reconnect.stateAfter;
		const from = disconnect.at;
		const to = reconnect.at;
		let cancelled = false;
		(async () => {
			try {
				if (spec.type === "trades") {
					const r = await infoClient(network).info<
						{ time: number; tid: number }[]
					>({ type: "recentTrades", coin: String(sub.coin) }, { ttlMs: 0 });
					const inGap = r.data.filter((t) => t.time >= from && t.time <= to);
					const recovered = inGap.filter(
						(t) => `${t.time}:${t.tid}` in after,
					).length;
					if (!cancelled)
						setGap({
							missedTotal: inGap.length,
							recovered,
							source: "recentTrades (REST)",
							observedAt: r.observedAt,
						});
				} else if (spec.type === "userFills") {
					const r = await infoClient(network).info<
						{ hash: string; tid: number }[]
					>(
						{
							type: "userFillsByTime",
							user: String(sub.user),
							startTime: from,
							endTime: to,
						},
						{ ttlMs: 0 },
					);
					const recovered = r.data.filter(
						(f) => `${f.hash}:${f.tid}` in after,
					).length;
					if (!cancelled)
						setGap({
							missedTotal: r.data.length,
							recovered,
							source: "userFillsByTime (REST)",
							observedAt: r.observedAt,
						});
				}
			} catch (e) {
				if (!cancelled) setError((e as Error).message);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [network, spec, sub, disconnect, reconnect]);
	return { gap, error };
}

export function DisconnectDiff({
	network,
	spec,
	subscription,
	disconnect,
	reconnect,
}: {
	network: Network | null;
	spec: WsChannelSpec | null;
	subscription: Record<string, unknown> | null;
	disconnect: DisconnectInfo | null;
	reconnect: ReconnectInfo | null;
}) {
	const { gap, error } = useGapAnalysis(
		network,
		spec,
		subscription,
		disconnect,
		reconnect,
	);
	if (!disconnect) return null;
	const settled = reconnect?.settledAt && reconnect.stateAfter;
	const diff = settled
		? diffChannelState(
				disconnect.stateBefore,
				reconnect.stateAfter as ChannelState,
			)
		: null;
	return (
		<Panel
			title={
				<span className="flex items-center gap-2">
					<Activity className="size-4 text-warning" aria-hidden /> State before
					disconnect vs after reconnect
				</span>
			}
			description={
				reconnect
					? `Disconnected ${formatTimestamp(disconnect.at)}, reconnected ${formatTimestamp(reconnect.at)} (${((reconnect.at - disconnect.at) / 1000).toFixed(1)} s gap).`
					: `Disconnected ${formatTimestamp(disconnect.at)}. Reconnect to compare.`
			}
		>
			{!reconnect ? (
				<Callout tone="info" title="The socket is closed locally">
					The server keeps sending to a connection that no longer exists; those
					messages are gone. Press <strong>Reconnect</strong> to re-subscribe
					and see what the fresh snapshot recovers.
				</Callout>
			) : !settled ? (
				<p className="text-sm text-muted-foreground">
					Waiting for the first message after re-subscribing…
				</p>
			) : (
				<div className="space-y-4">
					<div className="flex flex-wrap gap-2 text-xs">
						<Pill tone="success">{diff?.added.length ?? 0} added</Pill>
						<Pill tone="danger">{diff?.removed.length ?? 0} removed</Pill>
						<Pill tone="warning">{diff?.changed.length ?? 0} changed</Pill>
						<Pill>{diff?.unchanged ?? 0} unchanged</Pill>
					</div>
					{spec?.semantics === "snapshot" ? (
						<Callout
							tone="success"
							title="Snapshot channel: nothing to backfill"
						>
							Every {spec.type} message is complete state, so the first message
							after reconnecting replaces whatever was missed. The diff shows
							how the state moved during the gap.
						</Callout>
					) : gap ? (
						<Callout
							tone={gap.missedTotal > gap.recovered ? "warning" : "success"}
							title={`${gap.missedTotal} ${spec?.type === "trades" ? "trades" : "fills"} happened during the gap; the re-subscribe snapshot recovered ${gap.recovered}`}
						>
							Observed via {gap.source} at {formatTimestamp(gap.observedAt)}.{" "}
							{gap.missedTotal > gap.recovered
								? "The rest must be backfilled from REST — there is no sequence number to resume from."
								: "The snapshot covered the gap this time; a longer gap would not be covered."}
						</Callout>
					) : error ? (
						<Callout tone="danger" title="Could not check the gap via REST">
							{error}
						</Callout>
					) : spec?.type === "trades" || spec?.type === "userFills" ? (
						<p className="text-sm text-muted-foreground">
							Checking the gap against REST…
						</p>
					) : (
						<Callout tone="unknown" title="Gap not measurable for this channel">
							{spec?.type} has no REST equivalent hl-core can compare against
							automatically.
						</Callout>
					)}
					<DiffView
						left={sortedJson(disconnect.stateBefore)}
						right={sortedJson(reconnect.stateAfter as ChannelState)}
						leftLabel="before disconnect"
						rightLabel="after reconnect"
						maxHeight="24rem"
					/>
				</div>
			)}
		</Panel>
	);
}
