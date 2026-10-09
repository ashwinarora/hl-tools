/**
 * Small pieces the Multisig section's screens are built from. The section has
 * its own shell inside the hub (a rail and a page head instead of the tool
 * header), and these keep its lists, tags and counts looking the same on
 * every screen. Sizes follow the approved mockup; colours are the hub's.
 */
import type { Network } from "@hl-tools/core";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

/** The rail shows from this width up; below it the mobile bar takes over. */
export const SHELL_WIDE = 861;

export function PageHead({
	title,
	meta,
	actions,
	back,
}: {
	title: ReactNode;
	/** A wrapping row of small facts under the title. */
	meta?: ReactNode;
	actions?: ReactNode;
	/** A way back, shown above the title. */
	back?: ReactNode;
}) {
	return (
		<>
			{back && <div className="mb-2.5">{back}</div>}
			<header className="mb-4 flex flex-wrap items-end justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-balance text-[19px] font-semibold tracking-tight [overflow-wrap:anywhere] min-[861px]:text-[22px]">
						{title}
					</h1>
					{meta && (
						<div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
							{meta}
						</div>
					)}
				</div>
				{actions && (
					<div className="flex flex-wrap items-center gap-2">{actions}</div>
				)}
			</header>
		</>
	);
}

export type TagTone = "gray" | "you" | "warn" | "ok" | "info" | "danger";

const TAG: Record<TagTone, string> = {
	gray: "border-border bg-surface-2 text-muted-foreground",
	you: "border-transparent bg-brand-soft text-brand",
	warn: "border-warning/35 bg-warning-soft text-warning",
	ok: "border-success/35 bg-success-soft text-success",
	info: "border-info/35 bg-info-soft text-info",
	danger: "border-danger/35 bg-danger-soft text-danger",
};

/** A rounded label: a state, a role, a risk. */
export function Tag({
	tone = "gray",
	children,
	className,
	title,
}: {
	tone?: TagTone;
	children: ReactNode;
	className?: string;
	title?: string;
}) {
	return (
		<span
			title={title}
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium",
				TAG[tone],
				className,
			)}
		>
			{children}
		</span>
	);
}

export function NetTag({ network }: { network: Network }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium",
				network === "mainnet"
					? "border-mainnet/40 text-mainnet"
					: "border-testnet/40 text-testnet",
			)}
		>
			<span
				className={cn(
					"size-[7px] rounded-full",
					network === "mainnet" ? "bg-mainnet" : "bg-testnet",
				)}
				aria-hidden
			/>
			{network}
		</span>
	);
}

/** Every page of the section says once, quietly, that it is not read-only. */
export function SignsTag() {
	return (
		<Tag title="This section signs with your wallet and submits to Hyperliquid">
			Signs &amp; sends
		</Tag>
	);
}

export function Count({
	n,
	quiet = false,
	label,
}: {
	n: number;
	/** Grey instead of the brand colour: a number, not a call to act. */
	quiet?: boolean;
	/** What is being counted, for screen readers (e.g. "need you"). */
	label?: string;
}) {
	return (
		<span
			className={cn(
				"inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
				quiet
					? "bg-surface-3 text-muted-foreground"
					: "bg-brand text-brand-foreground",
			)}
		>
			{n}
			{label && <span className="sr-only"> {label}</span>}
		</span>
	);
}

/** Signatures collected against the threshold. */
export function Pips({ have, need }: { have: number; need: number }) {
	const shown = Math.min(have, need);
	return (
		<span className="inline-flex items-center gap-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
			<span className="inline-flex gap-[3px]" aria-hidden>
				{Array.from({ length: need }, (_, i) => (
					<i
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of identical marks
						key={i}
						className={cn(
							"h-1.5 w-3.5 rounded-[3px]",
							i < shown ? "bg-brand" : "bg-surface-3",
						)}
					/>
				))}
			</span>
			{shown} of {need}
		</span>
	);
}

export function GroupTitle({
	children,
	count,
}: {
	children: ReactNode;
	count?: number;
}) {
	return (
		<p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
			{children}
			{count !== undefined && <Count n={count} quiet />}
		</p>
	);
}

/** A bordered card; `Rows` inside it makes a list. */
export function Card({
	title,
	actions,
	children,
	className,
	bodyClassName,
	flush = false,
}: {
	title?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
	/** No padding around the body (lists, timelines). */
	flush?: boolean;
}) {
	return (
		<section
			className={cn(
				"min-w-0 rounded-[10px] border border-border bg-surface shadow-[var(--shadow-card)]",
				className,
			)}
		>
			{(title || actions) && (
				<header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-4 py-3">
					{title && <h2 className="text-sm font-semibold">{title}</h2>}
					{actions && (
						<div className="flex flex-wrap items-center gap-2">{actions}</div>
					)}
				</header>
			)}
			<div className={cn(!flush && "p-4", bodyClassName)}>{children}</div>
		</section>
	);
}

export function Empty({ children }: { children: ReactNode }) {
	return (
		<div className="px-4 py-7 text-center text-sm text-muted-foreground">
			{children}
		</div>
	);
}

/** Buttons at the mockup's two heights (34 and 28 px). */
export function Btn({
	size = "md",
	className,
	...props
}: Omit<ComponentProps<typeof Button>, "size"> & { size?: "md" | "sm" }) {
	return (
		<Button
			size="sm"
			className={cn(
				size === "md" ? "h-[34px] px-3.5 text-[13px]" : "h-7 px-2.5 text-xs",
				className,
			)}
			{...props}
		/>
	);
}

/** The same look for a link that should read as a button. */
export const linkButton =
	"inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-surface px-3.5 text-[13px] font-medium no-underline transition-colors hover:bg-surface-2";
export const linkButtonSm =
	"inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium no-underline transition-colors hover:bg-surface-2";
export const backLink =
	"inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground no-underline transition-colors hover:bg-surface-2 hover:text-foreground";

/** The tabs of a treasury page. `aria-selected` carries the state, as in the mockup. */
export function TabList<T extends string>({
	label,
	value,
	tabs,
	onChange,
}: {
	label: string;
	value: T;
	tabs: readonly { value: T; label: ReactNode; count?: number }[];
	onChange: (value: T) => void;
}) {
	return (
		<div
			role="tablist"
			aria-label={label}
			className="mb-4 flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]"
		>
			{tabs.map((t) => (
				<button
					key={t.value}
					type="button"
					role="tab"
					aria-selected={t.value === value}
					onClick={() => onChange(t.value)}
					className={cn(
						"inline-flex items-center gap-[7px] whitespace-nowrap border-b-2 px-3 py-[9px] text-sm transition-colors",
						t.value === value
							? "border-brand font-medium text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
				>
					{t.label}
					{t.count ? <Count n={t.count} quiet /> : null}
				</button>
			))}
		</div>
	);
}

/** One line of a list of people: who, then what is true of them. */
export function PersonRow({
	children,
	trailing,
}: {
	children: ReactNode;
	trailing?: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-2.5 border-t border-border py-[9px] first:border-t-0 first:pt-0 last:pb-0">
			<span className="min-w-0">{children}</span>
			{trailing}
		</div>
	);
}

/**
 * "3 minutes ago", for "last checked". No seconds: the caller's clock ticks a
 * few times a minute, and a count of seconds would be stale as it is read.
 */
export function ago(then: number, now: number): string {
	const s = Math.max(0, Math.round((now - then) / 1000));
	if (s < 30) return "just now";
	if (s < 60) return "less than a minute ago";
	const m = Math.round(s / 60);
	if (m < 60) return m === 1 ? "a minute ago" : `${m} minutes ago`;
	const h = Math.round(m / 60);
	if (h < 48) return h === 1 ? "an hour ago" : `${h} hours ago`;
	return `${Math.round(h / 24)} days ago`;
}
