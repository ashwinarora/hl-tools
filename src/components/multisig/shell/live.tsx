/** Small pieces shared by the screens that show live figures and local times. */
import { Decimal, shownLine } from "@hl-tools/core";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "#/lib/utils";
import { signOf } from "../model/chain/columns";
import type { LiveStatus } from "../model/live/account";
import { isoDateTime, localDateTime, utcDateTime } from "../model/time";
import { usdcShown } from "../model/vault";

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
			"Hyperliquid would not send live updates to this connection. It limits how many accounts one network address may follow at once: close other Hyperliquid tabs or tools, then reload.",
	},
};

/**
 * Says, in one small label, whether the figures next to it are current, and
 * when they are not, the moment they were last known to be.
 */
export function LiveBadge({
	status,
	asOf = null,
	onRetry,
	reason = null,
}: {
	status: LiveStatus;
	/** See `LiveAccount.asOf`: null while the figures are current. */
	asOf?: number | null;
	onRetry?: () => void;
	/** Hyperliquid's own words when it refused (audit F-067). */
	reason?: string | null;
}) {
	const s = LIVE[status];
	const title =
		status === "refused" && reason
			? `${s.title} Its answer: "${shownLine(reason, 200)}"`
			: s.title;
	return (
		<span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
			{status !== "live" && asOf !== null && (
				<span className="whitespace-nowrap text-xs text-muted-foreground">
					figures as of <When at={asOf} seconds />
				</span>
			)}
			<output
				title={title}
				className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2 py-px text-xs font-medium text-muted-foreground"
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
	asOf = null,
	onRetry,
	reason = null,
}: {
	children: ReactNode;
	status: LiveStatus;
	asOf?: number | null;
	onRetry?: () => void;
	reason?: string | null;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
			<span>{children}</span>
			<LiveBadge
				status={status}
				asOf={asOf}
				onRetry={onRetry}
				reason={reason}
			/>
		</div>
	);
}

/** One figure with its label, for a short row of totals. */
/**
 * A USDC figure cut to the cent, never rounded up (`usdcShown`), with the
 * whole figure on hover where the cut left something out.
 */
export function Usdc({ value }: { value: string | null | undefined }) {
	if (value === null || value === undefined) return <>…</>;
	const shown = usdcShown(value);
	const exact = Decimal.tryParse(value);
	const cut = Decimal.tryParse(shown.replace(/,/g, ""));
	// only where the cut left digits out: "0.00" is the whole of "0"
	const lost = !!exact && !!cut && !exact.eq(cut);
	if (!lost || !exact) return <span>{shown}</span>;
	// the whole figure for the mouse, and for a screen reader
	return (
		<span title={exact.toDisplay()}>
			{shown}
			<span className="sr-only"> (exactly {exact.toDisplay()})</span>
		</span>
	);
}

export function Figure({
	label,
	value,
	unit,
	extra,
	big = false,
}: {
	label: ReactNode;
	value: ReactNode;
	unit?: string;
	extra?: ReactNode;
	/** A key figure at the top of a page, set larger. */
	big?: boolean;
}) {
	return (
		<div className="min-w-0 px-4 py-3">
			<dt className="flex min-h-5 items-center gap-1 text-xs text-muted-foreground">
				{label}
				{extra}
			</dt>
			<dd
				className={cn(
					"mt-0.5 font-mono tabular-nums [overflow-wrap:anywhere]",
					big
						? "mt-1 text-xl font-medium leading-7 tracking-tight min-[861px]:text-2xl"
						: "text-lg min-[861px]:text-xl",
				)}
			>
				{value}
				{unit && (
					<span className="ml-1.5 font-sans text-xs font-normal tracking-normal text-muted-foreground">
						{unit}
					</span>
				)}
			</dd>
		</div>
	);
}
