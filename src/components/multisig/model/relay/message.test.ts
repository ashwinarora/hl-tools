import { describe, expect, it } from "vitest";
import { makeProposal, TREASURY } from "#/test/keys";
import { coSignerMessage, proposalUrl } from "./message";

describe("coSignerMessage", () => {
	const p = makeProposal();

	it("names the treasury by its short address and links to the proposal by digest", () => {
		expect(
			coSignerMessage({
				origin: "https://hltools.tech",
				treasury: TREASURY,
				digest: p.digest,
			}),
		).toBe(
			`A proposal for treasury ${TREASURY.slice(0, 6)}…${TREASURY.slice(-4)} is waiting for signatures: https://hltools.tech/multisig/proposal?digest=${p.digest}`,
		);
	});

	it("carries nothing of the action: no amount, no destination, no title", () => {
		const text = coSignerMessage({
			origin: "https://hltools.tech",
			treasury: TREASURY,
			digest: p.digest,
		});
		const action = p.payload.action as { destination: string; amount: string };
		expect(text).not.toContain(action.destination);
		expect(text).not.toContain(String(p.meta.title));
		expect(text).not.toMatch(/USDC|usdSend/);
		expect(text.replace(p.digest, "")).not.toMatch(/\b1\b/);
	});

	it("tolerates a trailing slash on the origin", () => {
		expect(proposalUrl("http://localhost:3000/", p.digest)).toBe(
			`http://localhost:3000/multisig/proposal?digest=${p.digest}`,
		);
	});
});
