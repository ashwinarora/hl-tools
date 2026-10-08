import {
	buildEnvelope,
	classifySignatures,
	type EnvelopeRequest,
	type Sig,
	signEnvelope,
	viemSigner,
} from "@hl-tools/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
	ACCOUNTS,
	B,
	makeProposal,
	NONCE,
	POLICY,
	signAs,
	TREASURY,
} from "#/test/keys";
import {
	exchangeBodyText,
	exchangeUrl,
	submitEnvelope,
	withReceipt,
} from "./submit";

let request: EnvelopeRequest;
let outer: Sig;

beforeAll(async () => {
	const p = await signAs(await signAs(makeProposal(), 1), 2);
	const classified = await classifySignatures(p, POLICY);
	request = buildEnvelope(p, { signatureChainId: "0x3e6", classified }).request;
	const signed = await signEnvelope(
		request,
		"testnet",
		viemSigner(ACCOUNTS[2] as never),
	);
	if (!signed.signature) throw new Error(JSON.stringify(signed.issues));
	outer = signed.signature;
});

const answering = (status: number, body: string) => {
	const calls: { url: string; init: RequestInit }[] = [];
	const fake = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return new Response(body, { status });
	}) as unknown as typeof fetch;
	return { fake, calls };
};

describe("submitEnvelope", () => {
	it("posts the canonical envelope to the network's exchange endpoint", async () => {
		expect(exchangeUrl("mainnet")).toBe("https://api.hyperliquid.xyz/exchange");
		const { fake, calls } = answering(
			200,
			'{"status":"ok","response":{"type":"default"}}',
		);
		const out = await submitEnvelope("testnet", request, outer, {
			fetch: fake,
			now: () => 42,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://api.hyperliquid-testnet.xyz/exchange");
		expect(calls[0]?.init.method).toBe("POST");
		expect(calls[0]?.init.headers).toEqual({
			"content-type": "application/json",
		});
		expect(calls[0]?.init.body).toBe(exchangeBodyText(request, outer));
		const body = JSON.parse(calls[0]?.init.body as string);
		expect(Object.keys(body)).toEqual([
			"action",
			"nonce",
			"signature",
			"vaultAddress",
		]);
		expect(Object.keys(body.action)).toEqual([
			"type",
			"signatureChainId",
			"signatures",
			"payload",
		]);
		expect(body.action.signatureChainId).toBe("0x3e6");
		expect(body.action.payload).toMatchObject({
			multiSigUser: TREASURY,
			outerSigner: B,
		});
		expect(body.action.signatures).toHaveLength(2);
		// inner signatures travel without leading zero digits
		for (const s of body.action.signatures) {
			expect(s.r).toMatch(/^0x[1-9a-f]/);
			expect(s.s).toMatch(/^0x[1-9a-f]/);
		}
		expect(body.nonce).toBe(NONCE);
		expect(body.vaultAddress).toBeNull();
		expect(out.explained.id).toBe("ok");
		expect(out.receipt).toEqual({
			submittedAt: 42,
			signatureChainId: "0x3e6",
			outerSignature: outer,
			httpStatus: 200,
			response: { status: "ok", response: { type: "default" } },
		});
	});

	it("turns a chain rejection into an explained receipt", async () => {
		const { fake } = answering(
			200,
			'{"status":"err","response":"Invalid multi-sig inner signer"}',
		);
		const out = await submitEnvelope("testnet", request, outer, {
			fetch: fake,
		});
		expect(out.explained.id).not.toBe("ok");
		expect(out.explained.source).toBe("status");
		expect(out.receipt.httpStatus).toBe(200);
		expect(out.receipt.submittedAt).toBeGreaterThan(NONCE);
	});

	it("keeps a non-JSON body verbatim and never throws on an HTTP error", async () => {
		const { fake } = answering(422, "Failed to deserialize the JSON body");
		const out = await submitEnvelope("testnet", request, outer, {
			fetch: fake,
		});
		expect(out.receipt.httpStatus).toBe(422);
		expect(out.receipt.response).toBe("Failed to deserialize the JSON body");
		expect(out.explained.source).toBe("http");
	});

	it("rejects only when the request never got an answer", async () => {
		const down = (async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;
		await expect(
			submitEnvelope("testnet", request, outer, { fetch: down }),
		).rejects.toThrow("Failed to fetch");
	});

	it("attaches a receipt without touching the rest of the document", async () => {
		const p = makeProposal();
		const { fake } = answering(
			200,
			'{"status":"ok","response":{"type":"default"}}',
		);
		const { receipt } = await submitEnvelope("testnet", request, outer, {
			fetch: fake,
		});
		const done = withReceipt(p, receipt);
		expect(done.receipt).toBe(receipt);
		expect({ ...done, receipt: null }).toEqual(p);
	});
});
