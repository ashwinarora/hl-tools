import { SILENT_REJECTION_RULES } from "@hl-tools/core";
import { Panel } from "#/components/hub/layout";

const STEPS = [
	{
		label: "L1 block built",
		detail:
			"HyperCore state for this block, including actions sent directly to the API.",
	},
	{
		label: "EVM block built",
		detail:
			"Your transaction runs; CoreWriter only emits a RawAction log. Read precompiles see Core state from before this block.",
	},
	{
		label: "EVM → Core transfers",
		detail: "Tokens sent to system addresses are credited on HyperCore.",
	},
	{
		label: "CoreWriter actions",
		detail:
			"Each RawAction is processed. The sender must already exist on HyperCore. Orders and vault transfers are enqueued and executed a few seconds later.",
	},
];

/** Explains the ordering and timing rules behind silent CoreWriter rejections. */
export function TimingRules({ highlight }: { highlight?: "account" | null }) {
	return (
		<Panel
			title="Why CoreWriter actions fail silently"
			description="Order of operations in an L1 block that produces a HyperEVM block."
		>
			<ol className="relative mb-5 grid gap-3 sm:grid-cols-4">
				{STEPS.map((s, i) => (
					<li
						key={s.label}
						className="relative rounded-md border border-border bg-surface-2/50 p-3"
					>
						<div className="mb-1 flex items-center gap-2">
							<span className="flex size-5 items-center justify-center rounded-full bg-surface font-mono text-2xs ring-1 ring-border">
								{i + 1}
							</span>
							<span className="text-sm font-medium">{s.label}</span>
						</div>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{s.detail}
						</p>
					</li>
				))}
			</ol>
			<ul className="space-y-2.5">
				{SILENT_REJECTION_RULES.map((r) => (
					<li
						key={r.id}
						className={
							highlight === "account" && r.id === "account-must-exist"
								? "rounded-md border border-danger/35 bg-danger-soft px-3 py-2"
								: "px-3 py-1"
						}
					>
						<div className="text-sm font-medium">{r.title}</div>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{r.detail}
						</p>
					</li>
				))}
			</ul>
		</Panel>
	);
}
