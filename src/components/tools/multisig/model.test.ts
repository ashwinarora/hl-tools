import {
	type EnvelopeRequest,
	exchangeRequestBody,
	type PlainObject,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, NONCE, TREASURY, usdSend } from "#/test/keys";
import { parseEnvelopeText } from "./model";

const ORDER: PlainObject = {
	type: "order",
	orders: [
		{
			a: 3,
			b: true,
			p: "50000",
			s: "0.001",
			r: false,
			t: { limit: { tif: "Gtc" } },
		},
	],
	grouping: "na",
};
const SIG = { r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: 27 };
const body = (action: PlainObject): string => {
	const request: EnvelopeRequest = {
		action: {
			type: "multiSig",
			signatureChainId: "0x66eee",
			signatures: [],
			payload: { multiSigUser: TREASURY, outerSigner: A, action },
		},
		nonce: NONCE,
		vaultAddress: null,
		expiresAfter: null,
	};
	return JSON.stringify(exchangeRequestBody(request, SIG as never));
};
const parsed = (action: PlainObject) => {
	const p = parseEnvelopeText(body(action), "testnet", NONCE);
	if (p.kind !== "proposal" || p.source !== "envelope")
		throw new Error(`not read as a request: ${p.kind}`);
	return p;
};

describe("a pasted request is judged over Hyperliquid's own writing of its inner action", () => {
	// measured on testnet: the core's fixtures/multisig/inner-form.json
	it("one already in that form is judged as it is, with nothing said", () => {
		for (const action of [ORDER, usdSend()]) {
			const p = parsed(action);
			expect(p.issues.map((i) => i.code)).toEqual([]);
			expect(p.asSent).toBeNull();
			expect(p.proposal.payload.action).toEqual(action);
		}
	});
	it("one in another form is brought into it, says so, and keeps what was pasted", () => {
		// a price with a trailing zero, as a hand-made request may carry it
		const zero = {
			...ORDER,
			orders: [{ ...(ORDER.orders as PlainObject[])[0], p: "50000.0" }],
		} as PlainObject;
		const p = parsed(zero);
		expect(p.issues.map((i) => [i.code, i.severity])).toEqual([
			["action.not_canonical", "warning"],
		]);
		expect(p.proposal.payload.action).toEqual(ORDER);
		expect(p.request.action.payload.action).toEqual(ORDER);
		expect(p.asSent).toEqual(zero);
		// the fields in another order
		const { grouping, ...rest } = ORDER;
		const turned = parsed({ grouping, ...rest } as PlainObject);
		expect(Object.keys(turned.proposal.payload.action)).toEqual(
			Object.keys(ORDER),
		);
		expect(Object.keys(turned.asSent ?? {})[0]).toBe("grouping");
	});
});
