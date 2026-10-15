import { describe, expect, it } from "vitest";
import { askedFor, gotNoAnswer } from "./noAnswer";

describe("a request to Hyperliquid that got no answer", () => {
	it("is told apart from an answer, whatever wraps it", () => {
		for (const e of [
			new TypeError("Failed to fetch"),
			new TypeError("NetworkError when attempting to fetch resource."),
			new TypeError("Load failed"),
			new Error("Unknown HTTP request error: TypeError: Failed to fetch"),
			new DOMException("signal timed out", "TimeoutError"),
			new DOMException("The user aborted a request.", "AbortError"),
			new Error("wrapped", { cause: new TypeError("Failed to fetch") }),
		])
			expect(gotNoAnswer(e), String(e)).toBe(true);
		for (const e of [
			new Error("Insufficient balance for withdrawal."),
			{ message: 42 },
			null,
			"Failed to fetch",
		])
			expect(gotNoAnswer(e), String(e)).toBe(false);
	});

	it("is said in plain words, and an answer in Hyperliquid's own", () => {
		expect(askedFor("the signer list", new TypeError("Failed to fetch"))).toBe(
			"Hyperliquid did not answer when asked for the signer list.",
		);
		expect(
			askedFor(
				"the signer list",
				new Error("User or API Wallet does not exist"),
			),
		).toBe(
			"Hyperliquid answered with an error when asked for the signer list: User or API Wallet does not exist",
		);
		expect(askedFor("the signer list", "odd")).toContain(": odd");
	});
});
