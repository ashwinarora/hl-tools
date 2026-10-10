import { describe, expect, it } from "vitest";
import { joinParts, type Part, part, partsText, say } from "./parts";

const A = `0x${"a".repeat(40)}`;
const who: Part = { text: "0xaaaa…aaaa", who: A };
const when: Part = { text: "2026-10-12 21:04 UTC", when: 1_791_839_040_000 };

describe("say", () => {
	it("builds a sentence from fixed text and parts, keeping what each part is", () => {
		expect(say`Withdrawn by ${who} until ${when}.`).toEqual([
			{ text: "Withdrawn by " },
			who,
			{ text: " until " },
			when,
			{ text: "." },
		]);
	});
	it("merges neighbouring plain text, and drops what is empty", () => {
		expect(say`a${"b"}c${""}d`).toEqual([{ text: "abcd" }]);
		expect(say`${who}`).toEqual([who]);
		expect(say``).toEqual([]);
	});
	it("splices a list of parts in, and never merges a strong or quiet part away", () => {
		const strong: Part = { text: "Send 1 USDC", strong: true };
		const quiet: Part = { text: " (title)", quiet: true };
		expect(
			say`${[strong, quiet]} was withdrawn${[part(" by "), who]}.`,
		).toEqual([
			strong,
			quiet,
			{ text: " was withdrawn by " },
			who,
			{ text: "." },
		]);
	});
	it("reads the same as the plain text, whatever a screen does with the parts", () => {
		expect(partsText(say`Withdrawn by ${who} until ${when}.`)).toBe(
			"Withdrawn by 0xaaaa…aaaa until 2026-10-12 21:04 UTC.",
		);
		expect(partsText([])).toBe("");
	});
});

describe("joinParts", () => {
	it("joins like Array.join", () => {
		expect(partsText(joinParts([[who], [part("you")], [who]], ", "))).toBe(
			"0xaaaa…aaaa, you, 0xaaaa…aaaa",
		);
		expect(joinParts([], ", ")).toEqual([]);
		expect(joinParts([[who]], ", ")).toEqual([who]);
	});
});
