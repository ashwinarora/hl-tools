/** Small pieces shared by the screens that show live figures and local times. */
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "#/lib/utils";
import { signOf } from "../model/chain/columns";
import type { LiveStatus } from "../model/live/account";
import { isoDateTime, localDateTime, utcDateTime } from "../model/time";

/** The current time, re-read every `everyMs` so "… ago" texts stay true. */
export function useNow(everyMs = 15_000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(t);
	}, [everyMs]);
	return now;
}

/** A moment in the reader's own zone; hovering shows the same moment in UTC. */
export function When({
	at,
	seconds = false,
	className,
}: {
	at: number;
	seconds?: boolean;
	className?: string;
}) {
	return (
		<time
			dateTime={isoDateTime(at)}
			title={utcDateTime(at)}
			className={className}
		>
			{localDateTime(at, {}, { seconds })}
		</time>
	);
}

/** Green for a gain, red for a loss, plain for neither. */
export const toneOf = (v: string | null | undefined): string | undefined => {
	const s = signOf(v);
	return s > 0 ? "text-success" : s < 0 ? "text-danger" : undefined;
};

const LIVE: Record<LiveStatus, { text: string; dot: string; title: string }> = {
	connecting: {
		text: "Connecting…",
		dot: "bg-muted-foreground",
		title: "Opening the connection to Hyperliquid.",
	},
	live: {
		text: "Live",
		dot: "bg-success",
		title: "Pushed by Hyperliquid as it changes.",
	},
	reconnecting: {
		text: "Reconnecting…",
		dot: "bg-warning",
		title:
			"The connection to Hyperliquid was lost. What is shown may be behind until it is back.",
	},
	down: {
		text: "Not updating",
		dot: "bg-danger",
		title:
			"Hyperliquid cannot be reached. What is shown is from before; this page keeps trying.",
	},
	refused: {
		text: "Live updates unavailable",
		dot: "bg-danger",
		title:
			"Hyperliquid would not send live updates to this connection. It limits how many accounts one network address may follow at once.",
	},
};

/** Says, in one small label, whether the figures next to it are current. */
export function LiveBadge({
	status,
	onRetry,
}: {
	status: LiveStatus;
	onRetry?: () => void;
}) {
	const s = LIVE[status];
	return (
		<span className="inline-flex items-center gap-2">
			<output
				title={s.title}
				className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2 py-px text-[11px] font-medium text-muted-foreground"
			>
				<span
					aria-hidden
					className={cn(
						"size-[7px] rounded-full",
						s.dot,
						status === "live" && "motion-safe:animate-pulse",
					)}
				/>
				{s.text}
			</output>
			{(status === "refused" || status === "down") && onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="text-xs text-brand underline underline-offset-2"
				>
					Try again
				</button>
			)}
		</span>
	);
}

/** The line above a group of live tables: where the figures come from, and whether they are current. */
export function SourceLine({
	children,
	status,
	onRetry,
}: {
	children: ReactNode;
	status: LiveStatus;
	onRetry?: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
			<span>{children}</span>
			<LiveBadge status={status} onRetry={onRetry} />
		</div>
	);
}

/** One figure with its label, for a short row of totals. */
export function Figure({
	label,
	value,
	unit,
	extra,
}: {
	label: ReactNode;
	value: ReactNode;
	unit?: string;
	extra?: ReactNode;
}) {
	return (
		<div className="min-w-0 px-4 py-3">
			<dt className="flex items-center gap-1 text-xs text-muted-foreground">
				{label}
				{extra}
			</dt>
			<dd className="mt-0.5 font-mono text-lg tabular-nums [overflow-wrap:anywhere]">
				{value}
				{unit && (
					<span className="ml-1.5 font-sans text-xs text-muted-foreground">
						{unit}
					</span>
				)}
			</dd>
		</div>
	);
}
