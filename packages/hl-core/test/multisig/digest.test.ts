import {
	createL1ActionHash,
	signL1Action,
	signMultiSigAction,
	signUserSignedAction,
} from "@nktkas/hyperliquid/signing";
import { describe, expect, it } from "vitest";
import {
	canonicalEnvelopeAction,
	type EnvelopeRequest,
	envelopeDigest,
	innerDigest,
	normaliseSig,
	padSig,
	trimSig,
} from "../../src/multisig/index.ts";
import {
	A,
	ACCOUNTS,
	B,
	codes,
	NONCE,
	ORDER,
	payload,
	signDigest,
	TREASURY,
	usdSend,
	userPayload,
	VAULT,
} from "./_helpers.ts";

const nk = (i: number) => ACCOUNTS[i] as NonNullable<(typeof ACCOUNTS)[number]>;

describe("inner L1 digest", () => {
	it("l1.array-envelope-msgpack: hashes [multiSigUser, outerSigner, action] exactly as the TS SDK", () => {
		const r = innerDigest(payload());
		expect(r.kind).toBe("l1");
		expect(r.l1?.connectionId).toBe(
			createL1ActionHash({ action: [TREASURY, A, ORDER], nonce: NONCE }),
		);
		expect(r.l1?.actionSpans.map((s) => s.path).slice(0, 4)).toEqual([
			"",
			"[0]",
			"[1]",
			"[2]",
		]);
	});

	it("l1.no-vault-0x00: the preimage carries a 0x00 vault marker and no expiry", () => {
		const r = innerDigest(payload());
		expect(r.l1?.segments.map((s) => s.label)).toEqual([
			"action",
			"nonce",
			"vault marker",
		]);
		const marker = r.l1?.segments[2];
		expect(r.l1?.preimage[marker?.start ?? 0]).toBe(0);
	});

	it("l1.vault-marker-0x01: a vault address is appended after a 0x01 marker", () => {
		const r = innerDigest(payload({ vaultAddress: VAULT }));
		expect(r.l1?.segments.map((s) => s.label)).toEqual([
			"action",
			"nonce",
			"vault marker",
			"vaultAddress",
		]);
		expect(r.l1?.connectionId).toBe(
			createL1ActionHash({
				action: [TREASURY, A, ORDER],
				nonce: NONCE,
				vaultAddress: VAULT,
			}),
		);
	});

	it("l1.expiresAfter-appended: expiry is hashed after a 0x00 marker", () => {
		const r = innerDigest(payload({ expiresAfter: NONCE + 60_000 }));
		expect(r.l1?.segments.map((s) => s.label)).toEqual([
			"action",
			"nonce",
			"vault marker",
			"expires marker",
			"expiresAfter",
		]);
		expect(r.l1?.connectionId).toBe(
			createL1ActionHash({
				action: [TREASURY, A, ORDER],
				nonce: NONCE,
				expiresAfter: NONCE + 60_000,
			}),
		);
	});

	it("l1.vault-and-expires: both are part of the preimage, in that order", () => {
		const r = innerDigest(
			payload({ vaultAddress: VAULT, expiresAfter: NONCE + 1 }),
		);
		expect(r.l1?.segments.map((s) => s.label)).toEqual([
			"action",
			"nonce",
			"vault marker",
			"vaultAddress",
			"expires marker",
			"expiresAfter",
		]);
		expect(r.l1?.connectionId).toBe(
			createL1ActionHash({
				action: [TREASURY, A, ORDER],
				nonce: NONCE,
				vaultAddress: VAULT,
				expiresAfter: NONCE + 1,
			}),
		);
	});

	it("l1.nonce-u64-boundaries: 0 and 2^53-1 hash; a negative nonce cannot be hashed", () => {
		expect(innerDigest(payload({ nonce: 0 })).digest).toMatch(
			/^0x[0-9a-f]{64}$/,
		);
		expect(
			innerDigest(payload({ nonce: Number.MAX_SAFE_INTEGER })).digest,
		).toMatch(/^0x[0-9a-f]{64}$/);
		const bad = innerDigest(payload({ nonce: -1 }));
		expect(bad.digest).toBeNull();
		expect(codes(bad.issues)).toEqual(["digest.failed"]);
	});

	it("l1.network-source-byte: the same payload hashes differently on mainnet and testnet", () => {
		const t = innerDigest(payload({ network: "testnet" }));
		const m = innerDigest(payload({ network: "mainnet" }));
		expect(t.l1?.connectionId).toBe(m.l1?.connectionId);
		expect(t.typedData?.message.source).toBe("b");
		expect(m.typedData?.message.source).toBe("a");
		expect(t.digest).not.toBe(m.digest);
	});

	it("l1.leader-and-user-in-hash: changing the leader or the treasury changes the digest", () => {
		const base = innerDigest(payload()).digest;
		expect(innerDigest(payload({ outerSigner: B })).digest).not.toBe(base);
		expect(innerDigest(payload({ multiSigUser: A })).digest).not.toBe(base);
	});

	it("l1.matches-sdk-signature: signing our digest yields the SDK's signL1Action signature byte for byte", async () => {
		const p = payload({ vaultAddress: VAULT, expiresAfter: NONCE + 5 });
		const ours = await signDigest(innerDigest(p).digest as `0x${string}`, 1);
		const theirs = await signL1Action({
			wallet: nk(1),
			action: [TREASURY, A, ORDER],
			nonce: NONCE,
			isTestnet: true,
			vaultAddress: VAULT,
			expiresAfter: NONCE + 5,
		});
		expect(trimSig(ours)).toEqual(trimSig(normaliseSig(theirs).sig as never));
	});

	it("l1.unknown-type-hashed-verbatim: an unknown action type is hashed as written", () => {
		const action = {
			type: "spotDeploy",
			registerToken2: { spec: { name: "X" } },
		};
		const r = innerDigest(payload({ action }));
		expect(r.l1?.connectionId).toBe(
			createL1ActionHash({ action: [TREASURY, A, action], nonce: NONCE }),
		);
	});

	it("l1.bigint-field: integers above 2^53 (within uint64) are hashed exactly", () => {
		const action = { type: "x", wei: (1n << 60n) + 7n };
		const r = innerDigest(payload({ action }));
		expect(r.l1?.connectionId).toBe(
			createL1ActionHash({ action: [TREASURY, A, action], nonce: NONCE }),
		);
	});

	it("l1.bigint-beyond-uint64: integers above 2^64-1 cannot be msgpack-encoded and fail loudly", () => {
		const r = innerDigest(payload({ action: { type: "x", wei: 1n << 64n } }));
		expect(r.digest).toBeNull();
		expect(codes(r.issues)).toEqual(["digest.failed"]);
		expect(r.issues[0]?.message).toMatch(/uint64/);
	});
});

describe("inner user-signed digest", () => {
	it("us.enrichment-after-hyperliquidChain: payloadMultiSigUser and outerSigner follow hyperliquidChain", () => {
		const r = innerDigest(userPayload());
		expect(r.kind).toBe("user-signed");
		const fields = r.typedData?.types["HyperliquidTransaction:UsdSend"]?.map(
			(f) => f.name,
		);
		expect(fields).toEqual([
			"hyperliquidChain",
			"payloadMultiSigUser",
			"outerSigner",
			"destination",
			"amount",
			"time",
		]);
		expect(r.typedData?.message.payloadMultiSigUser).toBe(TREASURY);
		expect(r.typedData?.message.outerSigner).toBe(A);
		expect(r.typedData?.domain.chainId).toBe(0x66eee);
		expect(r.l1).toBeNull();
	});

	it("us.matches-sdk-signature: identical to the SDK's signUserSignedAction with the multi-sig fields", async () => {
		const p = userPayload();
		const ours = await signDigest(innerDigest(p).digest as `0x${string}`, 2);
		const theirs = await signUserSignedAction({
			wallet: nk(2),
			action: {
				...usdSend(),
				payloadMultiSigUser: TREASURY,
				outerSigner: A,
			} as never,
			types: {
				"HyperliquidTransaction:UsdSend": [
					{ name: "hyperliquidChain", type: "string" },
					{ name: "destination", type: "string" },
					{ name: "amount", type: "string" },
					{ name: "time", type: "uint64" },
				],
			},
		});
		expect(trimSig(ours)).toEqual(trimSig(normaliseSig(theirs).sig as never));
	});

	it("us.approveAgent-agentName-absent: signed as the empty string with an info issue", () => {
		const action = {
			type: "approveAgent",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			agentAddress: B,
			nonce: NONCE,
		};
		const r = innerDigest(userPayload({ action }));
		expect(r.digest).toMatch(/^0x/);
		expect(r.typedData?.message.agentName).toBe("");
		expect(codes(r.issues)).toContain("approveAgent.agentName");
	});

	it("us.approveAgent-agentName-null: a null agentName cannot be hashed (normalise it first)", () => {
		const action = {
			type: "approveAgent",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			agentAddress: B,
			agentName: null,
			nonce: NONCE,
		};
		const r = innerDigest(userPayload({ action }));
		expect(r.digest).toBeNull();
		expect(codes(r.issues)).toContain("field.type");
	});

	it("us.signatureChainId-sets-domain: 0x1 hashes under chainId 1 and differs from 0x66eee", () => {
		const a = innerDigest(
			userPayload({ action: { ...usdSend(), signatureChainId: "0x1" } }),
		);
		const b = innerDigest(userPayload());
		expect(a.typedData?.domain.chainId).toBe(1);
		expect(a.digest).not.toBe(b.digest);
	});

	it("us.typed-data-hash-failure: a uint32 out of range makes the EIP-712 encoder throw, reported as digest.failed", () => {
		const action = {
			type: "sendToEvmWithData",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			token: "USDC:0x1",
			amount: "1",
			sourceDex: "",
			destinationRecipient: A,
			addressEncoding: "evm",
			destinationChainId: 2 ** 40,
			gasLimit: 1,
			data: "0x",
			nonce: NONCE,
		};
		const r = innerDigest(userPayload({ action }));
		expect(r.digest).toBeNull();
		expect(codes(r.issues)).toEqual(["digest.failed"]);
	});

	it("us.missing-signatureChainId: cannot be hashed", () => {
		const { signatureChainId: _, ...rest } = usdSend();
		const r = innerDigest(userPayload({ action: rest }));
		expect(r.digest).toBeNull();
		expect(codes(r.issues)).toContain("usersigned.signatureChainId");
	});

	it("us.vault-and-expiry-not-in-inner-hash: user-signed inner digests ignore vault and expiry (they bind through the envelope)", () => {
		const base = innerDigest(userPayload()).digest;
		expect(innerDigest(userPayload({ vaultAddress: VAULT })).digest).toBe(base);
		expect(innerDigest(userPayload({ expiresAfter: NONCE + 1 })).digest).toBe(
			base,
		);
	});

	it("us.leader-and-user-in-hash: changing the leader or treasury changes the digest", () => {
		const base = innerDigest(userPayload()).digest;
		expect(innerDigest(userPayload({ outerSigner: B })).digest).not.toBe(base);
		expect(innerDigest(userPayload({ multiSigUser: A })).digest).not.toBe(base);
	});
});

describe("envelope (outer) digest", () => {
	async function envelope(
		overrides: Partial<EnvelopeRequest> = {},
		sigIndexes = [1, 2],
	): Promise<EnvelopeRequest> {
		const p = payload();
		const d = innerDigest(p).digest as `0x${string}`;
		const signatures = await Promise.all(
			sigIndexes.map((i) => signDigest(d, i)),
		);
		return {
			action: {
				type: "multiSig",
				signatureChainId: "0x66eee",
				signatures,
				payload: { multiSigUser: TREASURY, outerSigner: A, action: ORDER },
			},
			nonce: NONCE,
			vaultAddress: null,
			expiresAfter: null,
			...overrides,
		};
	}

	it("outer.key-order-canonical: type, signatureChainId, signatures, payload; payload user, leader, action; sig r, s, v", async () => {
		const c = canonicalEnvelopeAction(await envelope());
		expect(Object.keys(c)).toEqual([
			"type",
			"signatureChainId",
			"signatures",
			"payload",
		]);
		expect(Object.keys(c.payload as object)).toEqual([
			"multiSigUser",
			"outerSigner",
			"action",
		]);
		expect(Object.keys((c.signatures as object[])[0] as object)).toEqual([
			"r",
			"s",
			"v",
		]);
	});

	it("outer.inner-sigs-trimmed-before-hash: padded and trimmed inner signatures give the same envelope digest", async () => {
		const e = await envelope();
		const padded = {
			...e,
			action: { ...e.action, signatures: e.action.signatures.map(padSig) },
		};
		const trimmed = {
			...e,
			action: { ...e.action, signatures: e.action.signatures.map(trimSig) },
		};
		expect(envelopeDigest(padded, "testnet").digest).toBe(
			envelopeDigest(trimmed, "testnet").digest,
		);
		const c = canonicalEnvelopeAction(padded);
		for (const s of c.signatures as { r: string; s: string }[]) {
			expect(s.r).not.toMatch(/^0x0/);
			expect(s.s).not.toMatch(/^0x0/);
		}
	});

	it("outer.uppercase-hex-lowercased: inner signature hex is lowercased before hashing", async () => {
		const e = await envelope();
		const upper = {
			...e,
			action: {
				...e.action,
				signatures: e.action.signatures.map((s) => ({
					...s,
					r: s.r.toUpperCase().replace("0X", "0x") as `0x${string}`,
				})),
			},
		};
		expect(envelopeDigest(upper, "testnet").digest).toBe(
			envelopeDigest(e, "testnet").digest,
		);
	});

	it("outer.type-excluded-and-matches-sdk: multiSigActionHash equals the SDK's createL1ActionHash of the action without type", async () => {
		const e = await envelope();
		const r = envelopeDigest(e, "testnet");
		const { type: _t, ...rest } = canonicalEnvelopeAction(e);
		expect(r.actionHash).toBe(
			createL1ActionHash({ action: rest, nonce: NONCE }),
		);
		expect(r.typedData?.primaryType).toBe(
			"HyperliquidTransaction:SendMultiSig",
		);
		expect(r.typedData?.message.multiSigActionHash).toBe(r.actionHash);
		expect(r.typedData?.message.hyperliquidChain).toBe("Testnet");
		expect(r.typedData?.message.nonce).toBe(BigInt(NONCE));
	});

	it("outer.matches-sdk-signature: signing our envelope digest equals the SDK's signMultiSigAction", async () => {
		const e = await envelope({ vaultAddress: VAULT, expiresAfter: NONCE + 9 });
		const ours = await signDigest(
			envelopeDigest(e, "testnet").digest as `0x${string}`,
			1,
		);
		const theirs = await signMultiSigAction({
			wallet: nk(1),
			action: canonicalEnvelopeAction(e) as never,
			nonce: NONCE,
			isTestnet: true,
			vaultAddress: VAULT,
			expiresAfter: NONCE + 9,
		});
		expect(trimSig(ours)).toEqual(trimSig(normaliseSig(theirs).sig as never));
	});

	it("outer.vault-expires-in-preimage: vault address and expiry change the envelope digest", async () => {
		const e = await envelope();
		const base = envelopeDigest(e, "testnet").digest;
		expect(
			envelopeDigest({ ...e, vaultAddress: VAULT }, "testnet").digest,
		).not.toBe(base);
		expect(
			envelopeDigest({ ...e, expiresAfter: NONCE + 1 }, "testnet").digest,
		).not.toBe(base);
	});

	it("outer.signatureChainId-domain: 0x66eee and 0xa4b1 produce different digests, both hashable", async () => {
		const e = await envelope();
		const a = envelopeDigest(e, "testnet");
		const b = envelopeDigest(
			{ ...e, action: { ...e.action, signatureChainId: "0xa4b1" } },
			"testnet",
		);
		expect(a.digest).not.toBe(b.digest);
		expect(b.typedData?.domain.chainId).toBe(0xa4b1);
	});

	it("outer.hyperliquidChain-from-network: the same envelope differs between networks", async () => {
		const e = await envelope();
		expect(envelopeDigest(e, "testnet").digest).not.toBe(
			envelopeDigest(e, "mainnet").digest,
		);
		expect(
			envelopeDigest(e, "mainnet").typedData?.message.hyperliquidChain,
		).toBe("Mainnet");
	});

	it("outer.signature-order-matters: swapping two inner signatures changes the envelope digest", async () => {
		const e = await envelope();
		const swapped = {
			...e,
			action: { ...e.action, signatures: [...e.action.signatures].reverse() },
		};
		expect(envelopeDigest(swapped, "testnet").digest).not.toBe(
			envelopeDigest(e, "testnet").digest,
		);
	});

	it("outer.zero-signatures-still-hashable: an empty signature list hashes (the chain rejects it later)", async () => {
		const e = await envelope({}, []);
		expect(envelopeDigest(e, "testnet").digest).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it("outer.unhashable-nonce: a negative nonce reports digest.failed", async () => {
		const e = await envelope({ nonce: -5 });
		const r = envelopeDigest(e, "testnet");
		expect(r.digest).toBeNull();
		expect(codes(r.issues)).toEqual(["digest.failed"]);
	});
});
