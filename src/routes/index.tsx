import { RULE_REGISTRY } from "@hl-tools/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	CornerDownLeft,
	FlaskConical,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { detectInput } from "#/lib/detect";
import { TOOLS, type ToolDef, tool } from "#/lib/tools";
import { cn } from "#/lib/utils";
import { useHandoffStore } from "#/store/handoffStore";

export const Route = createFileRoute("/")({ component: Directory });

function Directory() {
	const readOnly = TOOLS.filter((t) => !t.writes);
	const writes = TOOLS.filter((t) => t.writes);
	const newest = RULE_REGISTRY.map((r) => r.verifiedAt)
		.sort()
		.at(-1);
	return (
		<main>
			<section className="relative overflow-hidden border-b border-border">
				<div
					className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
					aria-hidden
				/>
				<div className="page-wrap relative pb-12 pt-12 sm:pb-16 sm:pt-20">
					<div className="max-w-3xl space-y-5">
						<div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
							<ShieldCheck className="size-3.5 text-brand" aria-hidden />
							Read-only · no wallet required · runs in your browser
						</div>
						<h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
							Understand and verify any Hyperliquid action
						</h1>
						<p className="max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
							Diagnostic tools for developers building on HyperCore and HyperEVM
							— built on one typed, decimal-safe protocol core whose signing is
							checked against the official Python SDK.
						</p>
					</div>
					<PasteBox />
				</div>
			</section>

			<section
				className="page-wrap py-10 sm:py-14"
				aria-labelledby="tools-heading"
			>
				<div className="mb-5 flex flex-wrap items-end justify-between gap-2">
					<div>
						<h2
							id="tools-heading"
							className="text-lg font-semibold tracking-tight"
						>
							Tools
						</h2>
						<p className="text-sm text-muted-foreground">
							Each one answers a specific question or error.
						</p>
					</div>
					<Link
						to="/changes"
						className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						<ShieldCheck className="size-3.5 text-success" aria-hidden />
						{RULE_REGISTRY.length} rule sets · verified {newest}
						<ArrowRight className="size-3" aria-hidden />
					</Link>
				</div>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					{readOnly.map((t) => (
						<ToolCard key={t.id} tool={t} />
					))}
				</div>

				<div className="mt-12">
					<h2 className="mb-1 text-lg font-semibold tracking-tight">
						Also in the hub
					</h2>
					<p className="mb-5 text-sm text-muted-foreground">
						The original hl-tools utility. It is the only tool here that signs
						and sends.
					</p>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
						{writes.map((t) => (
							<ToolCard key={t.id} tool={t} />
						))}
					</div>
				</div>
			</section>
		</main>
	);
}

function ToolCard({ tool: t }: { tool: ToolDef }) {
	return (
		<article
			className={cn(
				"group relative flex min-w-0 flex-col rounded-lg border border-border bg-surface p-5 shadow-[var(--shadow-card)] transition-colors hover:border-border-strong",
				t.flagship && "md:col-span-2 xl:col-span-1 xl:row-span-1",
			)}
		>
			<div className="mb-3 flex items-center justify-between gap-2">
				<span
					className={cn(
						"flex size-9 items-center justify-center rounded-md border border-border bg-surface-2",
						t.writes ? "text-muted-foreground" : "text-brand",
					)}
				>
					<t.icon className="size-4.5" aria-hidden />
				</span>
				{t.flagship && (
					<span className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-soft px-2 py-0.5 text-2xs font-medium text-brand">
						<Sparkles className="size-3" aria-hidden /> Flagship
					</span>
				)}
				{t.writes && (
					<span className="rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-2xs font-medium text-warning">
						Signs &amp; sends
					</span>
				)}
			</div>
			<h3 className="text-base font-semibold tracking-tight">
				<Link
					to={t.path}
					className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
				>
					{t.title}
				</Link>
			</h3>
			<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
				{t.description}
			</p>
			<blockquote className="mt-4 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90">
				{t.answers}
			</blockquote>
			<div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-5">
				<Link
					to={t.path}
					className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
				>
					Open <ArrowRight className="size-3.5" aria-hidden />
				</Link>
				{t.sample && (
					<Link
						to={t.path}
						search={{ sample: t.sample.id } as never}
						className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
						title={`Open pre-filled with: ${t.sample.label}`}
					>
						<FlaskConical className="size-3.5" aria-hidden />
						Try with a sample
					</Link>
				)}
			</div>
		</article>
	);
}

function PasteBox() {
	const [value, setValue] = useState("");
	const detection = useMemo(() => detectInput(value), [value]);
	const navigate = useNavigate();
	const send = useHandoffStore((s) => s.send);
	const go = () => {
		if (!detection) return;
		send(detection.tool, value.trim());
		void navigate({ to: tool(detection.tool).path });
	};
	return (
		<form
			className="mt-8 max-w-3xl"
			onSubmit={(e) => {
				e.preventDefault();
				go();
			}}
		>
			<label
				htmlFor="paste"
				className="mb-2 block text-xs font-medium text-muted-foreground"
			>
				Paste anything — a symbol, tx hash, CoreWriter bytes, signed payload,
				exchange response or RPC URL
			</label>
			<div className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface p-1.5 shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 sm:flex-row sm:items-center">
				<input
					id="paste"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="e.g. HYPE · 0x4b65b9ab…d949 · {&quot;type&quot;:&quot;order&quot;,…}"
					className="h-10 min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm outline-none placeholder:text-subtle-foreground focus-visible:outline-none"
					spellCheck={false}
					autoComplete="off"
					data-private
				/>
				<button
					type="submit"
					disabled={!detection}
					className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
				>
					{detection ? `Open ${tool(detection.tool).short}` : "Open"}
					<CornerDownLeft className="size-3.5" aria-hidden />
				</button>
			</div>
			<p
				className="mt-2 min-h-5 text-xs text-muted-foreground"
				aria-live="polite"
			>
				{value.trim()
					? detection
						? detection.reason
						: "Not recognised — open a tool below."
					: "Detected locally; nothing is sent or added to the URL."}
			</p>
		</form>
	);
}
