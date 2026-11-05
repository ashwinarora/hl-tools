/**
 * The docs' own remark step, run while each page is compiled.
 *
 * - `<Fact id="…" />` becomes the number's text (from `facts.ts`), in the page
 *   and in its Markdown copy, so neither can drift from the rule files.
 * - `<RuleTable id="…" />` becomes a table (from `tables.ts`), the same way,
 *   with the rule sets it comes from under it.
 * - The docs' components get a readable Markdown form for "Copy page", the
 *   `.md` pages and `llms.txt` (otherwise their JSX would be copied as is).
 *
 * Fumadocs builds the Markdown copy from the page's source text, so changing
 * the tree alone does not reach it: each component's Markdown is set with
 * `replaceSource`.
 */
import {
	markdownTable,
	replaceSource,
} from "fumadocs-core/mdx-plugins/stringifier";
import type { VFile } from "vfile";
import { marksOf } from "../../components/docs/marks.ts";
import { FACTS, isFactId } from "./facts.ts";
import { isPromptKind, onTestnet, PROMPTS, promptMarkdown } from "./prompts.ts";
import { isTableId, provenance, type RuleTableData, TABLES } from "./tables.ts";

/** The site's address, for links in the Markdown copy (read outside the site). */
const ORIGIN = "https://hltools.tech";

interface Point {
	offset?: number;
}
interface Node {
	type: string;
	name?: string | null;
	value?: string;
	url?: string;
	attributes?: { type: string; name?: string; value?: unknown }[];
	children?: Node[];
	position?: { start: Point; end: Point };
}
// replaceSource takes mdast's own node type; this file reads only a few fields
type Replaceable = Parameters<typeof replaceSource>[1];

function attr(node: Node, name: string): string | undefined {
	for (const a of node.attributes ?? []) {
		if (
			a.type === "mdxJsxAttribute" &&
			a.name === name &&
			typeof a.value === "string"
		)
			return a.value;
	}
	return undefined;
}

function isJsx(node: Node): boolean {
	return node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
}

function quoted(text: string): string {
	return text
		.trim()
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
}

function absolute(href: string): string {
	return href.startsWith("/") ? `${ORIGIN}${href}` : href;
}

function markdownFor(node: Node, file: VFile): void {
	const at = node as unknown as Replaceable;
	switch (node.name) {
		case "Callout": {
			const title = attr(node, "title");
			replaceSource(file, at, (s) =>
				quoted(`${title ? `**${title}.** ` : ""}${s.inner(at).trim()}`),
			);
			return;
		}
		case "Accordion":
		case "Tab": {
			const title = attr(node, "title") ?? attr(node, "value") ?? "";
			// the blank line keeps the next fold's title from joining this text
			replaceSource(file, at, (s) => `**${title}**\n\n${s.inner(at).trim()}\n`);
			return;
		}
		case "Step":
			replaceSource(file, at, (s) => `${s.inner(at).trim()}\n`);
			return;
		case "Accordions":
		case "Tabs":
		case "Steps":
		case "Cards":
			replaceSource(file, at, (s) => s.inner(at).trim());
			return;
		case "Card": {
			const title = attr(node, "title") ?? "";
			const href = attr(node, "href");
			replaceSource(file, at, (s) => {
				const body = s.inner(at).trim();
				const head = href ? `[${title}](${absolute(href)})` : title;
				return `- ${head}${body ? `: ${body}` : ""}`;
			});
			return;
		}
		case "TryIt": {
			const to = attr(node, "to") ?? "/";
			replaceSource(
				file,
				at,
				(s) => `[${s.inner(at).trim() || "Try it"}](${absolute(to)})`,
			);
			return;
		}
		case "Video":
			replaceSource(
				file,
				at,
				`*(Video: ${attr(node, "caption") ?? attr(node, "alt") ?? ""})*`,
			);
			return;
		case "Shot": {
			const src = attr(node, "src") ?? "";
			const marks = marksOf(src).map((m, i) => `${i + 1}. ${m.label}`);
			const picture = `![${attr(node, "alt") ?? ""}](${absolute(src)})`;
			replaceSource(
				file,
				at,
				marks.length ? `${picture}\n\n${marks.join("\n")}` : picture,
			);
			return;
		}
		case "Diagram":
			replaceSource(file, at, `*(Diagram: ${attr(node, "alt") ?? ""})*`);
			return;
		case "WalletPrompt": {
			const kind = attr(node, "kind") ?? "";
			if (!isPromptKind(kind)) {
				file.fail(
					`Unknown <WalletPrompt kind="${kind}" />: add it to src/lib/docs/prompts.ts`,
					node as never,
				);
			}
			const testnet = (node.attributes ?? []).some(
				(a) => a.name === "testnet" && a.value !== "false",
			);
			const prompt = PROMPTS[kind];
			replaceSource(
				file,
				at,
				promptMarkdown(testnet ? onTestnet(prompt) : prompt),
			);
			return;
		}
	}
}

/** A cell's inline Markdown as text and code, the only two a table uses. */
function inline(cell: string): Node[] {
	return cell
		.split("`")
		.map(
			(part, i): Node =>
				i % 2
					? { type: "inlineCode", value: part }
					: { type: "text", value: part },
		)
		.filter((n) => n.value);
}

/** The table and the line naming where its figures come from. */
function tableNodes(table: RuleTableData): Node[] {
	const row = (cells: readonly string[]): Node => ({
		type: "tableRow",
		children: cells.map((c) => ({ type: "tableCell", children: inline(c) })),
	});
	return [
		{
			type: "table",
			align: table.head.map(() => null),
			children: [row(table.head), ...table.rows.map(row)],
		} as Node,
		{
			// a small line, set apart from the page's own text
			type: "mdxJsxFlowElement",
			name: "p",
			attributes: [
				{
					type: "mdxJsxAttribute",
					name: "className",
					value: "-mt-2 text-fd-muted-foreground text-sm",
				},
			],
			children: [
				{ type: "text", value: `From ${provenance(table)}. ` },
				{
					type: "link",
					url: "/changes",
					children: [{ type: "text", value: "Rule changes" }],
				},
			],
		},
	];
}

function tableMarkdown(table: RuleTableData): string {
	return `${markdownTable([table.head, ...table.rows].map((r) => [...r]))}\n\n*From ${provenance(table)}. [Rule changes](${ORIGIN}/changes)*`;
}

/** Replaces each `<Fact>` in `parent` with its text; the rest get their Markdown. */
function walk(parent: Node, file: VFile): void {
	const children = parent.children;
	if (!children) return;
	for (let i = 0; i < children.length; i++) {
		const node: Node = children[i];
		if (isJsx(node) && node.name === "Fact") {
			const id: string = attr(node, "id") ?? "";
			if (!isFactId(id)) {
				file.fail(
					`Unknown <Fact id="${id}" />: add it to src/lib/docs/facts.ts`,
					node as never,
				);
			}
			const text: Node = {
				type: "text",
				value: FACTS[id],
				position: node.position,
			};
			children[i] = text;
			replaceSource(file, text as unknown as Replaceable, FACTS[id]);
			continue;
		}
		if (isJsx(node) && node.name === "RuleTable") {
			const id: string = attr(node, "id") ?? "";
			if (!isTableId(id)) {
				file.fail(
					`Unknown <RuleTable id="${id}" />: add it to src/lib/docs/tables.ts`,
					node as never,
				);
			}
			// the copy is cut from the source by position: the tag's own range
			// gets the Markdown, the page gets a table in its place
			replaceSource(
				file,
				node as unknown as Replaceable,
				tableMarkdown(TABLES[id]),
			);
			const nodes = tableNodes(TABLES[id]);
			children.splice(i, 1, ...nodes);
			i += nodes.length - 1;
			continue;
		}
		// an MDX comment ({/* … */}) is for whoever edits the page, not its readers
		if (
			(node.type === "mdxFlowExpression" ||
				node.type === "mdxTextExpression") &&
			/^\s*\/\*[\s\S]*\*\/\s*$/.test(node.value ?? "")
		) {
			replaceSource(file, node as unknown as Replaceable, "");
			continue;
		}
		if (isJsx(node)) markdownFor(node, file);
		// a link inside the site reads as a full address once copied elsewhere
		if (node.type === "link" && node.url?.startsWith("/")) {
			const url = node.url;
			const at = node as unknown as Replaceable;
			replaceSource(file, at, (s) => `[${s.inner(at)}](${absolute(url)})`);
		}
		walk(node, file);
	}
}

export function remarkDocs() {
	return (tree: unknown, file: VFile) => {
		walk(tree as Node, file);
	};
}
