import { describe, expect, it } from "vitest";
import { CHANGE } from "./change";
import { HELP_JARGON } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

describe("the Change signers form's sentences", () => {
	const texts = [
		...Object.values(CHANGE).flatMap((v) => (typeof v === "string" ? [v] : [])),
		CHANGE.whoDecides(2, 3),
		CHANGE.whoDecides(3, 3),
		CHANGE.whoDecides(1, 1),
	];
	it("promise nothing the product does not provide, in plain words", () => {
		for (const t of texts) {
			for (const claim of FORBIDDEN_CLAIMS)
				expect(t, `${claim} in "${t}"`).not.toMatch(claim);
			for (const word of HELP_JARGON)
				expect(t, `${word} in "${t}"`).not.toMatch(word);
		}
	});
	it("say who decides, by the number that holds now", () => {
		expect(CHANGE.whoDecides(2, 3)).toBe(
			"The current signers decide this: any 2 of the 3. Someone who is being removed can still sign it.",
		);
		expect(CHANGE.whoDecides(3, 3)).toContain("all 3 of them");
		expect(CHANGE.whoDecides(1, 1)).toContain("the one signer");
	});
});
