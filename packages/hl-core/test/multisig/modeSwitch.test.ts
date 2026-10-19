/**
 * The account-mode switch, replayed offline. fixtures/multisig/mode-switch.json
 * holds the requests the lab posted on testnet and Hyperliquid's answers: the
 * leader's envelope signature made over the envelope as posted (refused) and
 * over the envelope with `abstraction` as its one-letter code (accepted). The
 * module has to agree with Hyperliquid on every one of them.
 */
import { readFileSync } from "node:fs";
import { signMultiSigAction } from "@nktkas/hyperliquid/signing";
import { describe, expect, it } from "vitest";
import {
	canonicalEnvelopeAction,
	describeAction,
	type EnvelopeRequest,
	envelopeDigest,
	explainExchangeError,
	hashedEnvelopeAction,
	innerDigest,
	type PlainObject,
	parseEnvelope,
	recoverInnerSigner,
	signEnvelope,
	trimSig,
	viemSigner,
} from "../../src/index.ts";
import {
	ABSTRACTION_ENVELOPE_CODES,
	MULTISIG_RULES,
} from "../../src/rules/multisig.ts";
import { A, ACCOUNTS, NONCE, TREASURY } from "./_helpers.ts";

interface Recorded {
	about: string;
	hashedAbstraction?: string | null;
	request: Record<string, unknown>;
	answer: { status: string; response: unknown };
}
const fx = JSON.parse(
	readFileSync(
		new URL("../../fixtures/multisig/mode-switch.json", import.meta.url),
		"utf8",
	),
) as {
	hashedAs: Record<string, string>;
	requests: Recorded[];
	switches: (Recorded & {
		before: {
			mode: string;
			openOrders: number;
			perps: { positions: string[] };
		};
		after: { mode: string };
	})[];
};
const all = [...fx.requests, ...fx.switches];
/** The test key of A, the leader in the hand-made requests below. */
const LEADER = ACCOUNTS[1] as NonNullable<(typeof ACCOUNTS)[number]>;
const REFUSED = "Invalid multi-sig outer signer";

describe("the envelope around a mode switch (fixtures/multisig/mode-switch.json)", () => {
	it("knows the letters the fixture measured, and no others", () => {
		expect(ABSTRACTION_ENVELOPE_CODES).toEqual(fx.hashedAs);
		expect(ABSTRACTION_ENVELOPE_CODES).toEqual({
			unifiedAccount: "u",
			disabled: "i",
		});
		expect(
			MULTISIG_RULES.changelog.find((c) => c.version === "1.4.0")?.note,
		).toMatch(/one-letter code/);
	});

	it.each(
		all.map((r, i) => [`${i + 1}. ${r.about}`, r] as const),
	)("%s", async (_name, rec) => {
		const parsed = parseEnvelope(rec.request);
		expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
		const req = parsed.request as EnvelopeRequest;
		const inner = req.action.payload.action;
		const leader = req.action.payload.outerSigner;
		const recovered = await recoverInnerSigner(
			envelopeDigest(req, "testnet").digest as `0x${string}`,
			parsed.outerSignature as never,
		);
		// what was posted, and what every signer signed, carries the name in full
		expect(canonicalEnvelopeAction(req)).toMatchObject({
			payload: { action: inner },
		});
		const d = innerDigest({
			network: "testnet",
			multiSigUser: req.action.payload.multiSigUser,
			outerSigner: leader,
			action: inner,
			nonce: req.nonce,
			vaultAddress: null,
			expiresAfter: null,
		});
		const signers = await Promise.all(
			req.action.signatures.map((sig) =>
				recoverInnerSigner(d.digest as `0x${string}`, sig as never),
			),
		);
		expect(signers).toContain(leader);
		expect(new Set(signers).size).toBe(signers.length);

		if (inner.type !== "userSetAbstraction") {
			// any other action is hashed as it is sent
			expect(recovered).toBe(leader);
			return;
		}
		const code = ABSTRACTION_ENVELOPE_CODES[String(inner.abstraction)];
		if (rec.hashedAbstraction === code) {
			// the lab's leader signed over the letter: this module's hash is that hash
			expect(recovered).toBe(leader);
			expect(rec.answer.response).not.toBe(REFUSED);
		} else {
			// signed over the envelope as posted: not what Hyperliquid hashes
			expect(recovered).not.toBe(leader);
			expect(rec.answer).toEqual({ status: "err", response: REFUSED });
		}
	});

	it("covers both directions, with things open and with nothing open", () => {
		const tried = fx.switches.map(
			(s) =>
				`${s.before.mode} → ${String((s.request.action as { payload: { action: { abstraction?: string; type: string } } }).payload.action.abstraction ?? "userDexAbstraction")}: ${s.answer.status}`,
		);
		expect(tried).toContain("default → unifiedAccount: ok");
		expect(tried).toContain("unifiedAccount → unifiedAccount: ok");
		expect(tried).toContain("unifiedAccount → disabled: ok");
		expect(tried).toContain("disabled → unifiedAccount: ok");
		// to unified went through with a position and orders open
		const busy = fx.switches[0];
		expect(busy?.before.perps.positions.length).toBeGreaterThan(0);
		expect(busy?.before.openOrders).toBeGreaterThan(0);
		expect(busy?.after.mode).toBe("unifiedAccount");
		// back is refused while they are, by either action
		const refusals = fx.switches.filter(
			(s) => s.answer.status === "err" && s.answer.response !== REFUSED,
		);
		expect(refusals).toHaveLength(2);
		for (const r of refusals) {
			expect(explainExchangeError(r.answer, 200).id).toBe("unified-busy");
			expect(r.after.mode).toBe("unifiedAccount");
		}
	});
});

describe("hashedEnvelopeAction", () => {
	const SIG = { r: "0x1" as const, s: "0x2" as const, v: 27 as const };
	const request = (action: PlainObject): EnvelopeRequest => ({
		action: {
			type: "multiSig",
			signatureChainId: "0x66eee",
			signatures: [SIG],
			payload: { multiSigUser: TREASURY, outerSigner: A, action },
		},
		nonce: NONCE,
		vaultAddress: null,
		expiresAfter: null,
	});
	const setMode = (abstraction: string | number): PlainObject => ({
		type: "userSetAbstraction",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		user: TREASURY,
		abstraction,
		nonce: NONCE,
	});
	const hashedInner = (action: PlainObject) =>
		(hashedEnvelopeAction(request(action)).payload as { action: object })
			.action;

	it("writes the mode as its letter and leaves the field where it was", () => {
		expect(hashedInner(setMode("unifiedAccount"))).toEqual(setMode("u"));
		expect(hashedInner(setMode("disabled"))).toEqual(setMode("i"));
		expect(Object.keys(hashedInner(setMode("unifiedAccount")))).toEqual(
			Object.keys(setMode("unifiedAccount")),
		);
		// the rest of the envelope is the canonical one
		const req = request(setMode("unifiedAccount"));
		expect({
			...hashedEnvelopeAction(req),
			payload: null,
		}).toEqual({ ...canonicalEnvelopeAction(req), payload: null });
	});

	it("leaves everything else as it is sent", () => {
		for (const action of [
			// a mode with no measured letter
			setMode("portfolioMargin"),
			setMode("u"),
			setMode(7),
			{ ...setMode("unifiedAccount"), type: "userDexAbstraction" },
			{ type: "usdSend", destination: A, amount: "1", time: NONCE },
		]) {
			const req = request(action);
			expect(hashedEnvelopeAction(req)).toEqual(canonicalEnvelopeAction(req));
		}
		// and so their hash is the one of the envelope as sent
		const plain = request({ type: "noop" });
		expect(envelopeDigest(plain, "testnet").digest).toMatch(/^0x[0-9a-f]{64}$/);
		expect(
			envelopeDigest(request(setMode("unifiedAccount")), "testnet").actionHash,
		).not.toBe(
			envelopeDigest(request(setMode("portfolioMargin")), "testnet").actionHash,
		);
	});

	it("signs what Hyperliquid will check: the leader's signature is over the letter, the body carries the name", async () => {
		const req = request(setMode("unifiedAccount"));
		const signed = await signEnvelope(req, "testnet", viemSigner(LEADER));
		expect(signed.signature).not.toBeNull();
		const over = (r: EnvelopeRequest) =>
			recoverInnerSigner(
				envelopeDigest(r, "testnet").digest as `0x${string}`,
				signed.signature as never,
			);
		expect(await over(req)).toBe(A);
		// the same signature does not stand for an envelope hashed with the name
		expect(await over(request(setMode("portfolioMargin")))).not.toBe(A);
	});

	it("agrees with the SDK over the letter, and differs from it over the envelope as posted", async () => {
		const req = request(setMode("disabled"));
		const ours = await signEnvelope(req, "testnet", viemSigner(LEADER));
		const sdk = (action: object) =>
			signMultiSigAction({
				wallet: LEADER,
				action: action as never,
				nonce: NONCE,
				isTestnet: true,
			});
		expect(trimSig(ours.signature as never)).toEqual(
			trimSig((await sdk(hashedEnvelopeAction(req))) as never),
		);
		// the SDK, handed the envelope as documented, signs what Hyperliquid refuses
		expect(trimSig(ours.signature as never)).not.toEqual(
			trimSig((await sdk(canonicalEnvelopeAction(req))) as never),
		);
	});

	it("says a switch in words, and any other mode as it is named", () => {
		const unified = describeAction(setMode("unifiedAccount"));
		expect(unified.headline).toBe("Switch to a unified account: one balance");
		expect(unified.lines[0]).toContain("become one balance");
		const manual = describeAction(setMode("disabled"));
		expect(manual.headline).toBe(
			"Switch to a manual account: separate perps and spot balances",
		);
		expect(manual.lines[0]).toContain("open position");
		expect(describeAction(setMode("portfolioMargin")).headline).toBe(
			`Set abstraction mode "portfolioMargin" for ${TREASURY}`,
		);
	});
});
