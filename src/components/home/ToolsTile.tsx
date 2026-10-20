import { Link } from "@tanstack/react-router";
import { TOOLS, type ToolDef } from "#/lib/tools";
import { cn } from "#/lib/utils";
import { TOOL_LINES, TOOLS_TILE } from "./copy";
import { PasteBox } from "./PasteBox";

/** The eight read-only tools: everything in the registry that never signs. */
export const DIAGNOSTICS: readonly ToolDef[] = TOOLS.filter((t) => !t.writes);

/** The inspector's question in the Multisig's words: Hyperliquid, not "the chain". */
export const ANSWERS: Record<string, string> = {
	multisig: 'Why does Hyperliquid answer "Invalid multi-sig inner signer"?',
};

/** A tile's name for each tool: short, and never just "Multisig". */
export const TILE_NAME: Record<string, string> = {
	assets: "Assets",
	signing: "Signing",
	corewriter: "CoreWriter",
	trace: "Trace",
	orders: "Orders",
	websocket: "WebSocket",
	rpc: "RPC probe",
	multisig: "Inspector",
};

/**
 * The developer tools: what can be pasted and a box that takes it, then the
 * eight tools, each with the one line a developer would come to it with.
 */
export function ToolsTile({ className }: { className?: string }) {
	return (
		<article
			aria-labelledby="c-tools"
			style={{ "--c2-delay": "180ms" } as React.CSSProperties}
			className={cn(
				"c2-rise c2-tile relative isolate flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-border bg-surface-2 p-6",
				className,
			)}
		>
			<div
				aria-hidden
				className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
			/>
			<div className="flex items-baseline justify-between gap-3">
				<h2 id="c-tools" className="text-sm font-medium">
					{TOOLS_TILE.label}
				</h2>
				<span className="text-[13px] text-muted-foreground">
					{TOOLS_TILE.tag}
				</span>
			</div>
			<p className="mt-1 text-[21px] leading-tight font-semibold tracking-[-0.02em]">
				{TOOLS_TILE.title}
			</p>
			<p className="mt-1.5 text-pretty text-[13px] leading-snug text-muted-foreground">
				{TOOLS_TILE.paste}
			</p>

			<PasteBox className="mt-3" />

			<ul className="mt-2 grid flex-1 auto-rows-fr grid-cols-2 gap-1.5 sm:grid-cols-4">
				{DIAGNOSTICS.map((t) => (
					<li key={t.id} className="min-w-0">
						<Link
							to={t.path}
							title={ANSWERS[t.id] ?? t.answers}
							className="group flex h-full flex-col gap-1.5 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:border-brand/50 hover:bg-background"
						>
							<t.icon
								className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-brand"
								aria-hidden
							/>
							<span className="min-w-0">
								<span className="block truncate text-[13px] leading-tight font-medium">
									{TILE_NAME[t.id] ?? t.short}
								</span>
								<span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
									{TOOL_LINES[t.id]}
								</span>
							</span>
						</Link>
					</li>
				))}
			</ul>
		</article>
	);
}
