import { describe, expect, it } from "vitest";
import {
	createProposal,
	decodeProposal,
	encodeProposal,
	mergeProposals,
	type Proposal,
	SECP256K1_N,
} from "../../src/multisig/index.ts";
import { PROPOSAL_SIZE_WARN_BYTES } from "../../src/rules/multisig.ts";
import {
	A,
	B,
	C,
	codes,
	NONCE,
	NOW,
	ORDER,
	POLICY,
	signatureBy,
	TREASURY,
	usdSend,
} from "./_helpers.ts";

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

describe("encodeProposal / decodeProposal", () => {
	it("codec.roundtrip-stable: compact and pretty both decode to the same proposal and re-encode byte-identically", async () => {
		const p = make({
			title: "t",
			note: "n",
			createdBy: B,
			policyAtCreation: POLICY,
		});
		const full: Proposal = {
			...p,
			signatures: [
				await signatureBy(p.payload, 1),
				await signatureBy(p.payload, 2),
			],
			receipt: {
				submittedAt: NOW,
				signatureChainId: "0x66eee",
				outerSignature: {
					r: `0x${"1".repeat(64)}`,
					s: `0x${"2".repeat(64)}`,
					v: 27,
				},
				httpStatus: 200,
				response: { status: "ok", response: { type: "default" } },
			},
		};
		const compact = encodeProposal(full);
		const pretty = encodeProposal(full, { pretty: true });
		expect(compact).not.toContain("\n");
		expect(pretty).toContain("\n  ");
		const d1 = decodeProposal(compact, { now: NOW });
		const d2 = decodeProposal(pretty, { now: NOW });
		expect(d1.issues).toEqual([]);
		expect(d1.proposal).toEqual(full);
		expect(d2.proposal).toEqual(full);
		expect(encodeProposal(d1.proposal as Proposal)).toBe(compact);
		expect(encodeProposal(d2.proposal as Proposal, { pretty: true })).toBe(
			pretty,
		);
	});
	it("codec.key-order-deterministic: keys come out in the documented order regardless of object construction", () => {
		const p = make();
		const shuffled = {
			receipt: p.receipt,
			meta: {
				policyAtCreation: null,
				supersedes: null,
				createdAt: p.meta.createdAt,
				createdBy: null,
				note: null,
				title: null,
				kind: p.meta.kind,
			},
			signatures: [],
			digest: p.digest,
			payload: {
				expiresAfter: null,
				vaultAddress: null,
				nonce: p.payload.nonce,
				action: p.payload.action,
				outerSigner: p.payload.outerSigner,
				multiSigUser: p.payload.multiSigUser,
				network: p.payload.network,
			},
			v: 1,
		} as unknown as Proposal;
		expect(encodeProposal(shuffled)).toBe(encodeProposal(p));
		const parsed = JSON.parse(encodeProposal(p));
		expect(Object.keys(parsed)).toEqual([
			"v",
			"payload",
			"digest",
			"signatures",
			"meta",
			"receipt",
		]);
		expect(Object.keys(parsed.payload)).toEqual([
			"network",
			"multiSigUser",
			"outerSigner",
			"action",
			"nonce",
			"vaultAddress",
			"expiresAfter",
		]);
		expect(Object.keys(parsed.meta)).toEqual([
			"kind",
			"title",
			"note",
			"createdBy",
			"createdAt",
			"supersedes",
			"policyAtCreation",
		]);
	});
	it("codec.bigint-lexeme-preserved: integers above 2^53 survive as exact digits and come back as bigint", () => {
		const p = make({ action: { type: "x", wei: (1n << 60n) + 1n } });
		const text = encodeProposal(p);
		expect(text).toContain(`"wei":${(1n << 60n) + 1n}`);
		const d = decodeProposal(text, { now: NOW });
		expect(d.proposal?.payload.action.wei).toBe((1n << 60n) + 1n);
	});
	it("codec.receipt-floats: the foreign exchange response may carry floats", () => {
		const p: Proposal = {
			...make(),
			receipt: {
				submittedAt: NOW,
				signatureChainId: "0x66eee",
				outerSignature: {
					r: `0x${"1".repeat(64)}`,
					s: `0x${"2".repeat(64)}`,
					v: 28,
				},
				httpStatus: 200,
				response: { px: 1.5, list: [1, 2.25] },
			},
		};
		const d = decodeProposal(encodeProposal(p), { now: NOW });
		expect(d.proposal?.receipt?.response).toEqual({ px: 1.5, list: [1, 2.25] });
	});
	it("codec.decode-errors: invalid JSON, duplicate keys, wrong version", () => {
		expect(codes(decodeProposal("{nope").issues)).toEqual(["proposal.parse"]);
		expect(codes(decodeProposal('{"v":1,"v":1}').issues)).toEqual([
			"proposal.parse",
		]);
		expect(codes(decodeProposal('{"v":2}').issues)).toEqual([
			"proposal.version",
		]);
	});
	it("codec.size-guard: a document over the limit decodes with a warning", () => {
		const p = make({ note: "x".repeat(PROPOSAL_SIZE_WARN_BYTES) });
		const d = decodeProposal(encodeProposal(p), { now: NOW });
		expect(codes(d.issues)).toEqual(["proposal.large"]);
		expect(d.proposal).toEqual(p);
	});
	it("codec.user-signed roundtrip", () => {
		const p = make({ action: usdSend() });
		expect(decodeProposal(encodeProposal(p), { now: NOW }).proposal).toEqual(p);
	});
});

describe("mergeProposals", () => {
	it("merge.same-digest-union: a's signatures first, then b's new signers", async () => {
		const p = make();
		const sA = await signatureBy(p.payload, 1);
		const sB = await signatureBy(p.payload, 2);
		const sC = await signatureBy(p.payload, 3);
		const a = { ...p, signatures: [sA, sB] };
		const b = { ...p, signatures: [sC, sB] };
		const r = await mergeProposals(a, b);
		expect(r.issues).toEqual([]);
		expect(r.merged?.signatures).toEqual([sA, sB, sC]);
		expect(r.merged?.payload).toBe(a.payload);
	});
	it("merge.different-digest-refused", async () => {
		const r = await mergeProposals(make(), make({ nonce: NONCE + 1 }));
		expect(r.merged).toBeNull();
		expect(codes(r.issues)).toEqual(["merge.digest_mismatch"]);
	});
	it("merge.duplicate-signer-first-wins and merge.invalid-signature-dropped", async () => {
		const p = make();
		const sA = await signatureBy(p.payload, 1);
		const sA2 = { ...sA, at: 1 };
		const forged = { ...(await signatureBy(p.payload, 1)), signer: B };
		const r = await mergeProposals(
			{ ...p, signatures: [sA, forged] },
			{ ...p, signatures: [sA2] },
		);
		expect(r.merged?.signatures).toEqual([sA]);
		expect(codes(r.issues)).toEqual(["merge.signature_dropped"]);
		expect(r.issues[0]?.path).toBe("a.signatures[1]");
		expect(r.issues[0]?.message).toContain(A);
	});
	it("merge.meta-local-wins-null-filled and merge.receipt-propagates", async () => {
		const p = make();
		const receipt = {
			submittedAt: NOW,
			signatureChainId: "0x66eee" as const,
			outerSignature: {
				r: `0x${"1".repeat(64)}` as const,
				s: `0x${"2".repeat(64)}` as const,
				v: 27 as const,
			},
			httpStatus: 200,
			response: null,
		};
		const a = {
			...p,
			meta: { ...p.meta, title: "mine", note: null, createdBy: null },
		};
		const b = {
			...p,
			meta: {
				...p.meta,
				title: "theirs",
				note: "their note",
				createdBy: C,
				policyAtCreation: POLICY,
			},
			receipt,
		};
		const r = await mergeProposals(a, b);
		expect(r.merged?.meta).toEqual({
			...p.meta,
			title: "mine",
			note: "their note",
			createdBy: C,
			policyAtCreation: POLICY,
		});
		expect(r.merged?.receipt).toEqual(receipt);
		const r2 = await mergeProposals(b, {
			...a,
			receipt: { ...receipt, httpStatus: 500 },
		});
		expect(r2.merged?.receipt?.httpStatus).toBe(200);
	});
	it("merge.unrecoverable-signature-dropped and every meta field falls back to b", async () => {
		const p = make();
		const garbage = {
			signer: A,
			r: `0x${SECP256K1_N.toString(16)}` as `0x${string}`,
			s: `0x${"1".padStart(64, "0")}` as `0x${string}`,
			v: 27 as const,
			at: null,
		};
		const a = {
			...p,
			signatures: [garbage],
			meta: {
				...p.meta,
				title: null,
				note: null,
				createdBy: null,
				createdAt: null,
				supersedes: null,
				policyAtCreation: null,
			},
		};
		const b = {
			...p,
			meta: {
				...p.meta,
				title: "b",
				note: "bn",
				createdBy: C,
				createdAt: 5,
				supersedes: `0x${"cd".repeat(32)}` as `0x${string}`,
				policyAtCreation: POLICY,
			},
		};
		const r = await mergeProposals(a, b);
		expect(r.issues[0]?.message).toContain("nothing");
		expect(r.merged?.signatures).toEqual([]);
		expect(r.merged?.meta).toEqual(b.meta);
	});
	it("merge.idempotent and commutative on the signature set", async () => {
		const p = make();
		const sA = await signatureBy(p.payload, 1);
		const sB = await signatureBy(p.payload, 2);
		const a = { ...p, signatures: [sA] };
		const b = { ...p, signatures: [sB] };
		expect((await mergeProposals(a, a)).merged).toEqual(a);
		const ab = (await mergeProposals(a, b)).merged?.signatures ?? [];
		const ba = (await mergeProposals(b, a)).merged?.signatures ?? [];
		expect(new Set(ab)).toEqual(new Set(ba));
		expect(ab).toEqual([sA, sB]);
		expect(ba).toEqual([sB, sA]);
	});
});
