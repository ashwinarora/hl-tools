/**
 * The Phase 2 milestone, offline: A proposes a USDC send and signs, the link
 * goes to B (the finaliser), B signs the inner payload, signs the envelope and
 * submits, the receipt lands in both the document and the history.
 */
import {
	buildEnvelope,
	classifySignatures,
	createProposal,
	decodeProposal,
	encodeProposal,
	readiness,
	signEnvelope,
	signProposal,
	viemSigner,
} from "@hl-tools/core";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
	A,
	ACCOUNTS,
	B,
	NONCE,
	NOW,
	POLICY,
	RECIPIENT,
	TREASURY,
} from "#/test/keys";
import { buildProposalInput, DEFAULT_FORM } from "./actions";
import { innerChain } from "./chains";
import { loadProposal, saveProposal } from "./history";
import { deriveStage } from "./stage";
import { submitEnvelope, withReceipt } from "./submit";
import { linkTransport, openText } from "./transport";

const acct = (i: number) => viemSigner(ACCOUNTS[i] as never);
const chain = innerChain("testnet", "hyperevm");

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
});

async function proposedByA() {
	const draft = buildProposalInput(
		{
			...DEFAULT_FORM,
			kind: "usdSend",
			destination: RECIPIENT,
			amount: "1",
			finaliser: B,
			title: "Phase 2 milestone",
		},
		{
			network: "testnet",
			multiSigUser: TREASURY,
			nonce: NONCE,
			signatureChainId: chain.hex,
			createdBy: A,
			policyAtCreation: POLICY,
		},
	);
	if (!draft.input) throw new Error(JSON.stringify(draft.issues));
	const created = createProposal(draft.input, { now: NOW });
	if (!created.proposal) throw new Error(JSON.stringify(created.issues));
	expect(created.flags).toEqual(["funds_out"]);
	const sig = await signProposal(created.proposal, acct(1), {
		expectedSigner: A,
		at: NOW,
	});
	if (!sig.signature) throw new Error(JSON.stringify(sig.issues));
	return (
		await saveProposal({ ...created.proposal, signatures: [sig.signature] })
	).proposal;
}

describe("propose → sign → pass on → sign → execute", () => {
	it("completes a 2-of-3 USDC send with the finaliser finishing in one sitting", async () => {
		const fromA = await proposedByA();
		const url = linkTransport(() => "https://hltools.test").publish(fromA)
			.url as string;

		// --- B's browser: a fresh history, the link is all there is
		globalThis.indexedDB = new IDBFactory();
		const opened = openText(url, NOW);
		if (!opened.proposal) throw new Error(JSON.stringify(opened.issues));
		let p = (await saveProposal(opened.proposal)).proposal;
		expect(p).toEqual(fromA);

		let classified = await classifySignatures(p, POLICY);
		let stage = deriveStage({
			proposal: p,
			readiness: readiness(p, POLICY, classified, { now: NOW }),
			policy: POLICY,
			wallet: B,
			walletChainId: 1,
			now: NOW,
		});
		expect([
			stage.phase,
			stage.role,
			stage.canExecute,
			stage.executeAddsSignature,
		]).toEqual(["collecting", "signer-finaliser", true, true]);
		expect(stage.requiredChain?.id).toBe(998);
		expect(stage.onRequiredChain).toBe(false); // the wallet would be asked to switch

		const inner = await signProposal(p, acct(2), {
			expectedSigner: B,
			at: NOW,
		});
		if (!inner.signature) throw new Error(JSON.stringify(inner.issues));
		p = (await saveProposal({ ...p, signatures: [inner.signature] })).proposal;
		expect(p.signatures.map((s) => s.signer)).toEqual([B, A]);

		classified = await classifySignatures(p, POLICY);
		const ready = readiness(p, POLICY, classified, { now: NOW });
		expect(ready.status).toBe("ready");
		const { request } = buildEnvelope(p, {
			signatureChainId: stage.requiredChain?.hex,
			classified,
		});
		const outer = await signEnvelope(request, "testnet", acct(2));
		expect(outer.recovered).toBe(B);
		if (!outer.signature) throw new Error(JSON.stringify(outer.issues));

		let posted: Record<string, never> | null = null;
		const fake = (async (_url: string, init: RequestInit) => {
			posted = JSON.parse(init.body as string);
			return new Response('{"status":"ok","response":{"type":"default"}}', {
				status: 200,
			});
		}) as unknown as typeof fetch;
		const sent = await submitEnvelope("testnet", request, outer.signature, {
			fetch: fake,
			now: () => NOW + 5,
		});
		expect(sent.explained.id).toBe("ok");
		const body = posted as unknown as {
			action: {
				signatureChainId: string;
				signatures: unknown[];
				payload: { action: Record<string, unknown> };
			};
			nonce: number;
			vaultAddress: null;
		};
		expect(body.action.signatureChainId).toBe("0x3e6");
		expect(body.action.signatures).toHaveLength(2);
		expect(body.action.payload.action).toEqual({
			type: "usdSend",
			signatureChainId: "0x3e6",
			hyperliquidChain: "Testnet",
			destination: RECIPIENT,
			amount: "1",
			time: NONCE,
		});
		expect(body.nonce).toBe(NONCE);
		expect(body.vaultAddress).toBeNull();
		expect("expiresAfter" in body).toBe(false);

		p = (await saveProposal(withReceipt(p, sent.receipt))).proposal;
		const stored = (await loadProposal(p.digest)).proposal;
		expect(stored?.receipt?.httpStatus).toBe(200);
		expect(decodeProposal(encodeProposal(p)).proposal).toEqual(p);
		stage = deriveStage({
			proposal: p,
			readiness: ready,
			policy: POLICY,
			wallet: B,
			walletChainId: 998,
			now: NOW,
		});
		expect([stage.phase, stage.canSign, stage.canExecute]).toEqual([
			"submitted",
			false,
			false,
		]);
	});

	it("an outsider's signature never counts, and only the finaliser can sign the envelope", async () => {
		const fromA = await proposedByA();
		const outsider = await signProposal(fromA, acct(4), { at: NOW });
		if (!outsider.signature) throw new Error("outsider did not sign");
		const p = (
			await saveProposal({ ...fromA, signatures: [outsider.signature] })
		).proposal;
		const classified = await classifySignatures(p, POLICY);
		expect(classified.map((c) => c.status).sort()).toEqual([
			"valid-authorized",
			"valid-unauthorized",
		]);
		expect(readiness(p, POLICY, classified, { now: NOW }).status).toBe(
			"not-ready",
		);

		const { request } = buildEnvelope(p, {
			signatureChainId: "0x3e6",
			classified,
		});
		expect(request.action.signatures).toHaveLength(1);
		const wrong = await signEnvelope(request, "testnet", acct(1));
		expect(wrong.signature).toBeNull();
		expect(wrong.issues.map((i) => i.code)).toEqual([
			"envelope.signer_mismatch",
		]);
		expect(wrong.recovered).toBe(A);
	});
});
