import {
	type Finding,
	type Network,
	networkConfig,
	type TransferTrace,
} from "@hl-tools/core";
import { ArrowUpRight, Check, Minus, X } from "lucide-react";
import { Panel } from "#/components/hub/layout";
import { Callout, EvidenceBadge } from "#/components/hub/status";
import { cn } from "#/lib/utils";

const FINDING_TONE: Record<NonNullable<Finding["tone"]>, string> = {
	ok: "border-success/30 bg-success-soft",
	warn: "border-warning/35 bg-warning-soft",
	bad: "border-danger/35 bg-danger-soft",
	neutral: "border-border bg-surface-2",
};

/** Expected vs observed for one EVM → Core token transfer. */
export function TransferDetail({
	trace,
	network,
}: {
	trace: TransferTrace;
	network: Network;
}) {
	const t = trace.transfer;
	const obs = trace.observed;
	return (
		<div className="space-y-4">
			<div className="grid min-w-0 gap-4 lg:grid-cols-2">
				<Panel
					title={
						<span className="flex items-center gap-2">
							Expected HyperCore effect{" "}
							<EvidenceBadge kind={t.token ? "inferred" : "unknown"} />
						</span>
					}
					description="Derived from the Transfer log and the documented EVM → Core transfer rules."
				>
					<div className="space-y-2">
						<p className="break-words text-sm font-medium">
							{trace.expected.headline}
						</p>
						<ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
							{trace.expected.lines.map((l) => (
								<li key={l} className="break-words">
									{l}
								</li>
							))}
						</ul>
					</div>
				</Panel>
				<Panel
					title={
						<span className="flex items-center gap-2">
							Observed on HyperCore <EvidenceBadge kind={obs.evidence} />
						</span>
					}
					description="Queried from the info API for the credited account."
				>
					<div className="space-y-3">
						<p
							className={cn(
								"text-sm font-medium",
								obs.evidence === "inferred" && "text-danger",
							)}
						>
							{obs.headline}
						</p>
						<p className="break-words text-sm text-muted-foreground">
							{obs.detail}
						</p>
						{obs.comparisons.length > 0 && (
							<div className="scrollbar-thin overflow-x-auto rounded-md border border-border">
								<table className="w-full min-w-[360px] border-collapse text-xs">
									<thead>
										<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
											<th className="px-3 py-1.5 font-medium">field</th>
											<th className="px-3 py-1.5 font-medium">expected</th>
											<th className="px-3 py-1.5 font-medium">observed</th>
											<th className="w-8 px-2 py-1.5" />
										</tr>
									</thead>
									<tbody>
										{obs.comparisons.map((c) => (
											<tr
												key={c.field}
												className="border-b border-border/60 last:border-0"
											>
												<td className="px-3 py-1.5 text-muted-foreground">
													{c.field}
												</td>
												<td className="break-all px-3 py-1.5 font-mono">
													{c.expected}
												</td>
												<td className="break-all px-3 py-1.5 font-mono">
													{c.observed ?? "—"}
												</td>
												<td className="px-2 py-1.5">
													{c.match === true ? (
														<Check
															className="size-3.5 text-success"
															aria-label="matches"
														/>
													) : c.match === false ? (
														<X
															className="size-3.5 text-danger"
															aria-label="differs"
														/>
													) : (
														<Minus
															className="size-3.5 text-subtle-foreground"
															aria-label="not observed"
														/>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
						{obs.l1Hash && (
							<a
								href={`${network === "mainnet" ? "https://app.hyperliquid.xyz" : "https://app.hyperliquid-testnet.xyz"}/explorer/tx/${obs.l1Hash}`}
								target="_blank"
								rel="noreferrer"
								className="inline-flex max-w-full items-center gap-1 break-all font-mono text-xs text-muted-foreground hover:text-foreground"
							>
								L1 tx {obs.l1Hash} <ArrowUpRight className="size-3 shrink-0" />
							</a>
						)}
					</div>
				</Panel>
			</div>

			{trace.findings.length > 0 && (
				<Panel
					title="Checks"
					description="Whether HyperCore recorded the credit; a dropped transfer reports no error on either side."
				>
					<ul className="space-y-2">
						{trace.findings.map((f) => (
							<li
								key={f.title}
								className={cn(
									"rounded-md border px-3 py-2.5",
									FINDING_TONE[f.tone ?? "neutral"],
								)}
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="text-sm font-medium">{f.title}</span>
									<EvidenceBadge kind={f.evidence} />
								</div>
								<p className="mt-0.5 text-xs text-muted-foreground">
									{f.detail}
								</p>
							</li>
						))}
					</ul>
				</Panel>
			)}

			{obs.evidence === "inferred" && (
				<Callout tone="warning" title="Why a transfer can be dropped">
					The protocol does not state a cause. The EVM transaction only emits a
					log; whether HyperCore honours it depends on rules that are not
					reported back, so this page only says whether a credit was observed.
				</Callout>
			)}

			<p className="text-xs text-muted-foreground">
				Credited account on HyperCore:{" "}
				<a
					href={networkConfig(network).coreExplorerAddress(t.from)}
					target="_blank"
					rel="noreferrer"
					className="font-mono text-foreground hover:underline"
				>
					{t.from}
				</a>
				{" · "}raw value{" "}
				<code className="font-mono">{t.amount.toString()}</code> from{" "}
				<code className="font-mono">{t.contract}</code> to{" "}
				<code className="font-mono">{t.to}</code>
			</p>
		</div>
	);
}
