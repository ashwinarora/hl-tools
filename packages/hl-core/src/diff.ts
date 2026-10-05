/** Byte, structural and line diffs. */

import type { JsonNode } from "./json.ts";
import { type Span, spanAt } from "./msgpack.ts";

export interface ByteDivergence {
	/** First differing byte offset, or the shorter length if one is a prefix. */
	readonly offset: number;
	readonly a: number | null;
	readonly b: number | null;
	readonly pathA: string | null;
	readonly pathB: string | null;
}

export function firstByteDivergence(
	a: Uint8Array,
	b: Uint8Array,
	spansA: readonly Span[] = [],
	spansB: readonly Span[] = [],
): ByteDivergence | null {
	const n = Math.min(a.length, b.length);
	let offset = -1;
	for (let i = 0; i < n; i++) {
		if (a[i] !== b[i]) {
			offset = i;
			break;
		}
	}
	if (offset === -1) {
		if (a.length === b.length) return null;
		offset = n;
	}
	return {
		offset,
		a: offset < a.length ? (a[offset] as number) : null,
		b: offset < b.length ? (b[offset] as number) : null,
		pathA: spanAt(spansA, offset)?.path ?? null,
		pathB: spanAt(spansB, offset)?.path ?? null,
	};
}

export type JsonChange =
	| { kind: "added"; path: string; b: JsonNode }
	| { kind: "removed"; path: string; a: JsonNode }
	| { kind: "changed"; path: string; a: JsonNode; b: JsonNode; note?: string }
	| { kind: "reordered"; path: string; a: string[]; b: string[] };

function scalarRepr(n: JsonNode): string {
	switch (n.kind) {
		case "string":
			return JSON.stringify(n.value);
		case "number":
			return n.raw;
		case "bool":
			return String(n.value);
		case "null":
			return "null";
		default:
			return n.kind;
	}
}

/**
 * Structural diff that is sensitive to what matters for hashing: key order,
 * number lexemes (1 vs 1.0) and string vs number.
 */
export function diffJson(a: JsonNode, b: JsonNode, path = ""): JsonChange[] {
	const out: JsonChange[] = [];
	const at = path || "(root)";
	if (a.kind !== b.kind) {
		out.push({
			kind: "changed",
			path: at,
			a,
			b,
			note: `${a.kind} → ${b.kind}`,
		});
		return out;
	}
	if (a.kind === "object" && b.kind === "object") {
		const bKeys = new Map(b.entries.map((e) => [e.key, e.value]));
		const aKeys = new Map(a.entries.map((e) => [e.key, e.value]));
		for (const e of a.entries) {
			const child = path ? `${path}.${e.key}` : e.key;
			const other = bKeys.get(e.key);
			if (!other) out.push({ kind: "removed", path: child, a: e.value });
			else out.push(...diffJson(e.value, other, child));
		}
		for (const e of b.entries) {
			if (!aKeys.has(e.key)) {
				out.push({
					kind: "added",
					path: path ? `${path}.${e.key}` : e.key,
					b: e.value,
				});
			}
		}
		const common = a.entries.map((e) => e.key).filter((k) => bKeys.has(k));
		const commonB = b.entries.map((e) => e.key).filter((k) => aKeys.has(k));
		if (common.join("\u0000") !== commonB.join("\u0000")) {
			out.push({ kind: "reordered", path: at, a: common, b: commonB });
		}
		return out;
	}
	if (a.kind === "array" && b.kind === "array") {
		const n = Math.max(a.items.length, b.items.length);
		for (let i = 0; i < n; i++) {
			const child = `${path}[${i}]`;
			const x = a.items[i];
			const y = b.items[i];
			if (x && !y) out.push({ kind: "removed", path: child, a: x });
			else if (!x && y) out.push({ kind: "added", path: child, b: y });
			else if (x && y) out.push(...diffJson(x, y, child));
		}
		return out;
	}
	const ra = scalarRepr(a);
	const rb = scalarRepr(b);
	if (ra !== rb) {
		let note: string | undefined;
		if (
			a.kind === "number" &&
			b.kind === "number" &&
			Number(a.raw) === Number(b.raw)
		) {
			note =
				"Same value, different lexeme — MsgPack encodes these differently (int vs float64).";
		}
		if (
			a.kind === "string" &&
			b.kind === "string" &&
			a.value.toLowerCase() === b.value.toLowerCase()
		) {
			note = "Differs only in letter case.";
		}
		out.push({ kind: "changed", path: at, a, b, note });
	}
	return out;
}

export type LineOp =
	| { op: "equal"; a: string; b: string; aLine: number; bLine: number }
	| { op: "delete"; a: string; aLine: number }
	| { op: "insert"; b: string; bLine: number };

/** LCS line diff (O(n·m), fine for payload-sized inputs up to a few thousand lines). */
export function diffLines(aText: string, bText: string): LineOp[] {
	const a = aText.split("\n");
	const b = bText.split("\n");
	const n = a.length;
	const m = b.length;
	if (n * m > 4_000_000) {
		// Too large for a full table: fall back to a positional comparison.
		const ops: LineOp[] = [];
		for (let i = 0; i < Math.max(n, m); i++) {
			const x = a[i];
			const y = b[i];
			if (x !== undefined && y !== undefined && x === y)
				ops.push({ op: "equal", a: x, b: y, aLine: i + 1, bLine: i + 1 });
			else {
				if (x !== undefined) ops.push({ op: "delete", a: x, aLine: i + 1 });
				if (y !== undefined) ops.push({ op: "insert", b: y, bLine: i + 1 });
			}
		}
		return ops;
	}
	const dp: Uint32Array[] = Array.from(
		{ length: n + 1 },
		() => new Uint32Array(m + 1),
	);
	for (let i = n - 1; i >= 0; i--) {
		const row = dp[i] as Uint32Array;
		const next = dp[i + 1] as Uint32Array;
		for (let j = m - 1; j >= 0; j--) {
			row[j] =
				a[i] === b[j]
					? (next[j + 1] as number) + 1
					: Math.max(next[j] as number, row[j + 1] as number);
		}
	}
	const ops: LineOp[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			ops.push({
				op: "equal",
				a: a[i] as string,
				b: b[j] as string,
				aLine: i + 1,
				bLine: j + 1,
			});
			i++;
			j++;
		} else if (
			((dp[i + 1] as Uint32Array)[j] as number) >=
			((dp[i] as Uint32Array)[j + 1] as number)
		) {
			ops.push({ op: "delete", a: a[i] as string, aLine: i + 1 });
			i++;
		} else {
			ops.push({ op: "insert", b: b[j] as string, bLine: j + 1 });
			j++;
		}
	}
	while (i < n) {
		ops.push({ op: "delete", a: a[i] as string, aLine: i + 1 });
		i++;
	}
	while (j < m) {
		ops.push({ op: "insert", b: b[j] as string, bLine: j + 1 });
		j++;
	}
	return ops;
}

export interface SideBySideRow {
	readonly left: { line: number; text: string; changed: boolean } | null;
	readonly right: { line: number; text: string; changed: boolean } | null;
}

/** Pair deletes and inserts into side-by-side rows. */
export function toSideBySide(ops: readonly LineOp[]): SideBySideRow[] {
	const rows: SideBySideRow[] = [];
	let dels: Extract<LineOp, { op: "delete" }>[] = [];
	let ins: Extract<LineOp, { op: "insert" }>[] = [];
	const flush = () => {
		const k = Math.max(dels.length, ins.length);
		for (let x = 0; x < k; x++) {
			const d = dels[x];
			const i = ins[x];
			rows.push({
				left: d ? { line: d.aLine, text: d.a, changed: true } : null,
				right: i ? { line: i.bLine, text: i.b, changed: true } : null,
			});
		}
		dels = [];
		ins = [];
	};
	for (const op of ops) {
		if (op.op === "delete") dels.push(op);
		else if (op.op === "insert") ins.push(op);
		else {
			flush();
			rows.push({
				left: { line: op.aLine, text: op.a, changed: false },
				right: { line: op.bLine, text: op.b, changed: false },
			});
		}
	}
	flush();
	return rows;
}

/** Character-level highlight for a changed pair of lines: [prefixLen, suffixLen]. */
export function inlineChange(
	a: string,
	b: string,
): { prefix: number; suffix: number } {
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
		prefix++;
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	)
		suffix++;
	return { prefix, suffix };
}
