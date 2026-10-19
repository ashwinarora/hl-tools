/**
 * Small pieces the Multisig section's screens are built from. The section has
 * its own shell inside the hub (a rail and a page head instead of the tool
 * header), and these keep its lists, tags and counts looking the same on
 * every screen. Sizes follow the approved mockup; colours are the hub's.
 */
import type { Network } from "@hl-tools/core";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Panel as HubPanel } from "#/components/hub/layout";
import { Button } from "#/components/ui/button";
import { tabsKeyDown } from "#/lib/tabs";
import { cn } from "#/lib/utils";
import { Help } from "./Help";

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

/**
 * The section's teal and green as text on their own soft grounds. In the
 * light theme the hub's tokens sit just under 4.5:1 there (4.46 and 4.61),
 * so the text is a shade darker (6.0:1 and 6.2:1); the dark theme keeps them.
 */
export const BRAND_TEXT = "text-[oklch(0.45_0.1_178)] dark:text-brand";
const SUCCESS_TEXT = "text-[oklch(0.45_0.12_150)] dark:text-success";

const TAG: Record<TagTone, string> = {
	gray: "border-border bg-surface-2 text-muted-foreground",
	you: cn("border-transparent bg-brand-soft", BRAND_TEXT),
	warn: "border-warning/35 bg-warning-soft text-warning",
	ok: cn("border-success/35 bg-success-soft", SUCCESS_TEXT),
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
				"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-xs font-medium",
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
				"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-xs font-medium",
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
		<span className="inline-flex items-center gap-1">
			<Tag title="This section signs with your wallet and sends to Hyperliquid">
				Signs &amp; sends
			</Tag>
			<Help k="signsAndSends" />
		</span>
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
				"inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
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

/**
 * The hub's panel with the section's own title colour: a heading in the
 * Multisig section is the brand's teal, so the eye finds each card's
 * title at a glance (the owner's choice, 2026-10-19).
 */
export function Panel(props: ComponentProps<typeof HubPanel>) {
	return (
		<HubPanel
			{...props}
			titleClassName={cn(BRAND_TEXT, props.titleClassName)}
		/>
	);
}

/** A bordered card, its title in the brand's teal; `Rows` inside it makes a list. */
export function Card({
	title,
	actions,
	children,
	className,
	bodyClassName,
	flush = false,
	footer,
}: {
	title?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
	/** No padding around the body (lists, timelines, tables). */
	flush?: boolean;
	/** A quiet line under the body: where it comes from, a way to more. */
	footer?: ReactNode;
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
					{title && (
						<h2 className={cn("text-sm font-semibold", BRAND_TEXT)}>{title}</h2>
					)}
					{actions && (
						<div className="flex flex-wrap items-center gap-2">{actions}</div>
					)}
				</header>
			)}
			<div className={cn(!flush && "p-4", bodyClassName)}>{children}</div>
			{footer && (
				<footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border px-4 py-2 text-xs text-muted-foreground">
					{footer}
				</footer>
			)}
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

/**
 * A button that cannot be pressed looks it, whatever its colour: a grey
 * fill, a grey label and no coloured edge, never the brand's green at half
 * strength. Its reason is said next to it, in words.
 */
export const OFF_LOOK =
	"disabled:opacity-100 disabled:border-border disabled:bg-surface-3 disabled:text-subtle-foreground disabled:shadow-none";

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
				// a finger's width on a phone, the mockup's heights from `sm` up
				size === "md"
					? "h-11 px-3.5 text-[13px] sm:h-[34px]"
					: "h-11 px-2.5 text-xs sm:h-7",
				className,
				OFF_LOOK,
			)}
			{...props}
		/>
	);
}

/**
 * A step's number in a form's heading, read out with it ("1 · Action"),
 * in a small teal ring.
 */
export function StepNo({ n }: { n: number }) {
	return (
		<span
			className={cn(
				"inline-grid size-[22px] shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold tabular-nums ring-1 ring-brand/30 ring-inset",
				BRAND_TEXT,
			)}
		>
			{n}
			<span className="sr-only"> · </span>
		</span>
	);
}

/** A form's heading with its step's number. */
export function StepTitle({ n, children }: { n: number; children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-2">
			<StepNo n={n} />
			<span>{children}</span>
		</span>
	);
}

/** The same look for a link that should read as a button. */
export const linkButton =
	"inline-flex h-11 sm:h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-surface px-3.5 text-[13px] font-medium no-underline transition-colors hover:bg-surface-2";
export const linkButtonSm =
	"inline-flex h-11 sm:h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium no-underline transition-colors hover:bg-surface-2";
export const backLink =
	"inline-flex h-11 sm:h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground no-underline transition-colors hover:bg-surface-2 hover:text-foreground";

/** The ids that tie a tab to its panel (`aria-controls`, `aria-labelledby`). */
export const tabIds = (base: string, value: string) => ({
	tab: `${base}-tab-${value}`,
	panel: `${base}-panel-${value}`,
});

/**
 * The tabs of a treasury page (WAI-ARIA APG): arrows, Home and End move
 * between them, and only the selected one is in the tab order. Where the
 * row is wider than the screen it scrolls, its edges fade where more tabs
 * are hidden, and the selected tab is scrolled into view.
 */
export function TabList<T extends string>({
	id,
	label,
	value,
	tabs,
	onChange,
	className,
}: {
	/** The base of the tabs' and panels' ids, shared with `TabPanel`. */
	id: string;
	label: string;
	value: T;
	tabs: readonly { value: T; label: ReactNode; count?: number }[];
	onChange: (value: T) => void;
	/** For a row inside a card's header: no margin and no line of its own. */
	className?: string;
}) {
	const row = useRef<HTMLDivElement>(null);
	const [more, setMore] = useState({ left: false, right: false });
	const measure = useCallback(() => {
		const el = row.current;
		if (!el) return;
		const left = el.scrollLeft > 1;
		const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
		setMore((m) =>
			m.left === left && m.right === right ? m : { left, right },
		);
	}, []);
	useEffect(() => {
		const el = row.current;
		if (!el) return;
		measure();
		const seen = new ResizeObserver(measure);
		seen.observe(el);
		return () => seen.disconnect();
	}, [measure]);
	// the selected tab in view, also when a link opened the page on it
	// biome-ignore lint/correctness/useExhaustiveDependencies: `value` is when the selected tab changes
	useEffect(() => {
		row.current
			?.querySelector<HTMLElement>('[aria-selected="true"]')
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [value]);
	const mask =
		more.left || more.right
			? `linear-gradient(to right, ${more.left ? "transparent, black 24px" : "black"}, ${more.right ? "black calc(100% - 24px), transparent" : "black"})`
			: undefined;
	return (
		<div
			ref={row}
			role="tablist"
			aria-label={label}
			onScroll={measure}
			onKeyDown={(e) =>
				tabsKeyDown(
					e,
					tabs.map((t) => t.value),
					value,
					onChange,
				)
			}
			style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
			className={cn(
				"mb-4 flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]",
				className,
			)}
		>
			{tabs.map((t) => {
				const ids = tabIds(id, t.value);
				const selected = t.value === value;
				return (
					<button
						key={t.value}
						id={ids.tab}
						type="button"
						role="tab"
						aria-selected={selected}
						aria-controls={ids.panel}
						tabIndex={selected ? 0 : -1}
						onClick={() => onChange(t.value)}
						className={cn(
							"inline-flex min-h-11 items-center gap-[7px] whitespace-nowrap border-b-2 px-3 py-[9px] text-sm transition-colors sm:min-h-0",
							selected
								? "border-brand font-medium text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{t.label}
						{t.count ? <Count n={t.count} quiet /> : null}
					</button>
				);
			})}
		</div>
	);
}

/** The panel of the selected tab: labelled by it, and reachable with Tab from the row. */
export function TabPanel({
	id,
	value,
	children,
}: {
	id: string;
	value: string;
	children: ReactNode;
}) {
	const ids = tabIds(id, value);
	return (
		<div
			role="tabpanel"
			id={ids.panel}
			aria-labelledby={ids.tab}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: the APG pattern: a panel takes the focus after its tab
			tabIndex={0}
			className="outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-md"
		>
			{children}
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
