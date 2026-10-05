import {
	type ActionTrace,
	type Finding,
	type Network,
	networkConfig,
} from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, Minus, X } from "lucide-react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import { Panel } from "#/components/hub/layout";
import { Callout, EvidenceBadge, IssueList } from "#/components/hub/status";
import { cn } from "#/lib/utils";
import { useHandoffStore } from "#/store/handoffStore";

const FINDING_TONE: Record<NonNullable<Finding["tone"]>, string> = {
	ok: "border-success/30 bg-success-soft",
	warn: "border-warning/35 bg-warning-soft",
	bad: "border-danger/35 bg-danger-soft",
	neutral: "border-border bg-surface-2",
};

export function ActionDetail({
	action,
	network,
	index,
}: {
	action: ActionTrace;
	network: Network;
	index: number;
}) {
	const send = useHandoffStore((s) => s.send);
	const decoded = action.decode.kind === "decoded" ? action.decode : null;
	const obs = action.observed;
	return (
		<div className="space-y-4">
			<div className="grid min-w-0 gap-4 lg:grid-cols-2">
				<Panel
					title={
						<span className="flex items-center gap-2">
							Expected HyperCore effect{" "}
							<EvidenceBadge kind={decoded ? "inferred" : "unknown"} />
						</span>
					}
					description="Derived from the decoded action and the documented CoreWriter semantics."
				>
					{action.expected ? (
						<div className="space-y-2">
							<p className="text-sm font-medium">{action.expected.headline}</p>
							<ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
								{action.expected.lines.map((l) => (
									<li key={l}>{l}</li>
								))}
							</ul>
						</div>
					) : (
						<Callout tone="unknown" title="No expectation">
							The action could not be decoded, so there is nothing to expect.
							HyperCore would drop it.
						</Callout>
					)}
				</Panel>
				<Panel
					title={
						<span className="flex items-center gap-2">
							Observed on HyperCore{" "}
							<EvidenceBadge
								kind={
									action.supported ? (obs?.evidence ?? "unknown") : "unknown"
								}
							/>
						</span>
					}
					description={
						action.supported
							? "Queried from the info API for the sender."
							: undefined
					}
				>
					{!action.supported ? (
						<Callout
							tone="unknown"
							title="Trace not supported for this action yet"
						>
							The action decodes (see below), but hl-core does not yet know how
							to find its effect on HyperCore. Limit orders, USD class
							transfers, sendAsset and spotSend are traced.
						</Callout>
					) : obs ? (
						<div className="space-y-3">
							<p className="text-sm font-medium">{obs.headline}</p>
							<p className="text-sm text-muted-foreground">{obs.detail}</p>
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
																aria-label="not compared"
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
									L1 tx {obs.l1Hash}{" "}
									<ArrowUpRight className="size-3 shrink-0" />
								</a>
							)}
						</div>
					) : (
						<Callout tone="unknown" title="Nothing observed" />
					)}
				</Panel>
			</div>

			<Panel
				title="Checks"
				description="Conditions that make CoreWriter actions fail without an EVM revert."
			>
				<ul className="space-y-2">
					{action.findings.map((f) => (
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
							<p className="mt-0.5 text-xs text-muted-foreground">{f.detail}</p>
						</li>
					))}
				</ul>
			</Panel>

			{action.decode.issues.length > 0 && (
				<IssueList issues={action.decode.issues} />
			)}

			<CodeBlock
				title={
					<span className="flex flex-wrap items-center gap-2">
						Action {index + 1} bytes
						<Link
							to="/tools/corewriter"
							onClick={() => send("corewriter", action.dataHex)}
							className="inline-flex items-center gap-1 text-foreground hover:underline"
						>
							Open in CoreWriter Workbench <ArrowUpRight className="size-3" />
						</Link>
					</span>
				}
				views={[
					...(decoded
						? [
								{
									id: "fields",
									label: "Decoded",
									content: JSON.stringify(
										Object.fromEntries(
											decoded.fields.map((f) => [
												f.field.name,
												typeof f.raw === "boolean"
													? f.raw
													: (f.human ?? f.rawDisplay),
											]),
										),
										null,
										2,
									),
									lang: "json" as const,
								},
							]
						: []),
					{
						id: "hex",
						label: "Raw",
						content: action.dataHex,
						lang: "text" as const,
					},
				]}
				defaultWrap
				maxHeight="16rem"
			/>
			<p className="text-xs text-muted-foreground">
				Sender on HyperCore:{" "}
				<a
					href={networkConfig(network).coreExplorerAddress(action.sender)}
					target="_blank"
					rel="noreferrer"
					className="font-mono text-foreground hover:underline"
				>
					{action.sender}
				</a>
			</p>
		</div>
	);
}
