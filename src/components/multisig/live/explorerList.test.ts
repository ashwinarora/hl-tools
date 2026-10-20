import { ExplorerAllowanceError, InfoRequestError } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { askAgain, failureOf, Resting } from "./explorerList";

const BODY = { type: "txDetails", hash: "0x00" };
const failed = (status: number | null, cause?: unknown) =>
	new InfoRequestError(
		"testnet",
		BODY,
		"Explorer request failed",
		status,
		cause,
	);

describe("a failed explorer request", () => {
	it("is asked again only when that could help", () => {
		// no answer at all, or a server error: once more may get through
		expect(askAgain(failed(null, new TypeError("Failed to fetch")))).toBe(true);
		expect(askAgain(failed(502))).toBe(true);
		// a refusal for the day, the rest after it, a rate limit: it would be refused again
		expect(
			askAgain(
				new ExplorerAllowanceError("testnet", BODY, "queried in one day", 200),
			),
		).toBe(false);
		expect(askAgain(new Resting())).toBe(false);
		expect(askAgain(failed(429))).toBe(false);
		// held for the whole time limit: the next one would be held as well
		const timeout = new DOMException("signal timed out", "TimeoutError");
		expect(askAgain(failed(null, timeout))).toBe(false);
		// stopped because the screen went away is not a timeout
		const stopped = new DOMException("aborted", "AbortError");
		expect(askAgain(failed(null, stopped))).toBe(true);
	});

	it("says why in the words of the row's cell", () => {
		expect(
			failureOf(
				new ExplorerAllowanceError("testnet", BODY, "queried in one day", 200),
			),
		).toBe("today");
		expect(failureOf(new Resting())).toBe("today");
		expect(failureOf(failed(429))).toBe("limited");
		expect(
			failureOf(
				failed(null, new DOMException("signal timed out", "TimeoutError")),
			),
		).toBe("no-answer");
	});
});
