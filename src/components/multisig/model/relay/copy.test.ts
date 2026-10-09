import { describe, expect, it } from "vitest";
import { FORBIDDEN_CLAIMS, RELAY_COPY } from "./copy";
import { REFUSAL_TEXTS } from "./errors";
import { SIGN_IN_STATEMENT } from "./siwe";

describe("relay copy", () => {
	const all: [string, string][] = [
		...Object.entries(RELAY_COPY),
		["sign-in statement", SIGN_IN_STATEMENT],
		...REFUSAL_TEXTS.map((t, i): [string, string] => [`refusal ${i}`, t]),
	];

	it.each(
		all,
	)("%s promises nothing the relay does not provide", (_name, text) => {
		for (const pattern of FORBIDDEN_CLAIMS) {
			expect(text, `${pattern} in "${text}"`).not.toMatch(pattern);
		}
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
