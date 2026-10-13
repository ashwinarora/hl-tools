import type { EnvelopeRequest, PlainObject } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, NONCE, TREASURY, usdSend } from "#/test/keys";
import { proposalFromRequest } from "./model";

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
const request = (action: PlainObject): EnvelopeRequest => ({
	action: {
		type: "multiSig",
		signatureChainId: "0x66eee",
		signatures: [],
		payload: { multiSigUser: TREASURY, outerSigner: A, action },
	},
	nonce: NONCE,
	vaultAddress: null,
	expiresAfter: null,
});
const codes = (action: PlainObject) =>
	proposalFromRequest(request(action), "testnet").issues.map((i) => i.code);

describe("a pasted request whose inner action is not in Hyperliquid's own form", () => {
	it("says nothing about an action written the way the SDKs write it", () => {
		expect(codes(ORDER)).toEqual([]);
		expect(codes(usdSend())).toEqual([]);
	});
	it("says that its signatures are judged over the bytes as pasted (found in review)", () => {
		// a price with a trailing zero, as a hand-made request may carry it
		const zero = {
			...ORDER,
			orders: [{ ...(ORDER.orders as PlainObject[])[0], p: "50000.0" }],
		} as PlainObject;
		const r = proposalFromRequest(request(zero), "testnet");
		expect(r.issues.map((i) => [i.code, i.severity])).toEqual([
			["action.as_pasted", "warning"],
		]);
		// the verdict is not flipped on a guess: the action judged is the pasted one
		expect(r.proposal?.payload.action).toEqual(zero);
		// the fields in another order
		const { grouping, ...rest } = ORDER;
		expect(codes({ grouping, ...rest } as PlainObject)).toEqual([
			"action.as_pasted",
		]);
	});
	it("an action it cannot read at all is left to the checks that say so", () => {
		expect(codes({ type: "order" } as PlainObject)).not.toContain(
			"action.as_pasted",
		);
	});
});
