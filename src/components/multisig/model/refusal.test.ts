import { explainExchangeError } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { HELP_JARGON } from "./help";
import { PLAIN_REFUSALS, refusalNote, UNKNOWN_REFUSAL } from "./refusal";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

describe("what the page says under a refusal", () => {
	it("gives the catalogue's cause and fix for an answer it knows", () => {
		const e = explainExchangeError(
			{ status: "err", response: "Price must be divisible by tick size." },
			200,
		);
		expect(e.id).not.toBe("unknown");
		expect(PLAIN_REFUSALS[e.id]).toBeUndefined();
		expect(refusalNote(e)).toBe(`${e.cause} ${e.fix}`);
	});

	it("names no action by its type, in plain words that claim nothing", () => {
		for (const [id, text] of Object.entries(PLAIN_REFUSALS)) {
			expect(text, id).not.toMatch(
				/usdSend|spotSend|sendAsset|withdraw3|usdClassTransfer|toPerp|sourceDex/,
			);
			for (const p of [...HELP_JARGON, ...FORBIDDEN_CLAIMS])
				expect(text, id).not.toMatch(p);
		}
		const e = explainExchangeError(
			{ status: "err", response: "Insufficient balance for withdrawal." },
			200,
		);
		expect(e.id).toBe("transfer-balance");
		expect(refusalNote(e)).toBe(PLAIN_REFUSALS["transfer-balance"]);
	});

	it("covers every answer of the catalogue that names an action type", async () => {
		const { ERROR_CATALOG } = await import("@hl-tools/core");
		const naming =
			/usdSend|spotSend|sendAsset|withdraw3|usdClassTransfer|toPerp|cDeposit|vaultTransfer|approveAgent/;
		// answers to what this section never sends: an order, an API wallet's
		// own send, a signer list this tool always writes whole
		const elsewhere = new Set([
			"spot-balance",
			"agent-send-scope",
			"revert-shape",
		]);
		for (const rule of ERROR_CATALOG) {
			if (!naming.test(`${rule.cause} ${rule.fix}`) || elsewhere.has(rule.id))
				continue;
			expect(PLAIN_REFUSALS[rule.id], rule.id).toBeDefined();
		}
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
