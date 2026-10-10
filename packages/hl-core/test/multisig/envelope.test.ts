import { describe, expect, it } from "vitest";
import {
	buildEnvelope,
	canonicalEnvelopeAction,
	classifySignatures,
	createProposal,
	envelopeDigest,
	envelopeNetworkHint,
	exchangeRequestBody,
	type Proposal,
	parseEnvelope,
	recoverInnerSigner,
	SECP256K1_N,
	signEnvelope,
	signProposal,
	trimSig,
	viemSigner,
} from "../../src/multisig/index.ts";
import {
	A,
	ACCOUNTS,
	B,
	codes,
	NONCE,
	NOW,
	ORDER,
	POLICY,
	payload,
	proposalOf,
	signatureBy,
	TREASURY,
	usdSend,
	userPayload,
	VAULT,
} from "./_helpers.ts";

const acct = (i: number) =>
	viemSigner(ACCOUNTS[i] as NonNullable<(typeof ACCOUNTS)[number]>);
const make = (over: Record<string, unknown> = {}) =>
	createProposal(
		{
			network: "testnet",
			multiSigUser: TREASURY,
			outerSigner: A,
			action: ORDER,
			nonce: NONCE,
			...over,
		},
		{ now: NOW },
	).proposal as Proposal;

describe("buildEnvelope", () => {
	it("envelope.shape-and-key-order, trimmed signatures, default chain id", async () => {
		const p = make();
		const withSigs = {
			...p,
			signatures: [
				await signatureBy(p.payload, 1),
				await signatureBy(p.payload, 2),
			],
		};
		const { request, issues } = buildEnvelope(withSigs);
		expect(issues).toEqual([]);
		expect(Object.keys(request.action)).toEqual([
			"type",
			"signatureChainId",
			"signatures",
			"payload",
		]);
		expect(Object.keys(request.action.payload)).toEqual([
			"multiSigUser",
			"outerSigner",
			"action",
		]);
		expect(request.action.signatureChainId).toBe("0x66eee");
		expect(request.action.signatures).toEqual(
			withSigs.signatures.map((s) => trimSig({ r: s.r, s: s.s, v: s.v })),
		);
		expect(request.nonce).toBe(NONCE);
		expect(request.vaultAddress).toBeNull();
		expect(request.expiresAfter).toBeNull();
		expect(
			buildEnvelope(make({ network: "mainnet" })).request.action
				.signatureChainId,
		).toBe("0xa4b1");
		expect(
			buildEnvelope(p, { signatureChainId: "0xA4B1" }).request.action
				.signatureChainId,
		).toBe("0xa4b1");
	});
	it("envelope.classified-filter drops what would not count", async () => {
		const p = make();
		const sA = await signatureBy(p.payload, 1);
		const withSigs = {
			...p,
			signatures: [
				sA,
				sA,
				await signatureBy(p.payload, 4),
				await signatureBy(p.payload, 2),
			],
		};
		const classified = await classifySignatures(withSigs, POLICY);
		const { request, issues } = buildEnvelope(withSigs, { classified });
		expect(request.action.signatures.length).toBe(2);
		expect(codes(issues)).toEqual(["envelope.signatures_dropped"]);
		expect(issues[0]?.message).toContain("2 signature(s)");
	});
	it("envelope.no-signatures warning", () => {
		const { issues } = buildEnvelope(make());
		expect(codes(issues)).toEqual(["envelope.no_signatures"]);
	});
	it("envelope.vault-and-expiry carried", () => {
		const p = make({ vaultAddress: VAULT, expiresAfter: NOW + 1000 });
		const { request } = buildEnvelope(p);
		expect(request.vaultAddress).toBe(VAULT);
		expect(request.expiresAfter).toBe(NOW + 1000);
	});
});

describe("exchangeRequestBody", () => {
	it("omits expiresAfter when null, keeps vaultAddress null", async () => {
		const p = make();
		const sig = await signatureBy(p.payload, 1);
		const body = exchangeRequestBody(buildEnvelope(p).request, sig);
		expect(Object.keys(body)).toEqual([
			"action",
			"nonce",
			"signature",
			"vaultAddress",
		]);
		expect(body.vaultAddress).toBeNull();
		const body2 = exchangeRequestBody(
			buildEnvelope(make({ expiresAfter: NOW + 1 })).request,
			sig,
		);
		expect(body2.expiresAfter).toBe(NOW + 1);
	});
});

describe("signProposal", () => {
	it("signs with a viem account and recovers the signer", async () => {
		const p = make();
		const r = await signProposal(p, acct(2), { at: NOW });
		expect(r.issues).toEqual([]);
		expect(r.signature?.signer).toBe(B);
		expect(r.signature?.at).toBe(NOW);
		expect(r.signature).toEqual(await signatureBy(p.payload, 2));
		const r2 = await signProposal(p, acct(2));
		expect(typeof r2.signature?.at).toBe("number");
	});
	it("expectedSigner must match; invalid expectedSigner is reported", async () => {
		const p = make();
		expect(
			(
				await signProposal(p, acct(2), {
					expectedSigner: B.toUpperCase().replace("0X", "0x"),
				})
			).signature?.signer,
		).toBe(B);
		const bad = await signProposal(p, acct(2), { expectedSigner: A });
		expect(bad.signature).toBeNull();
		expect(codes(bad.issues)).toEqual(["signature.signer_mismatch"]);
		const invalid = await signProposal(p, acct(2), { expectedSigner: "nope" });
		expect(codes(invalid.issues)).toEqual(["address.invalid"]);
		expect(invalid.signature?.signer).toBe(B);
	});
	it("signer that throws, returns garbage, or returns an {r,s,v} object", async () => {
		const p = make();
		const thrown = await signProposal(p, {
			signTypedData: async () => {
				throw new Error("user rejected");
			},
		});
		expect(codes(thrown.issues)).toEqual(["signer.failed"]);
		expect(thrown.issues[0]?.message).toContain("user rejected");
		const garbage = await signProposal(p, {
			signTypedData: async () => "0x1234",
		});
		expect(codes(garbage.issues)).toEqual(["signature.invalid"]);
		const objectForm = await signProposal(p, {
			signTypedData: async (td) => {
				const h = await (
					ACCOUNTS[3] as NonNullable<(typeof ACCOUNTS)[number]>
				).signTypedData(td as never);
				return {
					r: `0x${h.slice(2, 66)}` as `0x${string}`,
					s: `0x${h.slice(66, 130)}` as `0x${string}`,
					v: Number.parseInt(h.slice(130), 16) as 27 | 28,
				};
			},
		});
		expect(objectForm.signature?.signer).toBe(
			(
				ACCOUNTS[3] as NonNullable<(typeof ACCOUNTS)[number]>
			).address.toLowerCase(),
		);
	});
	it("undigestable payload yields the digest issues", async () => {
		const p = proposalOf(payload());
		const bad = { ...p, payload: { ...p.payload, nonce: -1 } };
		const r = await signProposal(bad, acct(1));
		expect(codes(r.issues)).toEqual(["digest.failed"]);
	});
	it("user-signed proposal signs the enriched struct", async () => {
		const p = make({ action: usdSend() });
		const r = await signProposal(p, acct(3));
		expect(r.signature?.signer).toBe(
			(
				ACCOUNTS[3] as NonNullable<(typeof ACCOUNTS)[number]>
			).address.toLowerCase(),
		);
		expect(r.signature).toMatchObject(
			await signatureBy(userPayload(), 3, r.signature?.at ?? null),
		);
	});
});

describe("signEnvelope", () => {
	it("the leader signs; the signature recovers to the leader", async () => {
		const p = make();
		const req = buildEnvelope({
			...p,
			signatures: [await signatureBy(p.payload, 1)],
		}).request;
		const r = await signEnvelope(req, "testnet", acct(1));
		expect(r.issues).toEqual([]);
		expect(r.recovered).toBe(A);
		expect(r.digest).toBe(envelopeDigest(req, "testnet").digest);
		expect(
			await recoverInnerSigner(r.digest as `0x${string}`, r.signature as never),
		).toBe(A);
	});
	it("a non-leader signing the envelope is rejected", async () => {
		const req = buildEnvelope(make()).request;
		const r = await signEnvelope(req, "testnet", acct(2));
		expect(r.signature).toBeNull();
		expect(r.recovered).toBe(B);
		expect(codes(r.issues)).toEqual(["envelope.signer_mismatch"]);
	});
	it("a parseable but unrecoverable envelope signature is reported as recovering to nothing", async () => {
		const req = buildEnvelope(make()).request;
		const r = await signEnvelope(req, "testnet", {
			signTypedData: async () => ({
				r: `0x${SECP256K1_N.toString(16)}` as `0x${string}`,
				s: "0x1" as `0x${string}`,
				v: 27,
			}),
		});
		expect(r.signature).toBeNull();
		expect(r.recovered).toBeNull();
		expect(r.issues[0]?.message).toContain("recovers to nothing");
	});
	it("signer failure and undigestable request", async () => {
		const req = buildEnvelope(make()).request;
		const thrown = await signEnvelope(req, "testnet", {
			signTypedData: async () => {
				throw new Error("no");
			},
		});
		expect(codes(thrown.issues)).toEqual(["signer.failed"]);
		expect(thrown.digest).toMatch(/^0x/);
		const bad = await signEnvelope({ ...req, nonce: -1 }, "testnet", acct(1));
		expect(codes(bad.issues)).toEqual(["digest.failed"]);
		expect(bad.digest).toBeNull();
	});
});

describe("parseEnvelope", () => {
	async function fullBody(over: Record<string, unknown> = {}) {
		const p = make(over);
		const withSigs = {
			...p,
			signatures: [
				await signatureBy(p.payload, 1),
				await signatureBy(p.payload, 2),
			],
		};
		const req = buildEnvelope(withSigs).request;
		const outer = await signEnvelope(req, "testnet", acct(1));
		return {
			req,
			body: JSON.parse(
				JSON.stringify(exchangeRequestBody(req, outer.signature as never)),
			) as Record<string, unknown>,
			outer,
		};
	}
	it("round trip: build → sign → body → parse reproduces the request and the outer signature", async () => {
		const { req, body, outer } = await fullBody({
			vaultAddress: VAULT,
			expiresAfter: NOW + 100,
		});
		const parsed = parseEnvelope(body);
		expect(parsed.issues).toEqual([]);
		expect(parsed.request).toEqual(req);
		expect(parsed.outerSignature).toEqual(outer.signature);
		expect(envelopeDigest(parsed.request as never, "testnet").digest).toBe(
			outer.digest,
		);
	});
	it("key order warnings for envelope and payload; untrimmed inner signatures warned and normalised", async () => {
		const { req, body } = await fullBody();
		const action = body.action as Record<string, unknown>;
		const reordered = {
			...body,
			action: {
				payload: action.payload,
				type: "multiSig",
				signatures: action.signatures,
				signatureChainId: action.signatureChainId,
			},
		};
		const r = parseEnvelope(reordered);
		expect(codes(r.issues)).toEqual(["envelope.key_order"]);
		expect(r.request).toEqual(req);
		const pl = action.payload as Record<string, unknown>;
		const reorderedPayload = {
			...body,
			action: {
				...action,
				payload: {
					action: pl.action,
					multiSigUser: pl.multiSigUser,
					outerSigner: pl.outerSigner,
				},
			},
		};
		expect(codes(parseEnvelope(reorderedPayload).issues)).toEqual([
			"envelope.key_order",
		]);
		// Real signatures rarely start with a zero byte, so craft the untrimmed form explicitly.
		const untrimmed = [
			{ r: `0x${"00".padEnd(64, "a")}`, s: `0x${"0".padEnd(64, "b")}`, v: 27 },
			{ r: `0x${"c".repeat(64)}`, s: `0x${"000".padEnd(64, "d")}`, v: 28 },
		];
		const r2 = parseEnvelope({
			...body,
			action: { ...action, signatures: untrimmed },
		});
		expect(codes(r2.issues)).toEqual([
			"envelope.untrimmed",
			"envelope.untrimmed",
		]);
		expect(r2.request?.action.signatures).toEqual([
			{ r: `0x${"a".repeat(62)}`, s: `0x${"b".repeat(63)}`, v: 27 },
			{ r: `0x${"c".repeat(64)}`, s: `0x${"d".repeat(61)}`, v: 28 },
		]);
	});
	it("error cases", async () => {
		const { body } = await fullBody();
		const action = body.action as Record<string, unknown>;
		const e = (b: unknown) => codes(parseEnvelope(b).issues);
		expect(e(null)).toEqual(["envelope.shape"]);
		expect(e({ action: { type: "order" } })).toEqual(["envelope.not_multisig"]);
		expect(e({ action: [] })).toEqual(["envelope.not_multisig"]);
		expect(e({ action: 5 })).toEqual(["envelope.not_multisig"]);
		expect(e({ ...body, action: { ...action, signatureChainId: 1 } })).toEqual([
			"envelope.shape",
		]);
		expect(e({ ...body, action: { ...action, payload: null } })).toEqual([
			"envelope.shape",
		]);
		expect(
			e({
				...body,
				action: {
					...action,
					payload: { ...(action.payload as object), action: "x" },
				},
			}),
		).toEqual(["envelope.shape"]);
		expect(
			e({
				...body,
				action: {
					...action,
					payload: { ...(action.payload as object), multiSigUser: "x" },
				},
			}),
		).toEqual(["address.invalid"]);
		expect(e({ ...body, action: { ...action, signatures: "x" } })).toEqual([
			"envelope.shape",
		]);
		expect(
			e({
				...body,
				action: { ...action, signatures: [{ r: "0x1", s: "0x1", v: 5 }] },
			}),
		).toEqual(["signature.invalid"]);
		expect(e({ ...body, nonce: "1" })).toEqual(["envelope.shape"]);
		expect(e({ ...body, vaultAddress: "x" })).toEqual(["address.invalid"]);
		expect(e({ ...body, expiresAfter: "x" })).toEqual(["envelope.shape"]);
		expect(e({ ...body, signature: { r: "0xzz", s: "0x1", v: 27 } })).toEqual([
			"signature.invalid",
		]);
	});
	it("optional fields: no outer signature, no vault, no expiry; mixed-case addresses normalised", async () => {
		const { req, body } = await fullBody();
		const action = body.action as Record<string, unknown>;
		const pl = action.payload as Record<string, unknown>;
		const { signature: _s, ...noSig } = body;
		const r = parseEnvelope({
			...noSig,
			action: {
				...action,
				payload: {
					...pl,
					multiSigUser: (pl.multiSigUser as string)
						.toUpperCase()
						.replace("0X", "0x"),
				},
			},
			vaultAddress: undefined,
			expiresAfter: null,
		});
		expect(r.outerSignature).toBeNull();
		expect(r.request?.action.payload.multiSigUser).toBe(
			req.action.payload.multiSigUser,
		);
		expect(codes(r.issues)).toEqual(["address.uppercase"]);
	});
	it("envelopeNetworkHint", () => {
		expect(
			envelopeNetworkHint(buildEnvelope(make({ action: usdSend() })).request),
		).toBe("testnet");
		expect(
			envelopeNetworkHint(
				buildEnvelope(
					make({ network: "mainnet", action: usdSend(NONCE, "mainnet") }),
				).request,
			),
		).toBe("mainnet");
		expect(envelopeNetworkHint(buildEnvelope(make()).request)).toBeNull();
	});
	it("canonicalEnvelopeAction of a parsed body equals the built one", async () => {
		const { req, body } = await fullBody();
		expect(
			canonicalEnvelopeAction(parseEnvelope(body).request as never),
		).toEqual(canonicalEnvelopeAction(req));
	});
});
