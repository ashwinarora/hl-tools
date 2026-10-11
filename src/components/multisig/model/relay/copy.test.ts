import { describe, expect, it } from "vitest";
import {
	FORBIDDEN_CLAIMS,
	RELAY_COPY,
	SIGN_HINT_TEXTS,
	signHint,
} from "./copy";
import { REFUSAL_TEXTS } from "./errors";
import { nicknameProblem } from "./nicknames";
import { SIGN_IN_STATEMENT } from "./siwe";

describe("relay copy", () => {
	const all: [string, string][] = [
		...Object.entries(RELAY_COPY),
		["sign-in statement", SIGN_IN_STATEMENT],
		...SIGN_HINT_TEXTS.map((t, i): [string, string] => [`sign hint ${i}`, t]),
		...REFUSAL_TEXTS.map((t, i): [string, string] => [`refusal ${i}`, t]),
		// what the page says when it refuses a nickname before asking the relay
		...["", "0xabc", "You", "x".repeat(41), `a${String.fromCodePoint(0x200b)}b`]
			.map((name) => nicknameProblem(name))
			.filter((t): t is string => t !== null)
			.map((t, i): [string, string] => [`nickname rule ${i}`, t]),
	];

	it.each(
		all,
	)("%s promises nothing the relay does not provide", (_name, text) => {
		for (const pattern of FORBIDDEN_CLAIMS) {
			expect(text, `${pattern} in "${text}"`).not.toMatch(pattern);
		}
	});

	it("says what the wallet will show for the kind of action being signed", () => {
		// a send: the destination and the amount
		expect(signHint("sendAsset")).toBe(RELAY_COPY.underSign);
		expect(signHint("withdraw3")).toContain("the destination and the amount");
		// a change of signers has neither
		expect(signHint("convertToMultiSigUser")).toContain(
			"the new list of signers with the number that must sign",
		);
		expect(signHint("convertToMultiSigUser")).not.toContain("amount");
		expect(signHint("approveAgent")).toContain("the API wallet");
		// an action this page has no sentence for, or a document that names none:
		// nothing is promised that the prompt may not show
		expect(signHint("somethingNew")).toContain("every field of the action");
		expect(signHint(undefined)).not.toContain("amount");
	});

	it("still lets the checker see what it is meant to catch", () => {
		const caught = (s: string) => FORBIDDEN_CLAIMS.some((p) => p.test(s));
		for (const bad of [
			"Your proposals are private.",
			"Stored privately.",
			"End-to-end encrypted.",
			"Only you can read them.",
			"No server holds anything.",
			"It works without a server.",
			"Free forever.",
			"Free for teams.",
			"There is no backend.",
			"Your data never leaves this browser.",
			"Kept secret.",
			"Confidential by default.",
			"Stored in this browser only.",
		]) {
			expect(caught(bad), bad).toBe(true);
		}
		expect(caught("No private key is ever asked for.")).toBe(false);
	});

	it("sends the reader to the Privacy Policy at sign-in", () => {
		expect(`${RELAY_COPY.smallPrintBefore}${RELAY_COPY.smallPrintLink}.`).toBe(
			"By signing in you agree to the Privacy Policy.",
		);
	});
});
