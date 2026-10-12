import { explainExchangeError } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { refusalNote, UNKNOWN_REFUSAL } from "./refusal";

describe("what the page says under a refusal", () => {
	it("gives the catalogue's cause and fix for an answer it knows", () => {
		const e = explainExchangeError(
			{ status: "err", response: "Withdrawal is smaller than fee." },
			200,
		);
		expect(e.id).toBe("withdrawal-below-fee");
		expect(refusalNote(e)).toBe(`${e.cause} ${e.fix}`);
	});

	it("says plainly that it does not know an answer, with no advice about the code", () => {
		const e = explainExchangeError(
			{ status: "err", response: "Some sentence nobody has seen before." },
			200,
		);
		expect(e.id).toBe("unknown");
		const note = refusalNote(e);
		expect(note).toBe(UNKNOWN_REFUSAL);
		expect(note).not.toMatch(
			/buildEnvelope|catalogue|envelope|field by field/i,
		);
	});

	it("keeps what is known about a request that did not get through", () => {
		const e = explainExchangeError("<html>server error</html>", 500);
		const note = refusalNote(e);
		expect(note).toMatch(/HTTP 500/);
		expect(note).not.toMatch(/buildEnvelope|catalogue/i);
	});
});
