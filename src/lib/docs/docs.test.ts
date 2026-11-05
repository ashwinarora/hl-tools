/**
 * The docs (`content/docs/**`), read from disk: vitest runs without the Vite
 * plugins, so nothing here imports the compiled collection or a route.
 *
 * - Every part of the app has a page (each page names what it documents in
 *   `covers:`), and the glossary holds every term the Multisig defines.
 * - The words: nothing claims what the app never claims, and the plain pages
 *   use the Multisig's own words (the developer-tool pages may use the
 *   developer's; a page that must name an expert's word says why in a
 *   `{/* jargon: … *\/}` comment).
 * - No bloat: a word budget per page, outside its folded sections and tables.
 * - Every number, picture, video, diagram and link resolves.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGRAM_NAMES } from "#/components/docs/diagrams";
import { ACTION_KINDS } from "#/components/multisig/model/actions";
import { DRAFT_MAX_AGE_MS } from "#/components/multisig/model/drafts";
import { GLOSSARY } from "#/components/multisig/model/guide";
import { HELP_JARGON } from "#/components/multisig/model/help";
import { EXTENDED_OFFSET_MS } from "#/components/multisig/model/nonce";
import { FORBIDDEN_CLAIMS } from "#/components/multisig/model/relay/copy";
import { NICKNAME_MAX } from "#/components/multisig/model/relay/nicknames";
import { TREASURY_TABS } from "#/components/multisig/model/tabs";
import { TOOLS } from "#/lib/tools";
import { NONCE_WINDOW } from "../../../packages/hl-core/src/rules/signing.ts";
import { DRAFT_DAYS, FACTS, NICKNAME_LENGTH, WINDOW_DAYS } from "./facts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const CONTENT = join(ROOT, "content/docs");
const PUBLIC = join(ROOT, "public");
const DAY = 24 * 60 * 60 * 1000;

/** The Multisig's own words: the section's screens never use these. */
const SECTION_WORDS: readonly RegExp[] = [
	/\brelay\b/i,
	/\bledger\b/i,
	/\bthe chain\b/i,
	/\bon[ -]?chain\b/i,
	/\bsubmi(t|ts|tted|tting|ssion|ssions)\b/i,
	/\bsigner set\b/i,
	/\bre-?propos/i,
	/\bsharing service\b/i,
];

/**
 * A task page's budget, and the larger one of the overview pages (they
 * introduce a whole part) and the glossary (one heading and a link per term).
 */
const BUDGET = 700;
const OVERVIEW_BUDGET = 900;
const OVERVIEWS = new Set([
	"index.mdx",
	"multisig/index.mdx",
	"tools/index.mdx",
	"reference/glossary.mdx",
]);

interface Page {
	readonly file: string;
	readonly url: string;
	readonly source: string;
	readonly title: string;
	readonly description: string;
	readonly covers: readonly string[];
	readonly body: string;
}

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? files(join(dir, e.name))
			: e.name.endsWith(".mdx")
				? [join(dir, e.name)]
				: [],
	);
}

function field(front: string, name: string): string {
	const m = front.match(new RegExp(`^${name}:\\s*(.*)$`, "m"));
	return m ? m[1].trim() : "";
}

function read(path: string): Page {
	const source = readFileSync(path, "utf8");
	const m = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!m) throw new Error(`${path}: no frontmatter`);
	const [, front, body] = m;
	const file = relative(CONTENT, path);
	const slug = file.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "");
	const covers = field(front, "covers")
		.replace(/^\[|\]$/g, "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return {
		file,
		url: slug ? `/docs/${slug}` : "/docs",
		source,
		title: field(front, "title"),
		description: field(front, "description"),
		covers,
		body,
	};
}

const PAGES = files(CONTENT).map(read);

/** What a reader reads: no code, no comments, no tags, no link targets. */
function prose(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
		.replace(/\]\([^)]*\)/g, "]")
		.replace(/<[A-Za-z][^>]*?\b(?:alt|caption|title)="([^"]*)"[^>]*>/g, " $1 ")
		.replace(/<\/?[A-Za-z][^>]*>/g, " ");
}

/** The part a reader reads first: folded sections and tables do not count. */
function counted(body: string): number {
	const text = prose(
		body
			.replace(/<Accordions>[\s\S]*?<\/Accordions>/g, " ")
			.replace(/^\|.*\|$/gm, " "),
	);
	return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

const isToolPage = (p: Page) => p.file.startsWith("tools/");
const allowsJargon = (p: Page) =>
	isToolPage(p) || /\{\/\*\s*jargon:/.test(p.body);

describe("docs pages", () => {
	it("are there", () => {
		expect(PAGES.length).toBeGreaterThanOrEqual(31);
	});

	it("each have a title and a description of 50 to 160 characters", () => {
		const titles = new Set<string>();
		for (const p of PAGES) {
			expect(p.title, p.file).not.toBe("");
			expect(titles.has(p.title), `${p.file}: title used twice`).toBe(false);
			titles.add(p.title);
			expect(
				p.description.length,
				`${p.file}: description`,
			).toBeGreaterThanOrEqual(50);
			expect(
				p.description.length,
				`${p.file}: description`,
			).toBeLessThanOrEqual(160);
		}
	});

	it("claim nothing the app never claims", () => {
		for (const p of PAGES) {
			const text = prose(`${p.title}\n${p.description}\n${p.body}`);
			for (const re of FORBIDDEN_CLAIMS)
				expect(text.match(re)?.[0], `${p.file}: ${re}`).toBeUndefined();
		}
	});

	it("use the Multisig's own words, outside the developer-tool pages", () => {
		for (const p of PAGES.filter((p) => !allowsJargon(p))) {
			const text = prose(`${p.title}\n${p.description}\n${p.body}`);
			for (const re of [...SECTION_WORDS, ...HELP_JARGON])
				expect(text.match(re)?.[0], `${p.file}: ${re}`).toBeUndefined();
		}
	});

	it("stay within their word budget", () => {
		for (const p of PAGES) {
			const budget = OVERVIEWS.has(p.file) ? OVERVIEW_BUDGET : BUDGET;
			expect(counted(p.body), `${p.file}: words`).toBeLessThanOrEqual(budget);
		}
	});
});

describe("coverage", () => {
	const covered = new Set(PAGES.flatMap((p) => p.covers));

	it("documents every kind of proposal", () => {
		for (const k of ACTION_KINDS) expect(covered, k.kind).toContain(k.kind);
	});

	it("documents every tool", () => {
		for (const t of TOOLS) expect(covered, t.id).toContain(t.id);
	});

	it("documents every tab of a treasury page", () => {
		for (const t of TREASURY_TABS) expect(covered, t).toContain(t);
	});

	it("documents every status a proposal can show", () => {
		// the phases of `Phase` in model/stage.ts
		const stage = readFileSync(
			join(ROOT, "src/components/multisig/model/stage.ts"),
			"utf8",
		);
		const union = stage.match(/export type Phase =([\s\S]*?);/)?.[1] ?? "";
		const phases = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
		expect(phases.length).toBeGreaterThan(15);
		for (const phase of phases) expect(covered, phase).toContain(phase);
	});

	it("holds every term of the Multisig's glossary", () => {
		const glossary = PAGES.find((p) => p.file === "reference/glossary.mdx");
		for (const t of GLOSSARY)
			expect(glossary?.body, t.term).toContain(`\n### ${t.term}\n`);
	});
});

describe("what the pages point at", () => {
	it("every <Fact> exists", () => {
		for (const p of PAGES)
			for (const m of p.body.matchAll(/<Fact id="([^"]*)"/g))
				expect(Object.keys(FACTS), `${p.file}: ${m[1]}`).toContain(m[1]);
	});

	it("every diagram exists and says what it shows", () => {
		for (const p of PAGES)
			for (const m of p.body.matchAll(/<Diagram([^>]*)\/>/g)) {
				const name = m[1].match(/name="([^"]*)"/)?.[1] ?? "";
				expect(DIAGRAM_NAMES, `${p.file}: ${name}`).toContain(name);
				expect(m[1], `${p.file}: alt`).toMatch(/alt="[^"]{10,}"/);
			}
	});

	it("every picture and video is in public/ and is described", () => {
		for (const p of PAGES) {
			for (const m of p.body.matchAll(/<(Shot|Video)([^>]*)\/>/g)) {
				const attrs = m[2];
				const refs = [...attrs.matchAll(/\b(?:src|poster)="([^"]*)"/g)].map(
					(r) => r[1],
				);
				expect(refs.length, `${p.file}: ${m[1]} without src`).toBeGreaterThan(
					0,
				);
				for (const ref of refs)
					expect(existsSync(join(PUBLIC, ref)), `${p.file}: ${ref}`).toBe(true);
				expect(attrs, `${p.file}: ${m[1]} text`).toMatch(
					m[1] === "Shot" ? /alt="[^"]{10,}"/ : /caption="[^"]{10,}"/,
				);
			}
			for (const m of p.body.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
				expect(m[1].length, `${p.file}: image without alt`).toBeGreaterThan(9);
				expect(existsSync(join(PUBLIC, m[2])), `${p.file}: ${m[2]}`).toBe(true);
			}
		}
	});

	it("every link inside the site reaches a page", () => {
		const docs = new Set(PAGES.map((p) => p.url));
		const tree = readFileSync(join(ROOT, "src/routeTree.gen.ts"), "utf8");
		const routes = new Set(
			[
				...(
					tree.match(/interface FileRoutesByFullPath \{([\s\S]*?)\n\}/)?.[1] ??
					""
				).matchAll(/'([^']+)'/g),
			].map((m) => m[1]),
		);
		const targets = (body: string) => [
			...[...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]),
			...[...body.matchAll(/\b(?:href|to)="(\/[^"]*)"/g)].map((m) => m[1]),
		];
		for (const p of PAGES)
			for (const target of targets(p.body)) {
				const path = target.replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
				const ok =
					docs.has(path) || routes.has(path) || existsSync(join(PUBLIC, path));
				expect(ok, `${p.file}: ${target}`).toBe(true);
			}
	});
});

describe("facts", () => {
	it("agree with the app's own constants", () => {
		expect(DRAFT_DAYS * DAY).toBe(DRAFT_MAX_AGE_MS);
		expect(NICKNAME_LENGTH).toBe(NICKNAME_MAX);
		// a proposal can be sent for two days after it is made…
		expect(WINDOW_DAYS.normal * DAY).toBe(NONCE_WINDOW.pastMs);
		// …or almost three with the longer window
		const longer = NONCE_WINDOW.pastMs + EXTENDED_OFFSET_MS;
		expect(longer).toBeLessThan(WINDOW_DAYS.longer * DAY);
		expect(longer).toBeGreaterThan((WINDOW_DAYS.longer - 1) * DAY);
	});
});
