import type { PlainObject, Proposal } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, makeProposal, TREASURY, usdSend } from "#/test/keys";
import { buildAction, DEFAULT_FORM, formFromAction } from "./actions";
import { reproposeSource } from "./repropose";

/** The same proposal as it would be on mainnet (only the claim, for these checks). */
const onMainnet = (p: Proposal): Proposal => ({
	...p,
	payload: { ...p.payload, network: "mainnet" },
});

describe("re-proposing", () => {
	// the audit's case: one address, a treasury on testnet and on mainnet
	const testnet = makeProposal({ title: "testnet rehearsal" });

	it("starts from a proposal of the same treasury on the same network", () => {
		expect(reproposeSource(testnet, "testnet", TREASURY)).toEqual({
			ok: true,
			proposal: testnet,
		});
		// however the address is written
		expect(
			reproposeSource(
				testnet,
				"testnet",
				TREASURY.toUpperCase().replace("0X", "0x"),
			).ok,
		).toBe(true);
	});

	it("never fills a mainnet form from a testnet proposal, or the other way round", () => {
		const cross = reproposeSource(testnet, "mainnet", TREASURY);
		expect(cross).toMatchObject({ ok: false, reason: "other-network" });
		expect(cross.ok ? "" : cross.text).toBe(
			"That proposal is for testnet and this form is for mainnet. Nothing was copied from it: a proposal is never carried from one network to the other.",
		);
		expect(
			reproposeSource(onMainnet(testnet), "testnet", TREASURY),
		).toMatchObject({ ok: false, reason: "other-network" });
	});

	it("never fills a form from another treasury's proposal", () => {
		const other = reproposeSource(testnet, "testnet", A);
		expect(other).toMatchObject({ ok: false, reason: "other-treasury" });
		expect(other.ok ? "" : other.text).toContain(TREASURY.slice(0, 6));
	});

	it("is the only way an old action reaches a form: without it the form builds nothing", () => {
		// what the screen does with a refused source: the form stays as it was
		const refused = reproposeSource(testnet, "mainnet", TREASURY);
		const form = refused.ok
			? {
					...DEFAULT_FORM,
					...formFromAction(
						refused.proposal.payload.action,
						refused.proposal.payload.network,
					),
				}
			: DEFAULT_FORM;
		const built = buildAction(form, {
			network: "mainnet",
			multiSigUser: TREASURY,
			nonce: 1,
			signatureChainId: "0x3e7",
		});
		expect(built.action).toBeNull();
		// while the same source, on its own network, fills it
		const ok = reproposeSource(testnet, "testnet", TREASURY);
		expect(ok.ok).toBe(true);
		const action: PlainObject = usdSend();
		expect(formFromAction(action, "testnet").destination).toBe(
			action.destination,
		);
	});
});
