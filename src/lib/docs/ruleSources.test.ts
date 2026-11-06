import { describe, expect, it } from "vitest";
import { RULE_REGISTRY } from "../../../packages/hl-core/src/rules/index.ts";
import { changesByDate, newestFirst, ruleSourcesMarkdown } from "./ruleSources";

describe("where the rules come from", () => {
	it("lists each rule set's changes newest first, whatever the file's order", () => {
		for (const r of RULE_REGISTRY) {
			const versions = newestFirst(r).map((c) => c.version);
			expect(versions[0], r.id).toBe(r.version);
			expect(new Set(versions).size, r.id).toBe(versions.length);
		}
	});

	it("heads the page with the newest changes of all", () => {
		const dates = changesByDate().map((c) => c.date);
		expect(dates).toEqual([...dates].sort().reverse());
	});

	it("gives every rule set a section with its sources", () => {
		const md = ruleSourcesMarkdown(
			"https://hltools.tech/docs/reference/rule-sources",
		);
		for (const r of RULE_REGISTRY) {
			expect(md, r.id).toContain(`## ${r.title}`);
			for (const s of r.sources) expect(md, r.id).toContain(s.url);
		}
	});
});
