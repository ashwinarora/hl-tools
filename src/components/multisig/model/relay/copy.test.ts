import { describe, expect, it } from "vitest";
import {
	afterRejection,
	FORBIDDEN_CLAIMS,
	gateOthers,
	othersSummary,
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
		["after a rejection (200)", afterRejection(200)],
		["after a rejection (502)", afterRejection(502)],
		["after a rejection (unknown)", afterRejection(undefined)],
		["others (1, connected)", othersSummary(1, true)],
		["others (3, connected)", othersSummary(3, true)],
		["others (1, none connected)", othersSummary(1, false)],
		["others (2, none connected)", othersSummary(2, false)],
		["gate (1 other)", gateOthers(1)],
		["gate (4 others)", gateOthers(4)],
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
		expect(signHint({ type: "sendAsset" })).toBe(RELAY_COPY.underSign);
		expect(signHint({ type: "withdraw3" })).toContain(
			"the destination and the amount",
		);
		// a change of signers has neither
		const change = signHint({
			type: "convertToMultiSigUser",
			signers: '{"authorizedUsers":[],"threshold":2}',
		});
		expect(change).toContain(
			"the new list of signers with the number that must sign",
		);
		expect(change).not.toContain("amount");
		// the conversion back shows no list at all
		expect(
			signHint({ type: "convertToMultiSigUser", signers: "null" }),
		).toContain("“signers” as “null”");
		expect(signHint({ type: "approveAgent" })).toContain("the API wallet");
		// an action this page has no sentence for, or a document that names none:
		// nothing is promised that the prompt may not show
		expect(signHint({ type: "somethingNew" })).toContain(
			"every field of the action",
		);
		expect(signHint({})).not.toContain("amount");
	});

	it("never calls a proposal that Hyperliquid itself refused retryable", () => {
		// the proposal's number is used up by any answer from Hyperliquid (numberSpent)
		expect(afterRejection(200)).not.toMatch(/retr|can be sent again/i);
		expect(afterRejection(200)).toContain("cannot be sent again as it is");
		// a request that never got there is another matter
		expect(afterRejection(502)).toContain("can be sent again");
		expect(afterRejection("200")).toBe("Open it to see why.");
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

	it("counts the wallets signed in here in plain words", () => {
		expect(othersSummary(1, true)).toBe("1 more wallet is signed in here");
		expect(othersSummary(2, true)).toBe("2 more wallets are signed in here");
		expect(othersSummary(1, false)).toBe("1 wallet is signed in here");
		expect(othersSummary(3, false)).toBe("3 wallets are signed in here");
		expect(gateOthers(1)).toMatch(/^Another wallet is signed in here\./);
		expect(gateOthers(2)).toMatch(/^2 other wallets are signed in here\./);
		// a parked wallet is never said to be doing anything
		expect(RELAY_COPY.othersHow).toMatch(/nothing is read or sent for these/);
	});
});
