import { diffLines, inlineChange, toSideBySide } from "@hl-tools/core";
import { useMemo, useState } from "react";
import { cn } from "#/lib/utils";
import { Segmented } from "./layout";

function Line({
	text,
	other,
	changed,
	side,
}: {
	text: string;
	other: string | null;
	changed: boolean;
	side: "left" | "right";
}) {
	if (!changed || other === null) return <>{text || " "}</>;
	const { prefix, suffix } = inlineChange(
		side === "left" ? text : other,
		side === "left" ? other : text,
	);
	const mid = text.slice(prefix, text.length - suffix);
	return (
		<>
			{text.slice(0, prefix)}
			<mark
				className={cn(
					"rounded-[2px] px-[1px] text-foreground",
					side === "left" ? "bg-danger/30" : "bg-success/30",
				)}
			>
				{mid}
			</mark>
			{text.slice(text.length - suffix)}
		</>
	);
}

/** Side-by-side or unified line diff with inline change highlighting. */
export function DiffView({
	left,
	right,
	leftLabel = "A",
	rightLabel = "B",
	maxHeight = "28rem",
}: {
	left: string;
	right: string;
	leftLabel?: string;
	rightLabel?: string;
	maxHeight?: string;
}) {
	const [mode, setMode] = useState<"split" | "unified">("split");
	const ops = useMemo(() => diffLines(left, right), [left, right]);
	const rows = useMemo(() => toSideBySide(ops), [ops]);
	// A modified line is a delete + insert pair; count rows, not operations.
	const changes = rows.filter(
		(r) => r.left?.changed || r.right?.changed,
	).length;
	return (
		<div className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-3 py-1.5">
				<span className="text-xs text-muted-foreground">
					{changes === 0
						? "No differences"
						: `${changes} changed line${changes === 1 ? "" : "s"}`}
				</span>
				<Segmented
					size="sm"
					label="Diff layout"
					value={mode}
					onChange={setMode}
					options={[
						{ value: "split", label: "Side by side" },
						{ value: "unified", label: "Inline" },
					]}
				/>
			</div>
			<div
				className="scrollbar-thin overflow-auto font-mono text-[12px] leading-5"
				style={{ maxHeight }}
			>
				{mode === "split" ? (
					<table className="w-full min-w-[640px] table-fixed border-collapse">
						<thead>
							<tr className="text-left text-2xs uppercase tracking-wide text-subtle-foreground">
								<th className="w-10" />
								<th className="border-r border-border px-2 py-1 font-medium">
									{leftLabel}
								</th>
								<th className="w-10" />
								<th className="px-2 py-1 font-medium">{rightLabel}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional
								<tr key={i}>
									<td
										className={cn(
											"select-none px-2 text-right align-top text-subtle-foreground",
											r.left?.changed && "bg-danger-soft",
										)}
									>
										{r.left?.line ?? ""}
									</td>
									<td
										className={cn(
											"whitespace-pre-wrap break-all border-r border-border px-2 align-top",
											r.left?.changed
												? "bg-danger-soft"
												: !r.left && "bg-surface-2/50",
										)}
									>
										{r.left ? (
											<Line
												text={r.left.text}
												other={r.right?.text ?? null}
												changed={r.left.changed}
												side="left"
											/>
										) : (
											""
										)}
									</td>
									<td
										className={cn(
											"select-none px-2 text-right align-top text-subtle-foreground",
											r.right?.changed && "bg-success-soft",
										)}
									>
										{r.right?.line ?? ""}
									</td>
									<td
										className={cn(
											"whitespace-pre-wrap break-all px-2 align-top",
											r.right?.changed
												? "bg-success-soft"
												: !r.right && "bg-surface-2/50",
										)}
									>
										{r.right ? (
											<Line
												text={r.right.text}
												other={r.left?.text ?? null}
												changed={r.right.changed}
												side="right"
											/>
										) : (
											""
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<div className="min-w-[320px] py-1">
						{ops.map((o, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional
								key={i}
								className={cn(
									"flex gap-2 whitespace-pre-wrap break-all px-2",
									o.op === "delete" && "bg-danger-soft",
									o.op === "insert" && "bg-success-soft",
								)}
							>
								<span className="w-4 shrink-0 select-none text-subtle-foreground">
									{o.op === "delete" ? "−" : o.op === "insert" ? "+" : " "}
								</span>
								<span>{o.op === "insert" ? o.b : o.a}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
