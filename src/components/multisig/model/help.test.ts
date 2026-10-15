import { describe, expect, it } from "vitest";
import { HELP, HELP_JARGON, HELP_MAX } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

const all = Object.entries(HELP);

describe("help texts", () => {
	it("covers the terms a newcomer meets", () => {
		expect(all.length).toBeGreaterThanOrEqual(25);
	});

	it.each(all)("%s promises nothing the product does not provide", (_k, t) => {
		for (const pattern of FORBIDDEN_CLAIMS) {
			expect(t.body, `${pattern} in "${t.body}"`).not.toMatch(pattern);
			expect(t.title).not.toMatch(pattern);
		}
	});

	it.each(all)("%s is short, whole, and in plain words", (_k, t) => {
		expect(t.body.length, t.body).toBeLessThanOrEqual(HELP_MAX);
		expect(t.body.length).toBeGreaterThan(60);
		expect(t.title.length).toBeLessThanOrEqual(32);
		// a sentence, ended
		expect(t.body).toMatch(/^[A-Z“].*\.$/s);
		// no em-dashes, no brackets full of exceptions, no shouting
		expect(t.body).not.toMatch(/—|;|\bALWAYS\b|\bNEVER\b|!/);
		for (const word of HELP_JARGON)
			expect(t.body, `${word} in "${t.body}"`).not.toMatch(word);
	});

	it("has no two texts under one title", () => {
		const titles = all.map(([, t]) => t.title);
		expect(new Set(titles).size).toBe(titles.length);
	});

	it("still lets the checks see what they are meant to catch", () => {
		expect(
			HELP_JARGON.some((w) => w.test("Sign the envelope with a fresh nonce.")),
		).toBe(true);
		expect(FORBIDDEN_CLAIMS.some((p) => p.test("Only you can see this."))).toBe(
			true,
		);
	});
});
