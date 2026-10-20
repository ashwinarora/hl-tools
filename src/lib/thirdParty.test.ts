import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * A page of this site loads nothing from a third party for its looks: no
 * font host, no stylesheet or script from elsewhere. (The mainnet audit of
 * 2026-10-12 found the fonts coming from Google on every page load, which
 * gave Google each visitor's address and the page's origin.)
 */
describe("what every page loads", () => {
	it("names no other host in the document head", () => {
		const root = read("../routes/__root.tsx");
		const head = root.slice(
			root.indexOf("head:"),
			root.indexOf("shellComponent"),
		);
		expect(head.length).toBeGreaterThan(100);
		// a link or script in the head is fetched on every load, whoever the visitor is
		expect(head.match(/https?:\/\/[^"'`\s)]+/g) ?? []).toEqual([]);
	});

	it("names only its own origin in what a shared link shows", () => {
		// a link preview needs absolute URLs; crawlers read them, a visitor's
		// browser fetches nothing because of them, and the host is the site's
		const site = read("./site.ts");
		expect(site.match(/https?:\/\/[^"'`\s)]+/g)).toEqual([
			"https://hltools.tech",
		]);
	});

	it("takes its fonts and styles from the bundle", () => {
		const css = read("../styles.css");
		expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
		// no stylesheet or font file by URL from another origin
		expect(css.match(/(@import\s+url\(|url\(\s*["']?https?:)/g) ?? []).toEqual(
			[],
		);
		expect(css).toContain("@fontsource-variable/geist/wght.css");
		expect(css).toContain("@fontsource-variable/geist-mono/wght.css");
	});
});
