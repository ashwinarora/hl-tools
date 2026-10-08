import { describe, expect, it } from "vitest";
import {
	classifySignatures,
	isHighS,
	isZeroAddress,
	normaliseAddress,
	normaliseSig,
	padSig,
	recoverInnerSigner,
	SECP256K1_HALF_N,
	SECP256K1_N,
	trimSig,
	ZERO_ADDRESS,
} from "../../src/multisig/index.ts";
import { parseSignature } from "../../src/signing.ts";
import {
	A,
	B,
	C,
	codes,
	digestOf,
	NONCE,
	OUTSIDER,
	POLICY,
	payload,
	proposalOf,
	signatureBy,
	signDigest,
	TREASURY,
	userPayload,
} from "./_helpers.ts";

describe("normaliseSig", () => {
	it("sig.object-27/28 and sig.v-0/1-normalised", async () => {
		const s = await signDigest(digestOf(payload()), 1);
		expect(normaliseSig(s).sig).toEqual(s);
		expect(normaliseSig({ ...s, v: s.v - 27 }).sig?.v).toBe(s.v);
		expect(normaliseSig({ ...s, v: String(s.v) }).sig?.v).toBe(s.v);
	});
	it("sig.v-invalid", () => {
		const r = normaliseSig({ r: "0x1", s: "0x1", v: 29 });
		expect(r.sig).toBeNull();
		expect(codes(r.issues)).toEqual(["signature.invalid"]);
	});
	it("sig.65-byte-hex and sig.compact-64-byte (EIP-2098) parse to the same signature", async () => {
		const s = await signDigest(digestOf(payload()), 2);
		const full = `0x${s.r.slice(2)}${s.s.slice(2)}${s.v.toString(16)}`;
		expect(normaliseSig(full).sig).toEqual(s);
		const yParityAndS = (BigInt(s.v - 27) << 255n) | BigInt(s.s);
		const compact = `0x${s.r.slice(2)}${yParityAndS.toString(16).padStart(64, "0")}`;
		expect(normaliseSig(compact).sig).toEqual(s);
		expect(() => parseSignature(`0x${"ab".repeat(63)}`)).toThrow(/65 bytes/);
	});
	it("sig.short-r-padded-for-recovery and sig.odd-length-trimmed-s", () => {
		const r = normaliseSig({ r: "0xabc", s: "0x0f", v: 27 }).sig;
		expect(r?.r).toBe(`0x${"abc".padStart(64, "0")}`);
		expect(r?.s).toBe(`0x${"f".padStart(64, "0")}`);
	});
	it("sig.uppercase-hex-lowercased", () => {
		expect(normaliseSig({ r: "0xABC", s: "0xDEF", v: 28 }).sig).toEqual({
			r: `0x${"abc".padStart(64, "0")}`,
			s: `0x${"def".padStart(64, "0")}`,
			v: 28,
		});
	});
	it("sig.r-or-s-too-long / non-hex / missing", () => {
		expect(
			codes(normaliseSig({ r: `0x${"1".repeat(65)}`, s: "0x1", v: 27 }).issues),
		).toEqual(["signature.invalid"]);
		expect(codes(normaliseSig({ r: "0xzz", s: "0x1", v: 27 }).issues)).toEqual([
			"signature.invalid",
		]);
		expect(codes(normaliseSig({ r: "0x1", v: 27 }).issues)).toEqual([
			"signature.invalid",
		]);
		expect(codes(normaliseSig(42).issues)).toEqual(["signature.invalid"]);
	});
	it("sig.r-zero/s-zero → signature.zero", () => {
		expect(codes(normaliseSig({ r: "0x0", s: "0x1", v: 27 }).issues)).toEqual([
			"signature.zero",
		]);
		expect(codes(normaliseSig({ r: "0x1", s: "0x00", v: 27 }).issues)).toEqual([
			"signature.zero",
		]);
	});
	it("sig.high-s-accepted with an info issue", () => {
		const high = `0x${(SECP256K1_HALF_N + 1n).toString(16)}`;
		const r = normaliseSig({ r: "0x1", s: high, v: 27 });
		expect(r.sig).not.toBeNull();
		expect(codes(r.issues)).toEqual(["signature.high_s"]);
		expect(isHighS(r.sig as never)).toBe(true);
		expect(
			isHighS({ r: "0x1", s: `0x${SECP256K1_HALF_N.toString(16)}`, v: 27 }),
		).toBe(false);
		expect(SECP256K1_N).toBe(
			0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,
		);
	});
});

describe("address helpers", () => {
	it("isZeroAddress and normaliseAddress", () => {
		expect(isZeroAddress(ZERO_ADDRESS)).toBe(true);
		expect(isZeroAddress(ZERO_ADDRESS.toUpperCase().replace("0X", "0x"))).toBe(
			true,
		);
		expect(isZeroAddress(A)).toBe(false);
		expect(normaliseAddress(A.toUpperCase().replace("0X", "0x"), "x")).toEqual({
			address: A,
			issues: [
				expect.objectContaining({
					code: "address.uppercase",
					severity: "warning",
					path: "x",
				}),
			],
		});
		expect(normaliseAddress(A, "x").issues).toEqual([]);
		expect(normaliseAddress("0x12", "x").address).toBeNull();
		expect(normaliseAddress(12, "x").issues[0]?.code).toBe("address.invalid");
	});
});

describe("trimSig / padSig", () => {
	it("sig.trim-idempotent and sig.pad-trim-roundtrip", () => {
		const s = {
			r: `0x${"00ab".padEnd(64, "0")}`,
			s: `0x${"0000000f".padEnd(64, "0")}`,
			v: 27,
		} as const;
		const t = trimSig(s);
		expect(t.r).toBe(`0x${"ab".padEnd(62, "0")}`);
		expect(t.s).toBe(`0x${"f".padEnd(57, "0")}`);
		expect(trimSig(t)).toEqual(t);
		expect(padSig(t)).toEqual(s);
		expect(padSig(padSig(t))).toEqual(s);
	});
	it("sig.trim-all-zero → 0x0, uppercase lowercased", () => {
		expect(trimSig({ r: `0x${"0".repeat(64)}`, s: "0xAB", v: 28 })).toEqual({
			r: "0x0",
			s: "0xab",
			v: 28,
		});
	});
});

describe("recoverInnerSigner", () => {
	it("recovers the signer of a real signature and returns null for garbage", async () => {
		const d = digestOf(payload());
		expect(await recoverInnerSigner(d, await signDigest(d, 1))).toBe(A);
		expect(await recoverInnerSigner(d, await signDigest(d, 2))).toBe(B);
		expect(
			await recoverInnerSigner(d, { r: "0x0", s: "0x0", v: 27 }),
		).toBeNull();
		expect(
			await recoverInnerSigner(d, {
				r: `0x${SECP256K1_N.toString(16)}`,
				s: "0x1",
				v: 27,
			}),
		).toBeNull();
	});
	it("sig.garbage-recovers-random-address: a signature over other bytes recovers to some other address", async () => {
		const other = await signDigest(digestOf(payload({ nonce: NONCE + 1 })), 1);
		const recovered = await recoverInnerSigner(digestOf(payload()), other);
		expect(recovered).toMatch(/^0x[0-9a-f]{40}$/);
		expect(recovered).not.toBe(A);
	});
});

describe("classifySignatures", () => {
	const p = payload();
	it("cls.valid-authorized: two authorized signers count", async () => {
		const r = await classifySignatures(
			proposalOf(p, [await signatureBy(p, 1), await signatureBy(p, 2)]),
			POLICY,
		);
		expect(r.map((c) => c.status)).toEqual([
			"valid-authorized",
			"valid-authorized",
		]);
		expect(r.map((c) => c.recovered)).toEqual([A, B]);
		expect(r.every((c) => c.issues.length === 0)).toBe(true);
	});
	it("cls.valid-unauthorized: an outsider's correct signature does not count", async () => {
		const r = await classifySignatures(
			proposalOf(p, [await signatureBy(p, 4)]),
			POLICY,
		);
		expect(r[0]?.status).toBe("valid-unauthorized");
		expect(codes(r[0]?.issues ?? [])).toEqual(["signature.unauthorized"]);
		expect(r[0]?.issues[0]?.message).toContain(OUTSIDER);
	});
	it("cls.multisig-user-own-key: the treasury's own key is unauthorized even without a policy", async () => {
		const r = await classifySignatures(
			proposalOf(p, [await signatureBy(p, 0)]),
			null,
		);
		expect(r[0]?.status).toBe("valid-unauthorized");
		expect(codes(r[0]?.issues ?? [])).toEqual(["signature.multisig_user_key"]);
		expect(r[0]?.recovered).toBe(TREASURY);
	});
	it("cls.policy-null → valid-unknown", async () => {
		const r = await classifySignatures(
			proposalOf(p, [await signatureBy(p, 1)]),
			null,
		);
		expect(r[0]?.status).toBe("valid-unknown");
	});
	it("cls.duplicate-same-sig and cls.two-different-valid-sigs-same-signer: first counts, later ones are duplicates", async () => {
		const sA = await signatureBy(p, 1);
		const r = await classifySignatures(
			proposalOf(p, [sA, { ...sA, at: null }, await signatureBy(p, 2), sA]),
			POLICY,
		);
		expect(r.map((c) => c.status)).toEqual([
			"valid-authorized",
			"duplicate",
			"valid-authorized",
			"duplicate",
		]);
		expect(codes(r[1]?.issues ?? [])).toEqual(["signature.duplicate"]);
	});
	it("cls.signer-field-mismatch: a claimed signer that does not match recovery is invalid", async () => {
		const sA = await signatureBy(p, 1);
		const r = await classifySignatures(
			proposalOf(p, [{ ...sA, signer: B }]),
			POLICY,
		);
		expect(r[0]?.status).toBe("invalid");
		expect(r[0]?.recovered).toBe(A);
		expect(codes(r[0]?.issues ?? [])).toEqual(["signature.signer_mismatch"]);
	});
	it("cls.signed-other-bytes: a signature over a different nonce is invalid (recovers elsewhere)", async () => {
		const wrong = await signatureBy(payload({ nonce: NONCE - 1 }), 2);
		const r = await classifySignatures(proposalOf(p, [wrong]), POLICY);
		expect(r[0]?.status).toBe("invalid");
		expect(r[0]?.recovered).not.toBe(B);
		expect(codes(r[0]?.issues ?? [])).toEqual(["signature.signer_mismatch"]);
	});
	it("cls.unparseable and cls.unrecoverable", async () => {
		const r = await classifySignatures(
			proposalOf(p, [
				{ signer: A, r: "0xzz" as never, s: "0x1", v: 27, at: null },
				{
					signer: A,
					r: `0x${SECP256K1_N.toString(16)}` as never,
					s: "0x1",
					v: 27,
					at: null,
				},
			]),
			POLICY,
		);
		expect(r[0]?.status).toBe("invalid");
		expect(codes(r[0]?.issues ?? [])).toEqual(["signature.invalid"]);
		expect(r[1]?.status).toBe("invalid");
		expect(codes(r[1]?.issues ?? [])).toEqual(["signature.unrecoverable"]);
	});
	it("cls.high-s-flagged-but-counted", async () => {
		const sA = await signatureBy(p, 1);
		const flipped = {
			...sA,
			s: `0x${(SECP256K1_N - BigInt(sA.s)).toString(16).padStart(64, "0")}` as `0x${string}`,
			v: (sA.v === 27 ? 28 : 27) as 27 | 28,
		};
		const r = await classifySignatures(proposalOf(p, [flipped]), POLICY);
		expect(r[0]?.status).toBe("valid-authorized");
		expect(codes(r[0]?.issues ?? [])).toEqual(["signature.high_s"]);
	});
	it("cls.undigestable: a payload that cannot be hashed makes every signature invalid", async () => {
		const bad = {
			...proposalOf(p, [await signatureBy(p, 1)]),
			payload: payload({ nonce: -1 }),
		};
		const r = await classifySignatures(bad, POLICY);
		expect(r[0]?.status).toBe("invalid");
		expect(codes(r[0]?.issues ?? [])).toEqual([
			"signature.undigestable",
			"digest.failed",
		]);
	});
	it("cls.user-signed-inner: classification works for the EIP-712 scheme too", async () => {
		const up = userPayload();
		const r = await classifySignatures(
			proposalOf(up, [await signatureBy(up, 3)]),
			POLICY,
		);
		expect(r[0]?.status).toBe("valid-authorized");
		expect(r[0]?.recovered).toBe(C);
	});
	it("cls.index-and-signature-echoed", async () => {
		const sA = await signatureBy(p, 1);
		const r = await classifySignatures(proposalOf(p, [sA]), POLICY);
		expect(r[0]?.index).toBe(0);
		expect(r[0]?.signature).toBe(sA);
	});
});
