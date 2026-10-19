import { describe, expect, it } from "vitest";
import { FIRST_RUN, FIRST_SIGN, GLOSSARY, START } from "./guide";
import { HELP_JARGON } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

const sentences = [
	...FIRST_RUN.steps(true).flatMap((s) => [s.title, s.body]),
	...FIRST_RUN.steps(false).flatMap((s) => [s.title, s.body]),
	FIRST_SIGN.text,
	...Object.values(START),
	...GLOSSARY.flatMap((t) => [t.term, t.body]),
];

describe("the words for someone new", () => {
	it.each(
		sentences,
	)("promises nothing the product does not provide: %s", (s) => {
		for (const pattern of FORBIDDEN_CLAIMS) expect(s).not.toMatch(pattern);
	});

	it.each(sentences)("is in plain words: %s", (s) => {
		for (const word of HELP_JARGON) expect(s).not.toMatch(word);
		expect(s).not.toMatch(/\brelay\b|\bsubmit|\bledger\b|—/i);
	});

	it("walks through six steps, with or without sign-in", () => {
		expect(FIRST_RUN.steps(true)).toHaveLength(6);
		expect(FIRST_RUN.steps(false)).toHaveLength(6);
		expect(
			FIRST_RUN.steps(false)
				.map((s) => s.body)
				.join(" "),
		).not.toMatch(/sign in/i);
	});

	it("defines every term once, and names the expert's word only beside a plain one", () => {
		const terms = GLOSSARY.map((t) => t.term);
		expect(new Set(terms).size).toBe(terms.length);
		expect(terms).toHaveLength(18);
		expect(GLOSSARY.filter((t) => t.expert).map((t) => t.expert)).toEqual([
			"nonce",
			"relay",
		]);
		for (const t of GLOSSARY) expect(t.body).toMatch(/^[A-Z“].*\.$/s);
	});
});
