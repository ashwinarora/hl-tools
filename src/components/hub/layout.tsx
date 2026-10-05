import { Link } from "@tanstack/react-router";
import {
	ArrowUpRight,
	ChevronRight,
	type LucideIcon,
	ShieldCheck,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { radioGroupKeyDown } from "#/lib/radioGroup";
import { type ToolDef, toolRuleSets, toolVerifiedAt } from "#/lib/tools";
import { cn } from "#/lib/utils";

export function ToolPage({
	tool,
	children,
	aside,
}: {
	tool: ToolDef;
	children: ReactNode;
	aside?: ReactNode;
}) {
	const verified = toolVerifiedAt(tool);
	const rules = toolRuleSets(tool);
	return (
		<main className="page-wrap pb-16 pt-6 sm:pt-8">
			<nav
				aria-label="Breadcrumb"
				className="mb-4 flex items-center gap-1 text-xs text-muted-foreground"
			>
				<Link to="/" className="hover:text-foreground">
					Tools
				</Link>
				<ChevronRight className="size-3" aria-hidden />
				<span className="text-foreground">{tool.title}</span>
			</nav>
			<header className="mb-6 flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
				<div className="min-w-0 max-w-3xl space-y-2">
					<div className="flex items-center gap-2.5">
						<span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface text-brand">
							<tool.icon className="size-4" aria-hidden />
						</span>
						<h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
							{tool.title}
						</h1>
					</div>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{tool.description}
					</p>
				</div>
				<div className="flex shrink-0 flex-col gap-1.5 text-xs text-muted-foreground lg:items-end lg:text-right">
					<div className="flex items-center gap-1.5">
						<ShieldCheck className="size-3.5 text-success" aria-hidden />
						<span>
							Last verified against protocol docs:{" "}
							<Link
								to="/changes"
								className="font-mono text-foreground hover:underline"
							>
								{verified ?? "—"}
							</Link>
						</span>
					</div>
					<a
						href={tool.primarySource.url}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 hover:text-foreground"
					>
						Source: {tool.primarySource.label}
						<ArrowUpRight className="size-3" aria-hidden />
					</a>
					{rules.length > 0 && (
						<div className="font-mono text-2xs text-subtle-foreground">
							rules: {rules.map((r) => `${r.id}@${r.version}`).join(" · ")}
						</div>
					)}
				</div>
			</header>
			{aside}
			{children}
		</main>
	);
}

export function Panel({
	title,
	description,
	actions,
	children,
	className,
	bodyClassName,
	id,
}: {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
	id?: string;
}) {
	return (
		<section
			id={id}
			className={cn(
				"min-w-0 rounded-lg border border-border bg-surface shadow-[var(--shadow-card)]",
				className,
			)}
		>
			{(title || actions) && (
				<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
					<div className="min-w-0 space-y-0.5">
						{title && <h2 className="text-sm font-semibold">{title}</h2>}
						{description && (
							<p className="text-xs leading-relaxed text-muted-foreground">
								{description}
							</p>
						)}
					</div>
					{actions && (
						<div className="flex flex-wrap items-center gap-2">{actions}</div>
					)}
				</div>
			)}
			<div className={cn("p-4", bodyClassName)}>{children}</div>
		</section>
	);
}

export interface KV {
	label: ReactNode;
	value: ReactNode;
	mono?: boolean;
	hint?: ReactNode;
	copy?: string;
}

export function KeyValueGrid({
	items,
	columns = 2,
	className,
}: {
	items: KV[];
	columns?: 1 | 2 | 3;
	className?: string;
}) {
	return (
		<dl
			className={cn(
				"grid gap-x-6 gap-y-3",
				columns === 1 && "grid-cols-1",
				columns === 2 && "grid-cols-1 sm:grid-cols-2",
				columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
				className,
			)}
		>
			{items.map((it, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static list
				<div key={i} className="min-w-0 space-y-0.5">
					<dt className="text-xs text-muted-foreground">{it.label}</dt>
					<dd
						className={cn(
							"min-w-0 break-words text-sm text-foreground",
							it.mono && "font-mono text-[13px]",
						)}
					>
						{it.value}
					</dd>
					{it.hint && (
						<dd className="text-xs text-subtle-foreground">{it.hint}</dd>
					)}
				</div>
			))}
		</dl>
	);
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	sample,
	action,
}: {
	icon?: LucideIcon;
	title: ReactNode;
	description: ReactNode;
	sample?: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface/50 px-6 py-10 text-center">
			{Icon && (
				<span className="flex size-10 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
					<Icon className="size-4" aria-hidden />
				</span>
			)}
			<div className="space-y-1">
				<div className="text-sm font-medium">{title}</div>
				<p className="mx-auto max-w-md text-sm text-muted-foreground">
					{description}
				</p>
			</div>
			{sample && (
				<code className="max-w-full overflow-x-auto rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-foreground">
					{sample}
				</code>
			)}
			{action}
		</div>
	);
}

export function Field({
	label,
	hint,
	error,
	children,
	className,
	htmlFor,
	trailing,
}: {
	label: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	children: ReactNode;
	className?: string;
	htmlFor?: string;
	trailing?: ReactNode;
}) {
	return (
		<div className={cn("min-w-0 space-y-1.5", className)}>
			<div className="flex items-baseline justify-between gap-2">
				<label
					htmlFor={htmlFor}
					className="text-xs font-medium text-foreground"
				>
					{label}
				</label>
				{trailing}
			</div>
			{children}
			{error ? (
				<p className="text-xs text-danger">{error}</p>
			) : hint ? (
				<p className="text-xs text-muted-foreground">{hint}</p>
			) : null}
		</div>
	);
}

const inputBase =
	"w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-subtle-foreground transition-colors focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-60 aria-[invalid=true]:border-danger";

export function TextInput({
	className,
	mono,
	...props
}: ComponentProps<"input"> & { mono?: boolean }) {
	return (
		<input
			className={cn(
				inputBase,
				"h-9",
				mono && "font-mono text-[13px]",
				className,
			)}
			spellCheck={false}
			autoComplete="off"
			{...props}
		/>
	);
}

export function TextArea({
	className,
	mono = true,
	...props
}: ComponentProps<"textarea"> & { mono?: boolean }) {
	return (
		<textarea
			className={cn(
				inputBase,
				"scrollbar-thin min-h-32 resize-y py-2 leading-relaxed",
				mono && "font-mono text-[12.5px]",
				className,
			)}
			spellCheck={false}
			autoComplete="off"
			{...props}
		/>
	);
}

export function Select({
	className,
	children,
	...props
}: ComponentProps<"select">) {
	return (
		<select
			className={cn(inputBase, "h-9 cursor-pointer pr-8", className)}
			{...props}
		>
			{children}
		</select>
	);
}

export function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
	size = "md",
	className,
}: {
	value: T;
	options: readonly { value: T; label: ReactNode; title?: string }[];
	onChange: (v: T) => void;
	label: string;
	size?: "sm" | "md";
	className?: string;
}) {
	const id = useId();
	return (
		<div
			role="radiogroup"
			aria-label={label}
			className={cn(
				"inline-flex max-w-full flex-wrap items-center rounded-md border border-border bg-surface-2 p-0.5",
				className,
			)}
			onKeyDown={(e) =>
				radioGroupKeyDown(
					e,
					options.map((o) => o.value),
					value,
					onChange,
				)
			}
		>
			{options.map((o) => (
				// biome-ignore lint/a11y/useSemanticElements: ARIA radio pattern on buttons keeps the segmented-control styling
				<button
					key={o.value}
					id={`${id}-${o.value}`}
					type="button"
					role="radio"
					aria-checked={o.value === value}
					tabIndex={o.value === value ? 0 : -1}
					title={o.title}
					onClick={() => onChange(o.value)}
					className={cn(
						"rounded font-medium transition-colors",
						size === "sm"
							? "h-6 px-2 text-xs"
							: "h-7 px-2.5 text-xs sm:text-[13px]",
						o.value === value
							? "bg-surface text-foreground shadow-sm ring-1 ring-border"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

/** Two-column tool layout: inputs left, results right; stacks on mobile. */
export function Workspace({
	input,
	output,
	className,
}: {
	input: ReactNode;
	output: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]",
				className,
			)}
		>
			<div className="min-w-0 space-y-5">{input}</div>
			<div className="min-w-0 space-y-5">{output}</div>
		</div>
	);
}

export function SectionHeading({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<h2
			className={cn(
				"text-xs font-semibold uppercase tracking-wider text-muted-foreground",
				className,
			)}
		>
			{children}
		</h2>
	);
}
