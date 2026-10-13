/**
 * Whose writing of the inner action Hyperliquid hashes, replayed offline.
 * fixtures/multisig/inner-form.json holds eight requests the lab posted on
 * testnet and Hyperliquid's answers: the same vault deposit written three
 * ways, with the signers' and the leader's signatures made over one form or
 * another. The module has to give Hyperliquid's verdict on every one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type EnvelopeRequest,
	envelopeDigest,
	innerDigest,
	parseEnvelope,
	recoverInnerSigner,
	requestAsJudged,
} from "../../src/index.ts";

interface Recorded {
	about: string;
	posted: string;
	innerSignedOver: string;
	outerSignedOver: string;
	request: Record<string, unknown>;
	answer: { status: string; response: string };
}
const fx = JSON.parse(
	readFileSync(
		new URL("../../fixtures/multisig/inner-form.json", import.meta.url),
		"utf8",
	),
) as {
	account: string;
	policy: { authorizedUsers: string[]; threshold: number };
	requests: Recorded[];
};
const PASSED = "Vault deposits must be at least $5.";

/** What Hyperliquid answers, as this module would predict it from the request alone. */
async function predicted(r: Recorded, judge: boolean): Promise<string> {
	const parsed = parseEnvelope(r.request);
	const sent = parsed.request as EnvelopeRequest;
	const req = judge ? requestAsJudged(sent, "testnet").request : sent;
	const outer = envelopeDigest(req, "testnet").digest as `0x${string}`;
	const leader = await recoverInnerSigner(
		outer,
		parsed.outerSignature as never,
	);
	if (leader !== req.action.payload.outerSigner)
		return "Invalid multi-sig outer signer";
	const inner = innerDigest({
		network: "testnet",
		multiSigUser: req.action.payload.multiSigUser,
		outerSigner: req.action.payload.outerSigner,
		action: req.action.payload.action,
		nonce: req.nonce,
		vaultAddress: req.vaultAddress,
		expiresAfter: req.expiresAfter,
	}).digest as `0x${string}`;
	let counted = 0;
	for (const s of req.action.signatures) {
		const signer = await recoverInnerSigner(inner, s as never);
		if (signer && fx.policy.authorizedUsers.includes(signer)) counted += 1;
	}
	return counted >= fx.policy.threshold
		? PASSED
		: "Invalid multi-sig inner signer";
}

describe("the form of the inner action Hyperliquid hashes (fixtures/multisig/inner-form.json)", () => {
	it("holds the eight requests, three of them in a form that is not Hyperliquid's own", () => {
		expect(fx.requests).toHaveLength(8);
		expect(new Set(fx.requests.map((r) => r.posted))).toEqual(
			new Set(["canonical", "reordered", "capitals"]),
		);
	});

	it.each(
		fx.requests.map((r) => [r.about, r] as const),
	)("%s", async (_about, r) => {
		// judged over Hyperliquid's own writing of the action: its answer, every time
		expect(await predicted(r, true)).toBe(r.answer.response);
	});

	it("judged over the action as it was sent, six of the eight verdicts are not Hyperliquid's", async () => {
		// the measurement in one line: signatures over the bytes as sent pass
		// here and are refused there, and the other way round
		const wrong: string[] = [];
		for (const r of fx.requests)
			if ((await predicted(r, false)) !== r.answer.response)
				wrong.push(`${r.posted}/${r.innerSignedOver}/${r.outerSignedOver}`);
		expect(wrong).toEqual([
			"reordered/reordered/reordered",
			"reordered/canonical/canonical",
			"capitals/capitals/capitals",
			"capitals/canonical/canonical",
			"reordered/reordered/canonical",
			"capitals/capitals/canonical",
		]);
	});

	it("a request already in that form is judged as it is, and the other form is kept beside it", () => {
		const [control, reordered] = fx.requests.map(
			(r) => parseEnvelope(r.request).request as EnvelopeRequest,
		) as [EnvelopeRequest, EnvelopeRequest];
		const same = requestAsJudged(control, "testnet");
		expect(same.request).toBe(control);
		expect([same.asSent, same.issues]).toEqual([null, []]);
		const other = requestAsJudged(reordered, "testnet");
		expect(other.request.action.payload.action).toEqual(
			control.action.payload.action,
		);
		expect(Object.keys(other.request.action.payload.action)).toEqual([
			"type",
			"vaultAddress",
			"isDeposit",
			"usd",
		]);
		expect(Object.keys(other.asSent ?? {})).toEqual([
			"usd",
			"isDeposit",
			"vaultAddress",
			"type",
		]);
		expect(other.issues.map((i) => [i.code, i.severity])).toEqual([
			["action.not_canonical", "warning"],
		]);
	});

	it("an action holding an integer too large for a number is compared, never thrown on", () => {
		// such an integer arrives from a pasted body as a bigint, and
		// JSON.stringify throws on one (found when the fix was read)
		const control = parseEnvelope(fx.requests[0]?.request)
			.request as EnvelopeRequest;
		const huge: EnvelopeRequest = {
			...control,
			action: {
				...control.action,
				payload: {
					...control.action.payload,
					action: {
						...control.action.payload.action,
						usd: 12345678901234567890n,
					} as never,
				},
			},
		};
		expect(() => requestAsJudged(huge, "testnet")).not.toThrow();
		// and with its fields in another order as well
		const { type, ...rest } = huge.action.payload.action;
		const turned: EnvelopeRequest = {
			...huge,
			action: {
				...huge.action,
				payload: { ...huge.action.payload, action: { ...rest, type } },
			},
		};
		expect(() => requestAsJudged(turned, "testnet")).not.toThrow();
	});

	it("an action it cannot bring into that form is judged as it was sent", () => {
		const control = parseEnvelope(fx.requests[0]?.request)
			.request as EnvelopeRequest;
		const unreadable: EnvelopeRequest = {
			...control,
			action: {
				...control.action,
				payload: { ...control.action.payload, action: { type: 5 } as never },
			},
		};
		const judged = requestAsJudged(unreadable, "testnet");
		expect(judged.request).toBe(unreadable);
		expect(judged.asSent).toBeNull();
	});
});
