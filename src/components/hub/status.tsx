import type { Issue, Network } from "@hl-tools/core";
import {
	AlertTriangle,
	CheckCircle2,
	CircleHelp,
	Info,
	OctagonX,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "#/lib/utils";

export type Tone =
	| "danger"
	| "warning"
	| "info"
	| "unknown"
	| "success"
	| "neutral";

const TONE: Record<
	Tone,
	{ box: string; icon: string; Icon: typeof Info; label: string }
> = {
	danger: {
		box: "border-danger/35 bg-danger-soft",
		icon: "text-danger",
		Icon: OctagonX,
		label: "Error",
	},
	warning: {
		box: "border-warning/35 bg-warning-soft",
		icon: "text-warning",
		Icon: AlertTriangle,
		label: "Warning",
	},
	info: {
		box: "border-info/30 bg-info-soft",
		icon: "text-info",
		Icon: Info,
		label: "Note",
	},
	unknown: {
		box: "border-unknown/35 border-dashed bg-unknown-soft",
		icon: "text-unknown",
		Icon: CircleHelp,
		label: "Unknown",
	},
	success: {
		box: "border-success/30 bg-success-soft",
		icon: "text-success",
		Icon: CheckCircle2,
		label: "OK",
	},
	neutral: {
		box: "border-border bg-surface-2",
		icon: "text-muted-foreground",
		Icon: Info,
		label: "Note",
	},
};

export function Callout({
	tone,
	title,
	children,
	action,
	className,
}: {
	tone: Tone;
	title: ReactNode;
	children?: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	const t = TONE[tone];
	return (
		<div
			role={tone === "danger" ? "alert" : "status"}
			className={cn(
				"flex gap-3 rounded-lg border px-3.5 py-3",
				t.box,
				className,
			)}
		>
			<t.Icon className={cn("mt-0.5 size-4 shrink-0", t.icon)} aria-hidden />
			<div className="min-w-0 flex-1 space-y-1 text-sm">
				<div className="font-medium text-foreground">{title}</div>
				{children && (
					<div className="text-muted-foreground [&_code]:rounded [&_code]:bg-surface/60 [&_code]:px-1 [&_code]:text-[0.92em] [&_code]:text-foreground">
						{children}
					</div>
				)}
				{action && <div className="pt-1">{action}</div>}
			</div>
		</div>
	);
}

const SEVERITY_TONE: Record<Issue["severity"], Tone> = {
	error: "danger",
	warning: "warning",
	info: "info",
};

export function IssueList({
	issues,
	empty,
	onSelectPath,
}: {
	issues: readonly Issue[];
	empty?: ReactNode;
	onSelectPath?: (path: string) => void;
}) {
	if (issues.length === 0) return <>{empty ?? null}</>;
	const order = { error: 0, warning: 1, info: 2 } as const;
	const sorted = [...issues].sort(
		(a, b) => order[a.severity] - order[b.severity],
	);
	return (
		<ul className="space-y-2">
			{sorted.map((i, idx) => {
				const t = TONE[SEVERITY_TONE[i.severity]];
				return (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: issues can repeat codes
						key={`${i.code}-${idx}`}
						className={cn(
							"flex gap-3 rounded-lg border px-3 py-2.5 text-sm",
							t.box,
						)}
					>
						<t.Icon
							className={cn("mt-0.5 size-4 shrink-0", t.icon)}
							aria-hidden
						/>
						<div className="min-w-0 flex-1 space-y-1">
							<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
								<span className="font-medium text-foreground">{i.message}</span>
							</div>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
								{i.path &&
									(onSelectPath ? (
										<button
											type="button"
											className="font-mono text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-foreground"
											onClick={() => onSelectPath(i.path as string)}
										>
											{i.path}
										</button>
									) : (
										<span className="font-mono text-foreground/80">
											{i.path}
										</span>
									))}
								<span className="font-mono">{i.code}</span>
								{i.fix && <span>Fix: {i.fix}</span>}
							</div>
						</div>
					</li>
				);
			})}
		</ul>
	);
}

export type Evidence = "observed" | "inferred" | "unknown";

const EVIDENCE: Record<
	Evidence,
	{ cls: string; label: string; title: string }
> = {
	observed: {
		cls: "border-success/40 bg-success-soft text-success",
		label: "observed",
		title: "Read directly from the chain or API",
	},
	inferred: {
		cls: "border-info/40 bg-info-soft text-info",
		label: "inferred",
		title: "Derived from observed data by a rule or heuristic",
	},
	unknown: {
		cls: "border-unknown/40 border-dashed bg-unknown-soft text-unknown",
		label: "unknown",
		title: "Could not be determined from available data",
	},
};

export function EvidenceBadge({ kind }: { kind: Evidence }) {
	const e = EVIDENCE[kind];
	return (
		<span
			title={e.title}
			className={cn(
				"inline-flex h-5 items-center rounded border px-1.5 font-mono text-2xs font-medium uppercase tracking-wide",
				e.cls,
			)}
		>
			{e.label}
		</span>
	);
}

export function NetworkBadge({
	network,
	className,
}: {
	network: Network;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center gap-1.5 rounded border px-1.5 font-mono text-2xs font-medium uppercase tracking-wide",
				network === "mainnet"
					? "border-mainnet/40 text-mainnet"
					: "border-testnet/45 text-testnet",
				className,
			)}
		>
			<span
				className={cn(
					"size-1.5 rounded-full",
					network === "mainnet" ? "bg-mainnet" : "bg-testnet",
				)}
				aria-hidden
			/>
			{network}
		</span>
	);
}

function formatAgo(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 5) return "just now";
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	return `${h}h ago`;
}

export function formatTimestamp(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number, w = 2) => String(n).padStart(w, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)} UTC`;
}

/** "mainnet · observed 2026-09-28 16:47:03.120 UTC (12s ago)" */
export function ObservedLine({
	network,
	observedAt,
	source,
	className,
}: {
	network: Network;
	observedAt: number;
	source?: string;
	className?: string;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 5000);
		return () => clearInterval(t);
	}, []);
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground",
				className,
			)}
		>
			<NetworkBadge network={network} />
			<span>
				observed{" "}
				<time
					dateTime={new Date(observedAt).toISOString()}
					className="font-mono"
				>
					{formatTimestamp(observedAt)}
				</time>{" "}
				<span className="text-subtle-foreground">
					({formatAgo(now - observedAt)})
				</span>
			</span>
			{source && (
				<span className="truncate font-mono text-subtle-foreground">
					{source}
				</span>
			)}
		</div>
	);
}

export function Pill({
	tone = "neutral",
	children,
	className,
	title,
}: {
	tone?: Tone;
	children: ReactNode;
	className?: string;
	title?: string;
}) {
	const cls: Record<Tone, string> = {
		danger: "border-danger/40 text-danger",
		warning: "border-warning/45 text-warning",
		info: "border-info/40 text-info",
		unknown: "border-unknown/45 border-dashed text-unknown",
		success: "border-success/40 text-success",
		neutral: "border-border-strong text-muted-foreground",
	};
	return (
		<span
			title={title}
			className={cn(
				"inline-flex h-5 items-center rounded border px-1.5 font-mono text-2xs font-medium whitespace-nowrap",
				cls[tone],
				className,
			)}
		>
			{children}
		</span>
	);
}
