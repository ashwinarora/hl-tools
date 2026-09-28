import type { ActionTrace, Evidence, ReceiptSummary } from "@hl-tools/core";
import { ArrowDown, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { EvidenceBadge, formatTimestamp } from "#/components/hub/status";
import { cn } from "#/lib/utils";

const RING: Record<Evidence, string> = {
	observed: "border-t-success",
	inferred: "border-t-info",
	unknown: "border-t-unknown",
};

const LINE: Record<Evidence, string> = {
	observed: "border-success",
	inferred: "border-info border-dashed",
	unknown: "border-unknown border-dotted",
};

function short(a: string): string {
	return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function Stage({
	n,
	title,
	evidence,
	primary,
	children,
}: {
	n: number;
	title: string;
	evidence: Evidence;
	primary: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"relative min-w-0 flex-1 rounded-lg border border-border border-t-2 bg-surface p-3.5 shadow-[var(--shadow-card)]",
				RING[evidence],
			)}
		>
			<div className="mb-2 flex items-center justify-between gap-2">
				<span className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
					<span className="flex size-5 items-center justify-center rounded-full bg-surface-2 font-mono text-2xs text-foreground">
						{n}
					</span>
					{title}
				</span>
			</div>
			<div className="min-w-0 break-words text-sm font-medium leading-snug">
				{primary}
			</div>
			{children && (
				<div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
					{children}
				</div>
			)}
		</div>
	);
}

function Link({ evidence, label }: { evidence: Evidence; label?: string }) {
	return (
		<div className="flex shrink-0 items-center justify-center gap-1.5 py-1 lg:w-24 lg:flex-col lg:py-0">
			<div
				className={cn("hidden w-full border-t-2 lg:block", LINE[evidence])}
			/>
			<div className={cn("h-5 border-l-2 lg:hidden", LINE[evidence])} />
			<div className="flex items-center gap-1.5 lg:flex-col lg:gap-1">
				<EvidenceBadge kind={evidence} />
				{label && (
					<span className="text-center text-2xs leading-tight text-subtle-foreground lg:max-w-[5.5rem]">
						{label}
					</span>
				)}
			</div>
			<ArrowRight
				className="hidden size-3.5 text-subtle-foreground lg:block"
				aria-hidden
			/>
			<ArrowDown
				className="size-3.5 text-subtle-foreground lg:hidden"
				aria-hidden
			/>
		</div>
	);
}

export function TraceFlow({
	receipt,
	action,
}: {
	receipt: ReceiptSummary;
	action: ActionTrace;
}) {
	const decoded = action.decode.kind === "decoded" ? action.decode : null;
	const decodeEvidence: Evidence = decoded ? "observed" : "unknown";
	const effectEvidence: Evidence = !action.supported
		? "unknown"
		: (action.observed?.evidence ?? "unknown");
	const keyFields = decoded
		? decoded.fields
				.filter((f) => f.human !== null && f.field.unit.kind !== "address")
				.slice(0, 4)
				.map((f) => `${f.field.name} ${f.human}`)
		: [];
	return (
		<div className="flex min-w-0 flex-col items-stretch lg:flex-row lg:items-stretch">
			<Stage
				n={1}
				title="HyperEVM tx"
				evidence="observed"
				primary={
					<span
						className={
							receipt.status === "success" ? "text-success" : "text-danger"
						}
					>
						{receipt.status === "success" ? "Succeeded" : "Reverted"} in block{" "}
						{receipt.blockNumber.toString()}
					</span>
				}
			>
				<div>
					{receipt.blockTimestamp !== null
						? formatTimestamp(receipt.blockTimestamp * 1000)
						: "time unknown"}
				</div>
				<div className="font-mono">
					{short(receipt.from)} → {receipt.to ? short(receipt.to) : "create"}
				</div>
				<div>gas {receipt.gasUsed.toLocaleString()}</div>
			</Stage>
			<Link evidence="observed" label="receipt log" />
			<Stage
				n={2}
				title="RawAction log"
				evidence="observed"
				primary={<span className="font-mono">log #{action.logIndex}</span>}
			>
				<div>
					sender{" "}
					<span className="font-mono text-foreground">
						{short(action.sender)}
					</span>
				</div>
				<div>{(action.dataHex.length - 2) / 2} bytes of action data</div>
			</Stage>
			<Link
				evidence={decodeEvidence}
				label={decoded ? "v1 encoding" : "not decodable"}
			/>
			<Stage
				n={3}
				title="Decoded action"
				evidence={decodeEvidence}
				primary={
					decoded
						? decoded.spec.name
						: action.decode.kind === "unknown-version"
							? `Unknown version ${action.decode.version}`
							: action.decode.kind === "unknown-action"
								? `Unknown action ${action.decode.actionId}`
								: "Malformed"
				}
			>
				{keyFields.map((k) => (
					<div key={k} className="truncate font-mono">
						{k}
					</div>
				))}
			</Stage>
			<Link
				evidence={effectEvidence}
				label={action.supported ? "info API" : "not traced"}
			/>
			<Stage
				n={4}
				title="HyperCore effect"
				evidence={effectEvidence}
				primary={
					!action.supported ? (
						<span className="text-unknown">
							Trace not supported for this action yet
						</span>
					) : (
						(action.observed?.headline ?? "—")
					)
				}
			>
				{action.observed?.delayMs !== null &&
					action.observed?.delayMs !== undefined && (
						<div>
							{action.observed.delayMs >= 0 ? "+" : ""}
							{(action.observed.delayMs / 1000).toFixed(3)} s after the EVM
							block
							<span className="text-subtle-foreground">
								{" "}
								(block time has 1 s resolution)
							</span>
						</div>
					)}
				{action.observed?.coreTime ? (
					<div>{formatTimestamp(action.observed.coreTime)}</div>
				) : null}
			</Stage>
		</div>
	);
}
