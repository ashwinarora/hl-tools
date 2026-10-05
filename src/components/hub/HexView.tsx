import { bytesToHex, type Span, spanAt } from "@hl-tools/core";
import { useMemo, useState } from "react";
import { cn } from "#/lib/utils";

export interface HexSegment {
	label: string;
	start: number;
	end: number;
	description?: string;
}

const KIND_CLASS: Record<Span["kind"], string> = {
	key: "text-syn-key",
	str: "text-syn-string",
	int: "text-syn-number",
	float: "text-syn-number",
	bool: "text-syn-bool",
	nil: "text-syn-null",
	bin: "text-syn-string",
	map: "text-syn-punct",
	array: "text-syn-punct",
};

const SEGMENT_CLASSES = [
	"text-syn-key",
	"text-syn-number",
	"text-syn-bool",
	"text-syn-string",
	"text-warning",
	"text-info",
];

function byteText(b: number): string {
	return b.toString(16).padStart(2, "0");
}

/**
 * Hex dump with semantic colouring. With `spans`, each byte is coloured by the
 * MsgPack value it belongs to (headers dimmed) and hovering shows the field
 * path. With `segments`, bytes are coloured by segment (e.g. the parts of an
 * L1 hash preimage). `highlight` outlines a byte range (e.g. a divergence).
 */
export function HexView({
	bytes,
	spans,
	segments,
	highlight,
	selectedPath,
	onHoverPath,
	label = "bytes",
}: {
	bytes: Uint8Array;
	spans?: readonly Span[];
	segments?: readonly HexSegment[];
	highlight?: { start: number; end: number } | null;
	selectedPath?: string | null;
	onHoverPath?: (path: string | null) => void;
	label?: string;
}) {
	const [hover, setHover] = useState<number | null>(null);
	const info = useMemo(() => {
		return Array.from(bytes, (_, i) => {
			if (spans) {
				const s = spanAt(spans, i);
				if (!s) return { cls: "", path: null as string | null, header: false };
				const header = i < s.headerEnd;
				return {
					cls: header ? "text-subtle-foreground" : KIND_CLASS[s.kind],
					path: s.path,
					header,
				};
			}
			if (segments) {
				const idx = segments.findIndex((seg) => i >= seg.start && i < seg.end);
				return {
					cls:
						idx >= 0
							? (SEGMENT_CLASSES[idx % SEGMENT_CLASSES.length] as string)
							: "",
					path: idx >= 0 ? (segments[idx]?.label ?? null) : null,
					header: false,
				};
			}
			return { cls: "", path: null, header: false };
		});
	}, [bytes, spans, segments]);

	const hoverPath = hover !== null ? (info[hover]?.path ?? null) : null;
	const activePath = hoverPath ?? selectedPath ?? null;
	const activeRange = useMemo(() => {
		if (!activePath) return null;
		if (spans) {
			const s =
				spans.find((x) => x.path === activePath) ??
				(hover !== null ? spanAt(spans, hover) : undefined);
			return s ? { start: s.start, end: s.end } : null;
		}
		const seg = segments?.find((x) => x.label === activePath);
		return seg ? { start: seg.start, end: seg.end } : null;
	}, [activePath, spans, segments, hover]);

	const hoverSpan = hover !== null && spans ? spanAt(spans, hover) : undefined;
	const hoverSeg =
		hover !== null && segments
			? segments.find((s) => hover >= s.start && hover < s.end)
			: undefined;

	return (
		<div className="min-w-0">
			<div
				className="scrollbar-thin max-h-80 overflow-auto rounded-md border border-border bg-surface-2/40 p-2 font-mono text-[12px] leading-5"
				onMouseLeave={() => {
					setHover(null);
					onHoverPath?.(null);
				}}
				role="img"
				aria-label={`${bytes.length} ${label} as hexadecimal: ${bytesToHex(bytes).slice(0, 120)}${bytes.length > 58 ? "…" : ""}`}
			>
				<div className="flex flex-wrap gap-x-[0.35em] gap-y-0">
					{info.map((b, i) => {
						const inActive =
							activeRange && i >= activeRange.start && i < activeRange.end;
						const inHighlight =
							highlight && i >= highlight.start && i < highlight.end;
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: hover is a pointer-only enhancement; the Decoded table exposes the same field mapping accessibly
							<span
								// biome-ignore lint/suspicious/noArrayIndexKey: byte offsets are stable identities
								key={i}
								onMouseEnter={() => {
									setHover(i);
									onHoverPath?.(info[i]?.path ?? null);
								}}
								className={cn(
									"cursor-default rounded-[2px] px-[1px]",
									b.cls,
									inActive && "bg-brand-soft",
									inHighlight &&
										"bg-danger-soft outline outline-1 outline-danger",
								)}
							>
								{byteText(bytes[i] as number)}
							</span>
						);
					})}
				</div>
			</div>
			<div className="mt-1.5 flex min-h-5 flex-wrap items-center justify-between gap-x-3 font-mono text-2xs text-muted-foreground">
				<span className="min-w-0 break-words">
					{hover !== null ? (
						<>
							byte {hover} · 0x{byteText(bytes[hover] as number)}
							{hoverSpan && (
								<>
									{" "}
									·{" "}
									<span className="text-foreground">
										{hoverSpan.path || "(root)"}
									</span>{" "}
									· {hoverSpan.kind}
									{hover < hoverSpan.headerEnd ? " header" : ""}
								</>
							)}
							{hoverSeg && (
								<>
									{" "}
									· <span className="text-foreground">{hoverSeg.label}</span>
								</>
							)}
						</>
					) : (
						"Hover or tap a byte to see which field it encodes."
					)}
				</span>
				<span>{bytes.length} bytes</span>
			</div>
		</div>
	);
}

/** Annotated table of MsgPack spans ("decoded" view). */
export function SpanTable({
	bytes,
	spans,
	onSelect,
	selectedPath,
}: {
	bytes: Uint8Array;
	spans: readonly Span[];
	onSelect?: (path: string) => void;
	selectedPath?: string | null;
}) {
	const leaves = spans.filter((s) => s.kind !== "map" && s.kind !== "array");
	return (
		<table className="w-full min-w-[520px] border-collapse font-mono text-xs">
			<thead>
				<tr className="sticky top-0 border-b border-border bg-surface text-left text-2xs uppercase tracking-wide text-subtle-foreground">
					<th className="px-3 py-1.5 font-medium">offset</th>
					<th className="px-3 py-1.5 font-medium">len</th>
					<th className="px-3 py-1.5 font-medium">field</th>
					<th className="px-3 py-1.5 font-medium">type</th>
					<th className="px-3 py-1.5 font-medium">bytes</th>
				</tr>
			</thead>
			<tbody>
				{leaves.map((s) => (
					<tr
						key={`${s.path}-${s.start}`}
						onClick={() => onSelect?.(s.path)}
						className={cn(
							"cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2",
							selectedPath === s.path && "bg-brand-soft",
						)}
					>
						<td className="px-3 py-1 text-muted-foreground">{s.start}</td>
						<td className="px-3 py-1 text-muted-foreground">
							{s.end - s.start}
						</td>
						<td
							className={cn(
								"px-3 py-1",
								s.kind === "key" ? "text-syn-key" : "text-foreground",
							)}
						>
							{s.kind === "key"
								? `${s.path.replace(/#key$/, "")} (key)`
								: s.path || "(root)"}
						</td>
						<td className="px-3 py-1 text-muted-foreground">{s.kind}</td>
						<td className="max-w-[18rem] truncate px-3 py-1">
							<span className="text-subtle-foreground">
								{bytesToHex(bytes.slice(s.start, s.headerEnd), false)}
							</span>
							{bytesToHex(bytes.slice(s.headerEnd, s.end), false)}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
