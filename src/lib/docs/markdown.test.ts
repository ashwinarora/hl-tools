/**
 * The docs' Markdown copies ("Copy page", `/docs/*.md`, `llms-full.txt`) and
 * the parts they are built from, without the Vite plugins: each page is run
 * through the docs' own remark step and Fumadocs' Markdown writer, as the
 * build does.
 *
 * - No component is left as a tag, and a folded section's title starts its
 *   own line (they once ran into the text before them).
 * - Every table, drawn wallet prompt and numbered mark a page names exists,
 *   and a mark lies inside its picture.
 * - A callout titled "Careful" is drawn as a warning.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { remarkLLMs } from "fumadocs-core/mdx-plugins/remark-llms";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { VFile } from "vfile";
import { describe, expect, it } from "vitest";
import { MARKS } from "#/components/docs/marks";
import { isPromptKind } from "./prompts";
import { remarkDocs } from "./remark";
import { isTableId, TABLES } from "./tables";

const ROOT = new URL("../../../", import.meta.url).pathname;
const CONTENT = join(ROOT, "content/docs");
const PUBLIC = join(ROOT, "public");

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? files(join(dir, e.name))
			: e.name.endsWith(".mdx")
				? [join(dir, e.name)]
				: [],
	);
}

const PAGES = files(CONTENT).map((path) => {
	const source = readFileSync(path, "utf8");
	const body = source.replace(/^---\n[\s\S]*?\n---\n/, "");
	return { file: relative(CONTENT, path), body };
});

/** A page's Markdown copy, as the build writes it. */
async function markdownOf(body: string): Promise<string> {
	const processor = unified()
		.use(remarkParse)
		.use(remarkMdx)
		.use(remarkGfm)
		.use(remarkDocs)
		.use(remarkLLMs, { headingIds: false, _data: true });
	const file = new VFile({ value: body });
	await processor.run(processor.parse(file), file);
	return String(file.data.markdown ?? "");
}

const COPIES = await Promise.all(
	PAGES.map(async (p) => ({ ...p, markdown: await markdownOf(p.body) })),
);

/** Text outside code: tags written in code are examples, not components. */
const outsideCode = (md: string) =>
	md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("Markdown copies", () => {
	it("leave no component behind as a tag", () => {
		for (const p of COPIES)
			expect(
				outsideCode(p.markdown).match(/<\/?[A-Z][A-Za-z]*[\s/>]/)?.[0],
				p.file,
			).toBeUndefined();
	});

	it("start every folded section's title on its own line", () => {
		for (const p of COPIES)
			for (const m of p.body.matchAll(/<(?:Accordion|Tab) title="([^"]*)"/g))
				expect(p.markdown, `${p.file}: ${m[1]}`).toMatch(
					new RegExp(`(^|\\n)\\*\\*${literal(m[1])}\\*\\*\\n\\n`),
				);
	});

	it("write every rule table out as a table, with where it comes from", () => {
		for (const p of COPIES)
			for (const m of p.body.matchAll(/<RuleTable id="([^"]*)"/g)) {
				const table = TABLES[m[1] as keyof typeof TABLES];
				expect(table, `${p.file}: ${m[1]}`).toBeDefined();
				const head = `| ${table.head[0]}`;
				expect(p.markdown, `${p.file}: ${m[1]}`).toContain(head);
				expect(p.markdown, `${p.file}: ${m[1]}`).toContain(
					`checked ${table.from[0].verifiedAt}`,
				);
			}
	});
});

describe("what the pages name", () => {
	it("every rule table and wallet prompt exists", () => {
		for (const p of PAGES) {
			for (const m of p.body.matchAll(/<RuleTable id="([^"]*)"/g))
				expect(isTableId(m[1]), `${p.file}: ${m[1]}`).toBe(true);
			for (const m of p.body.matchAll(/<WalletPrompt kind="([^"]*)"/g))
				expect(isPromptKind(m[1]), `${p.file}: ${m[1]}`).toBe(true);
		}
	});

	it("every table has rows, each as wide as its head", () => {
		for (const [id, t] of Object.entries(TABLES)) {
			expect(t.rows.length, id).toBeGreaterThan(0);
			for (const row of t.rows) expect(row.length, id).toBe(t.head.length);
		}
	});

	it("a callout titled Careful is a warning", () => {
		for (const p of PAGES)
			for (const m of p.body.matchAll(/<Callout\b[^>]*>/g))
				if (/title="Careful"/.test(m[0]))
					expect(m[0], p.file).toMatch(/type="warn"/);
	});
});

describe("marks on pictures", () => {
	/** Each picture a page shows, with the size the page gives it. */
	const shots = new Map<string, { width: number; height: number }>();
	for (const p of PAGES)
		for (const m of p.body.matchAll(/<Shot([^>]*)\/>/g)) {
			const src = m[1].match(/src="([^"]*)"/)?.[1];
			const width = Number(m[1].match(/width=\{(\d+)\}/)?.[1]);
			const height = Number(m[1].match(/height=\{(\d+)\}/)?.[1]);
			if (src) shots.set(src, { width, height });
		}

	it("point at a picture that exists and that a page shows", () => {
		for (const src of Object.keys(MARKS)) {
			expect(existsSync(join(PUBLIC, src)), src).toBe(true);
			expect(shots.has(src), `${src}: on no page`).toBe(true);
		}
	});

	it("lie inside their picture, and number at most four", () => {
		for (const [src, marks] of Object.entries(MARKS)) {
			const size = shots.get(src);
			if (!size) continue;
			expect(marks.length, src).toBeGreaterThan(0);
			expect(marks.length, src).toBeLessThanOrEqual(4);
			for (const { box, label } of marks) {
				const [x, y, w, h] = box;
				expect(x >= 0 && y >= 0 && w > 0 && h > 0, `${src}: ${label}`).toBe(
					true,
				);
				expect(x + w, `${src}: ${label}`).toBeLessThanOrEqual(size.width);
				expect(y + h, `${src}: ${label}`).toBeLessThanOrEqual(size.height);
			}
		}
	});
});
