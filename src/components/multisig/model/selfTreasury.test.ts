import { describe, expect, it } from "vitest";
import { partsText, shortAddress } from "./parts";
import { isItself, selfTag, switchSentence } from "./selfTreasury";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

describe("a wallet that is itself a treasury", () => {
	it("is tagged with its threshold", () => {
		expect(selfTag({ threshold: 2, authorizedUsers: [A, B, A] })).toBe(
			"treasury account · 2 of 3",
		);
	});

	it("is recognised whatever the case of either address", () => {
		expect(isItself(A.toUpperCase().replace("0X", "0x"), A)).toBe(true);
		expect(isItself(A, B)).toBe(false);
		expect(isItself(null, A)).toBe(false);
		expect(isItself(A, null)).toBe(false);
	});

	it("is told which signers to switch to, each as an address a screen can name", () => {
		const parts = switchSentence([A, B]);
		expect(partsText(parts)).toBe(
			`You are connected as the treasury itself. Switch to one of its signers: ${shortAddress(A)}, ${shortAddress(B)}.`,
		);
		expect(parts.filter((p) => p.who).map((p) => p.who)).toEqual([A, B]);
	});

	it("does without the list while the signers are not known", () => {
		expect(partsText(switchSentence([]))).toBe(
			"You are connected as the treasury itself. Switch to one of its signers in your wallet.",
		);
	});
});
