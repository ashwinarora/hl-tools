/**
 * The entry pages as search engines see them (`pages.ts`): every tool has
 * one, every one is a real route, no working page is listed, and the wording
 * keeps the home page's rules (the Multisig's pages its jargon rules too).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELP_JARGON } from "#/components/multisig/model/help";
import { FORBIDDEN_CLAIMS } from "#/components/multisig/model/relay/copy";
import {
	canonicalUrl,
	PAGES,
	type PagePath,
	pageHead,
	siteJsonLd,
	sitemapXml,
} from "./pages";
import { SITE_ORIGIN } from "./site";
import { TOOLS } from "./tools";

const paths = Object.keys(PAGES) as PagePath[];

/** The section's own words (`home/copy.test.ts`, `multisig/jargon.test.ts`). */
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

describe("entry pages", () => {
	it("include every tool", () => {
		for (const t of TOOLS) expect(paths).toContain(t.path);
	});

	it("are routes of the app", () => {
		const tree = readFileSync(
			new URL("../routeTree.gen.ts", import.meta.url),
			"utf8",
		);
		for (const p of paths) expect(tree).toContain(`'${p}'`);
	});

	it("never list a working page", () => {
		for (const p of paths)
			expect(p).not.toMatch(
				/^\/multisig\/(t|proposal|propose|open|add|create)\b|^\/rpc\//,
			);
	});

	it("have their own titles and descriptions of a length search results show", () => {
		expect(new Set(paths.map((p) => PAGES[p].title)).size).toBe(paths.length);
		expect(new Set(paths.map((p) => PAGES[p].description)).size).toBe(
			paths.length,
		);
		for (const p of paths) {
			const { description } = PAGES[p];
			expect(description.length, p).toBeGreaterThanOrEqual(50);
			expect(description.length, p).toBeLessThanOrEqual(180);
		}
	});

	it("keep the section's promises about wording", () => {
		for (const p of paths) {
			const text = `${PAGES[p].title} ${PAGES[p].description}`;
			const rules = p.startsWith("/multisig")
				? [...FORBIDDEN_CLAIMS, ...SECTION_WORDS, ...HELP_JARGON]
				: [...FORBIDDEN_CLAIMS, ...SECTION_WORDS];
			for (const rule of rules) expect(text, `${p} ${rule}`).not.toMatch(rule);
		}
	});
});

describe("pageHead", () => {
	it("names the page's canonical address, with no query or fragment", () => {
		for (const p of paths) {
			const head = pageHead(p);
			expect(head.links).toEqual([{ rel: "canonical", href: canonicalUrl(p) }]);
			expect(canonicalUrl(p)).toBe(`${SITE_ORIGIN}${p}`);
			expect(canonicalUrl(p)).not.toMatch(/[?#]/);
		}
	});

	it("lets the page be indexed and shares the same title and address", () => {
		const head = pageHead("/multisig");
		expect(head.meta).toContainEqual({ title: PAGES["/multisig"].title });
		expect(head.meta).toContainEqual({
			name: "robots",
			content: "index, follow",
		});
		expect(head.meta).toContainEqual({
			property: "og:url",
			content: `${SITE_ORIGIN}/multisig`,
		});
		expect(head.meta).toContainEqual({
			property: "og:title",
			content: PAGES["/multisig"].title,
		});
	});
});

describe("sitemap", () => {
	it("lists exactly the entry pages", () => {
		const xml = sitemapXml();
		const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
		expect(locs).toEqual(paths.map(canonicalUrl));
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
	});
});

describe("structured data", () => {
	it("names the site, its alternate spellings, and states no price", () => {
		const data = siteJsonLd();
		const json = JSON.stringify(data);
		expect(json).toContain('"name":"hl-tools"');
		expect(json).toContain('"alternateName":["HLTools","HL Tools"]');
		expect(json).not.toMatch(/offers|price/i);
		for (const rule of FORBIDDEN_CLAIMS) expect(json).not.toMatch(rule);
	});
});
