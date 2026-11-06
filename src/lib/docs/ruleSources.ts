/**
 * The docs' "Where the rules come from" page, built from the protocol core's
 * rule registry: every rule set with its summary, the date it was last
 * checked, its sources and what changed. A page writes `<RuleSources />`; the
 * docs' remark step (`remark.ts`) puts these sections in its place, in the
 * page and in its Markdown copy, so the page follows the rule files by itself.
 *
 * Like `tables.ts`, the rule files are imported by path (this module runs
 * while the docs are compiled).
 */
import { RULE_REGISTRY } from "../../../packages/hl-core/src/rules/index.ts";
import type {
	RuleChange,
	RuleSetMeta,
} from "../../../packages/hl-core/src/rules/meta.ts";

/** The page's address under the docs, and in full. */
export const RULE_SOURCES_SPLAT = "reference/rule-sources";
export const RULE_SOURCES_PATH = `/docs/${RULE_SOURCES_SPLAT}`;

/** How many of the newest changes head the page. */
export const LATEST = 8;

interface Node {
	type: string;
	value?: string;
	url?: string;
	depth?: number;
	align?: null[];
	data?: { hProperties?: { id?: string } };
	children?: Node[];
}

type Dated = RuleChange & { readonly rule: RuleSetMeta };

/** Every change of every rule set, newest first. */
export function changesByDate(
	rules: readonly RuleSetMeta[] = RULE_REGISTRY,
): Dated[] {
	return rules
		.flatMap((rule) => rule.changelog.map((c) => ({ ...c, rule })))
		.sort(
			(a, b) =>
				b.date.localeCompare(a.date) ||
				a.rule.title.localeCompare(b.rule.title),
		);
}

/** A version as numbers, for ordering ("1.10.0" after "1.9.0"). */
const versionParts = (v: string) => v.split(".").map(Number);

/** A rule set's changes, newest first (the files keep them in either order). */
export function newestFirst(r: RuleSetMeta): RuleChange[] {
	return [...r.changelog].sort((a, b) => {
		const x = versionParts(a.version);
		const y = versionParts(b.version);
		for (let i = 0; i < Math.max(x.length, y.length); i++) {
			const d = (y[i] ?? 0) - (x[i] ?? 0);
			if (d) return d;
		}
		return 0;
	});
}

/** Text with code between backticks, as the rule files write it. */
function inline(text: string): Node[] {
	return text
		.split("`")
		.map(
			(part, i): Node =>
				i % 2
					? { type: "inlineCode", value: part }
					: { type: "text", value: part },
		)
		.filter((n) => n.value);
}

const text = (value: string): Node => ({ type: "text", value });
/** A date that stays on one line in a narrow column (non-breaking hyphens). */
const date = (iso: string): Node => text(iso.replace(/-/g, "\u2011"));
const strong = (value: string): Node => ({
	type: "strong",
	children: [text(value)],
});
const link = (url: string, children: Node[]): Node => ({
	type: "link",
	url,
	children,
});
const paragraph = (children: Node[]): Node => ({
	type: "paragraph",
	children,
});
/** A heading with its own anchor: the headings' own step has already run. */
const heading = (depth: number, title: string, id: string): Node => ({
	type: "heading",
	depth,
	data: { hProperties: { id } },
	children: [text(title)],
});
const table = (head: string[], rows: Node[][][]): Node => {
	const row = (cells: Node[][]): Node => ({
		type: "tableRow",
		children: cells.map((c) => ({ type: "tableCell", children: c })),
	});
	return {
		type: "table",
		align: head.map(() => null),
		children: [row(head.map((h) => [text(h)])), ...rows.map(row)],
	};
};

/** The page's sections, as Markdown nodes. */
export function ruleSourceNodes(
	rules: readonly RuleSetMeta[] = RULE_REGISTRY,
): Node[] {
	const latest = changesByDate(rules).slice(0, LATEST);
	return [
		heading(2, "Latest changes", "latest-changes"),
		table(
			["Date", "Rule set", "What changed"],
			latest.map((c) => [
				[date(c.date)],
				[link(`#${c.rule.id}`, [text(c.rule.title)])],
				inline(c.note),
			]),
		),
		...rules.flatMap((r) => [
			heading(2, r.title, r.id),
			paragraph(inline(r.summary)),
			paragraph([
				strong("Last checked:"),
				text(` ${r.verifiedAt} (version `),
				{ type: "inlineCode", value: r.version },
				text(")."),
			]),
			paragraph([
				strong("Sources:"),
				text(" "),
				...r.sources.flatMap((s, i) => [
					...(i ? [text(", ")] : []),
					link(s.url, [text(s.label)]),
				]),
			]),
			table(
				["Version", "Date", "What changed"],
				newestFirst(r).map((c) => [
					[{ type: "inlineCode", value: c.version }],
					[date(c.date)],
					inline(c.note),
				]),
			),
		]),
	];
}

/** A table cell's text: a pipe would end the cell. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function markdownTable(head: string[], rows: string[][]): string {
	return [
		`| ${head.join(" | ")} |`,
		`| ${head.map(() => "---").join(" | ")} |`,
		...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
	].join("\n");
}

/** The same sections for the page's Markdown copy. */
export function ruleSourcesMarkdown(
	pageUrl: string,
	rules: readonly RuleSetMeta[] = RULE_REGISTRY,
): string {
	const latest = changesByDate(rules).slice(0, LATEST);
	return [
		"## Latest changes",
		markdownTable(
			["Date", "Rule set", "What changed"],
			latest.map((c) => [
				c.date,
				`[${c.rule.title}](${pageUrl}#${c.rule.id})`,
				c.note,
			]),
		),
		...rules.flatMap((r) => [
			`## ${r.title}`,
			r.summary,
			`**Last checked:** ${r.verifiedAt} (version \`${r.version}\`).`,
			`**Sources:** ${r.sources.map((s) => `[${s.label}](${s.url})`).join(", ")}`,
			markdownTable(
				["Version", "Date", "What changed"],
				newestFirst(r).map((c) => [`\`${c.version}\``, c.date, c.note]),
			),
		]),
	].join("\n\n");
}
