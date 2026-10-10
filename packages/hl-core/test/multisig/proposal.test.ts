import { describe, expect, it } from "vitest";
import {
	createProposal,
	deepEqual,
	innerDigest,
	nonceWindow,
	type Proposal,
	proposalFlags,
	validateProposal,
} from "../../src/multisig/index.ts";
import { NONCE_WINDOW } from "../../src/rules/signing.ts";
import {
	A,
	B,
	codes,
	NONCE,
	NOW,
	ORDER,
	POLICY,
	RECIPIENT,
	SPARE,
	signatureBy,
	TREASURY,
	usdSend,
	VAULT,
} from "./_helpers.ts";

const DAY = 24 * 3600 * 1000;
const up = (a: string) => a.toUpperCase().replace("0X", "0x");
const base = (over: Record<string, unknown> = {}) =>
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
	);
const errorCodes = (r: {
	issues: readonly { code: string; severity: string }[];
}) => r.issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("nonceWindow", () => {
	it("nonce.window-bounds: valid from nonce − 1 day until nonce + 2 days", () => {
		expect(nonceWindow(NONCE)).toEqual({
			validFrom: NONCE - NONCE_WINDOW.futureMs,
			validUntil: NONCE + NONCE_WINDOW.pastMs,
		});
		expect(NONCE_WINDOW.futureMs).toBe(DAY);
		expect(NONCE_WINDOW.pastMs).toBe(2 * DAY);
	});
});

describe("createProposal", () => {
	it("create.happy-l1", () => {
		const r = base();
		expect(r.issues).toEqual([]);
		expect(r.flags).toEqual([]);
		const p = r.proposal as Proposal;
		expect(p.v).toBe(1);
		expect(p.payload).toEqual({
			network: "testnet",
			multiSigUser: TREASURY,
			outerSigner: A,
			action: ORDER,
			nonce: NONCE,
			vaultAddress: null,
			expiresAfter: null,
		});
		expect(p.digest).toBe(innerDigest(p.payload).digest);
		expect(p.signatures).toEqual([]);
		expect(p.meta).toEqual({
			kind: "l1",
			title: null,
			note: null,
			createdBy: null,
			createdAt: NOW,
			supersedes: null,
			policyAtCreation: null,
		});
		expect(p.receipt).toBeNull();
	});
	it("create.happy-user-signed with flags and full meta", () => {
		const r = base({
			action: usdSend(),
			title: "  Pay  ",
			note: "",
			createdBy: up(A),
			supersedes: `0x${"ab".repeat(32)}`,
			policyAtCreation: {
				authorizedUsers: [up(B), A],
				threshold: 1,
				observedAt: NOW,
			},
		});
		expect(errorCodes(r)).toEqual([]);
		expect(r.flags).toEqual(["funds_out"]);
		expect(r.proposal?.meta).toEqual({
			kind: "user-signed",
			title: "Pay",
			note: null,
			createdBy: A,
			createdAt: NOW,
			supersedes: `0x${"ab".repeat(32)}`,
			policyAtCreation: {
				authorizedUsers: [B, A],
				threshold: 1,
				observedAt: NOW,
			},
		});
		expect(codes(r.issues).sort()).toEqual([
			"address.uppercase",
			"address.uppercase",
		]);
	});
	it("create.network-invalid", () => {
		expect(codes(base({ network: "devnet" }).issues)).toEqual([
			"network.invalid",
		]);
	});
	it("create.checksummed-inputs-normalised with warnings", () => {
		const r = base({
			multiSigUser: up(TREASURY),
			outerSigner: up(A),
			vaultAddress: up(VAULT),
		});
		expect(r.proposal?.payload.multiSigUser).toBe(TREASURY);
		expect(r.proposal?.payload.outerSigner).toBe(A);
		expect(r.proposal?.payload.vaultAddress).toBe(VAULT);
		expect(codes(r.issues)).toEqual([
			"address.uppercase",
			"address.uppercase",
			"address.uppercase",
		]);
	});
	it("create.invalid-addresses", () => {
		expect(codes(base({ multiSigUser: "0x1" }).issues)).toEqual([
			"address.invalid",
		]);
		expect(codes(base({ outerSigner: 5 }).issues)).toEqual(["address.invalid"]);
		expect(codes(base({ vaultAddress: "nope" }).issues)).toEqual([
			"address.invalid",
		]);
		expect(codes(base({ createdBy: "nope" }).issues)).toEqual([
			"address.invalid",
		]);
	});
	it("create.self-lead", () => {
		expect(codes(base({ outerSigner: TREASURY }).issues)).toEqual([
			"proposal.self_lead",
		]);
	});
	it("create.now-defaults-to-the-clock", () => {
		const before = Date.now();
		const r = createProposal({
			network: "testnet",
			multiSigUser: TREASURY,
			outerSigner: A,
			action: ORDER,
		});
		expect(r.proposal?.payload.nonce).toBeGreaterThanOrEqual(before);
		expect(r.proposal?.meta.createdAt).toBe(r.proposal?.payload.nonce);
	});
	it("create.nonce-defaults-to-now", () => {
		const r = createProposal(
			{
				network: "testnet",
				multiSigUser: TREASURY,
				outerSigner: A,
				action: ORDER,
			},
			{ now: NOW },
		);
		expect(r.proposal?.payload.nonce).toBe(NOW);
	});
	it("create.nonce-invalid forms", () => {
		expect(codes(base({ nonce: 1_700_000_000 }).issues)).toEqual([
			"nonce.not_milliseconds",
		]);
		expect(codes(base({ nonce: 1.5 }).issues)).toEqual(["nonce.invalid"]);
		expect(codes(base({ nonce: -1 }).issues)).toEqual(["nonce.invalid"]);
		expect(codes(base({ nonce: Number.MAX_SAFE_INTEGER + 2 }).issues)).toEqual([
			"nonce.invalid",
		]);
	});
	it("create.nonce-expired is an error; create.nonce-future is a warning", () => {
		expect(
			codes(
				createProposal(
					{
						network: "testnet",
						multiSigUser: TREASURY,
						outerSigner: A,
						action: ORDER,
						nonce: NONCE,
					},
					{ now: NONCE + 2 * DAY },
				).issues,
			),
		).toEqual(["nonce.expired"]);
		const r = createProposal(
			{
				network: "testnet",
				multiSigUser: TREASURY,
				outerSigner: A,
				action: ORDER,
				nonce: NOW + DAY + 1,
			},
			{ now: NOW },
		);
		expect(codes(r.issues)).toEqual(["nonce.future"]);
		expect(r.proposal).not.toBeNull();
	});
	it("create.expires: past, unreachable, invalid, user-signed warning", () => {
		expect(codes(base({ expiresAfter: NOW }).issues)).toEqual(["expires.past"]);
		expect(codes(base({ expiresAfter: 1.5 }).issues)).toEqual([
			"expires.invalid",
		]);
		expect(codes(base({ expiresAfter: -1 }).issues)).toEqual([
			"expires.invalid",
		]);
		const unreachable = createProposal(
			{
				network: "testnet",
				multiSigUser: TREASURY,
				outerSigner: A,
				action: ORDER,
				nonce: NOW + 1.5 * DAY,
				expiresAfter: NOW + 60_000,
			},
			{ now: NOW },
		);
		expect(codes(unreachable.issues)).toEqual([
			"nonce.future",
			"expires.unreachable",
		]);
		const ok = base({ expiresAfter: NOW + 60_000 });
		expect(ok.issues).toEqual([]);
		expect(ok.proposal?.payload.expiresAfter).toBe(NOW + 60_000);
		const us = base({ action: usdSend(), expiresAfter: NOW + 60_000 });
		expect(codes(us.issues)).toEqual(["expires.user_signed_untested"]);
		expect(us.proposal).not.toBeNull();
	});
	it("create.action-errors-propagate", () => {
		expect(codes(base({ action: { type: "multiSig" } }).issues)).toEqual([
			"action.nested_envelope",
		]);
		expect(codes(base({ action: usdSend(NONCE - 1) }).issues)).toEqual([
			"nonce.mismatch",
		]);
	});
	it("create.supersedes-invalid / create.policy-invalid", () => {
		expect(codes(base({ supersedes: "0x12" }).issues)).toEqual([
			"meta.supersedes",
		]);
		expect(codes(base({ policyAtCreation: [] }).issues)).toEqual([
			"policy.shape",
		]);
		expect(
			codes(
				base({
					policyAtCreation: {
						authorizedUsers: "x",
						threshold: 1,
						observedAt: 1,
					},
				}).issues,
			),
		).toEqual(["policy.shape"]);
		expect(
			codes(
				base({
					policyAtCreation: {
						authorizedUsers: [A],
						threshold: "1",
						observedAt: 1,
					},
				}).issues,
			),
		).toEqual(["policy.shape"]);
		expect(
			codes(
				base({
					policyAtCreation: {
						authorizedUsers: [A, "bad"],
						threshold: 1,
						observedAt: 1,
					},
				}).issues,
			),
		).toEqual(["address.invalid"]);
	});
	it("create.digest-failure: an unknown-shape action with a value beyond uint64 cannot be hashed", () => {
		const r = base({ action: { type: "x", wei: 1n << 64n } });
		expect(r.proposal).toBeNull();
		expect(codes(r.issues)).toEqual(["action.unknown_shape", "digest.failed"]);
	});
});

describe("validateProposal", () => {
	const good = () => base().proposal as Proposal;
	const docOf = (p: Proposal): Record<string, unknown> =>
		JSON.parse(JSON.stringify(p));

	it("validate.roundtrip: a freshly created proposal validates to itself with no issues", async () => {
		const p = good();
		const withSig = { ...p, signatures: [await signatureBy(p.payload, 1)] };
		const r = validateProposal(docOf(withSig), { now: NOW });
		expect(r.issues).toEqual([]);
		expect(r.proposal).toEqual(withSig);
	});
	it("validate.shape: non-objects", () => {
		for (const bad of [null, 5, "x", []])
			expect(codes(validateProposal(bad).issues)).toEqual(["proposal.shape"]);
	});
	it("validate.version-unknown", () => {
		expect(codes(validateProposal({ ...docOf(good()), v: 2 }).issues)).toEqual([
			"proposal.version",
		]);
		expect(
			codes(validateProposal({ ...docOf(good()), v: undefined }).issues),
		).toEqual(["proposal.version"]);
	});
	it("validate.unknown-top-level-field is dropped with a warning", () => {
		const r = validateProposal({ ...docOf(good()), extra: 1 }, { now: NOW });
		expect(codes(r.issues)).toEqual(["proposal.unknown_field"]);
		expect(r.proposal).toEqual(good());
	});
	it("validate.payload-shape: missing payload, unknown field, missing field", () => {
		expect(
			codes(validateProposal({ ...docOf(good()), payload: null }).issues),
		).toEqual(["proposal.shape"]);
		const d = docOf(good());
		(d.payload as Record<string, unknown>).memo = 1;
		expect(codes(validateProposal(d, { now: NOW }).issues)).toEqual([
			"payload.unknown_field",
		]);
		const d2 = docOf(good());
		delete (d2.payload as Record<string, unknown>).vaultAddress;
		expect(codes(validateProposal(d2, { now: NOW }).issues)).toEqual([
			"payload.missing_field",
		]);
		const d3 = docOf(good());
		delete (d3.payload as Record<string, unknown>).expiresAfter;
		expect(codes(validateProposal(d3, { now: NOW }).issues)).toEqual([
			"payload.missing_field",
		]);
		expect(validateProposal(docOf(good())).proposal).toEqual(good());
	});
	it("validate.network-invalid", () => {
		const d = docOf(good());
		(d.payload as Record<string, unknown>).network = "x";
		expect(codes(validateProposal(d).issues)).toEqual(["network.invalid"]);
	});
	it("validate.addresses: not lowercase, invalid, self lead, vault", () => {
		const mut = (k: string, v: unknown) => {
			const d = docOf(good());
			(d.payload as Record<string, unknown>)[k] = v;
			return codes(validateProposal(d, { now: NOW }).issues);
		};
		expect(mut("multiSigUser", up(TREASURY))).toEqual([
			"address.not_lowercase",
		]);
		expect(mut("outerSigner", "0x12")).toEqual(["address.invalid"]);
		expect(mut("outerSigner", TREASURY)).toEqual(["proposal.self_lead"]);
		expect(mut("vaultAddress", up(VAULT))).toEqual(["address.not_lowercase"]);
		// a lowercase vault is structurally fine, but it is signed: the stored digest no longer matches
		expect(mut("vaultAddress", VAULT)).toEqual(["proposal.digest_mismatch"]);
	});
	it("validate.nonce: invalid is an error, expired is only a warning for a document", () => {
		const d = docOf(good());
		(d.payload as Record<string, unknown>).nonce = "1";
		expect(codes(validateProposal(d).issues)).toEqual(["nonce.invalid"]);
		const late = validateProposal(docOf(good()), { now: NONCE + 3 * DAY });
		expect(codes(late.issues)).toEqual(["nonce.expired"]);
		expect(late.proposal).toEqual(good());
	});
	it("validate.action-not-canonical: reordered keys are rejected", () => {
		const d = docOf(good());
		(d.payload as Record<string, unknown>).action = {
			grouping: "na",
			orders: ORDER.orders,
			type: "order",
		};
		expect(codes(validateProposal(d, { now: NOW }).issues)).toEqual([
			"action.not_canonical",
		]);
	});
	it("validate.action-errors are reported under payload.", () => {
		const d = docOf(good());
		(d.payload as Record<string, unknown>).action = { type: "multiSig" };
		const r = validateProposal(d, { now: NOW });
		expect(codes(r.issues)).toEqual(["action.nested_envelope"]);
		expect(r.issues[0]?.path).toBe("payload.action.type");
	});
	it("validate.expires: past is a warning for a document; user-signed warning kept", () => {
		const d = docOf(base({ expiresAfter: NOW + 1 }).proposal as Proposal);
		const r = validateProposal(d, { now: NOW + 5 });
		expect(codes(r.issues)).toEqual(["expires.past"]);
		expect(r.proposal).not.toBeNull();
		const d2 = docOf(
			base({ action: usdSend(), expiresAfter: NOW + 1000 })
				.proposal as Proposal,
		);
		expect(codes(validateProposal(d2, { now: NOW }).issues)).toEqual([
			"expires.user_signed_untested",
		]);
	});
	it("validate.meta: missing, unknown field, kind mismatch, bad types", () => {
		expect(
			codes(
				validateProposal({ ...docOf(good()), meta: null }, { now: NOW }).issues,
			),
		).toEqual(["proposal.shape"]);
		const m = (over: Record<string, unknown>) => {
			const d = docOf(good());
			d.meta = { ...(d.meta as object), ...over };
			return validateProposal(d, { now: NOW });
		};
		expect(codes(m({ extra: 1 }).issues)).toEqual(["meta.unknown_field"]);
		expect(codes(m({ kind: "user-signed" }).issues)).toEqual(["meta.kind"]);
		expect(codes(m({ title: 5 }).issues)).toEqual(["meta.type"]);
		expect(codes(m({ note: [] }).issues)).toEqual(["meta.type"]);
		expect(codes(m({ createdBy: up(A) }).issues)).toEqual([
			"address.not_lowercase",
		]);
		expect(codes(m({ createdAt: "x" }).issues)).toEqual(["meta.type"]);
		expect(codes(m({ supersedes: "0x1" }).issues)).toEqual(["meta.supersedes"]);
		expect(
			m({ supersedes: `0x${"AB".repeat(32)}` }).proposal?.meta.supersedes,
		).toBe(`0x${"ab".repeat(32)}`);
		expect(codes(m({ policyAtCreation: 5 }).issues)).toEqual(["policy.shape"]);
		expect(
			m({
				policyAtCreation: {
					authorizedUsers: [B, A],
					threshold: 1,
					observedAt: 1,
				},
			}).proposal?.meta.policyAtCreation,
		).toEqual({ authorizedUsers: [B, A], threshold: 1, observedAt: 1 });
		expect(
			m({ title: "t", note: "n", createdBy: A, createdAt: 7 }).proposal?.meta,
		).toMatchObject({ title: "t", note: "n", createdBy: A, createdAt: 7 });
	});
	it("validate.signatures: not array, not object, bad signer, not document form, duplicate signer, bad at", async () => {
		const p = good();
		const sig = await signatureBy(p.payload, 1);
		const s = (sigs: unknown) =>
			codes(
				validateProposal({ ...docOf(p), signatures: sigs }, { now: NOW })
					.issues,
			);
		expect(s(null)).toEqual(["proposal.shape"]);
		expect(s([5])).toEqual(["signature.invalid"]);
		expect(s([{ ...sig, signer: "x" }])).toEqual(["address.invalid"]);
		expect(
			s([{ ...sig, r: sig.r.replace(/^0x0+/, "0x") }]).includes(
				"signature.not_document_form",
			) ||
				s([{ ...sig, r: `0x${sig.r.slice(3)}` }]).includes(
					"signature.not_document_form",
				),
		).toBe(true);
		expect(s([{ ...sig, r: up(sig.r) }])).toEqual([
			"signature.not_document_form",
		]);
		expect(s([sig, sig])).toEqual(["signatures.duplicate_signer"]);
		expect(s([{ ...sig, at: "now" }])).toEqual(["meta.type"]);
		expect(s([{ ...sig, v: 29 }])).toEqual(["signature.invalid"]);
		expect(s([{ ...sig, s: `0x${"0".repeat(64)}` }])).toEqual([
			"signature.zero",
		]);
	});
	it("validate.receipt: round trip and every shape error", async () => {
		const p = good();
		const outer = await signatureBy(p.payload, 1);
		const receipt = {
			submittedAt: NOW,
			signatureChainId: "0x66eee",
			outerSignature: { r: outer.r, s: outer.s, v: outer.v },
			httpStatus: 200,
			response: { status: "ok" },
		};
		const ok = validateProposal({ ...docOf(p), receipt }, { now: NOW });
		expect(ok.issues).toEqual([]);
		expect(ok.proposal?.receipt).toEqual(receipt);
		const r = (rc: unknown) =>
			codes(
				validateProposal({ ...docOf(p), receipt: rc }, { now: NOW }).issues,
			);
		expect(r(5)).toEqual(["receipt.shape"]);
		expect(r({ ...receipt, submittedAt: null })).toEqual(["receipt.shape"]);
		expect(r({ ...receipt, signatureChainId: "0x66EEE" })).toEqual([
			"receipt.shape",
		]);
		expect(
			r({ ...receipt, outerSignature: { r: "0x1", s: "0x1", v: 27 } }),
		).toEqual(["signature.not_document_form"]);
		expect(r({ ...receipt, httpStatus: "200" })).toEqual(["receipt.shape"]);
		const { response: _, ...noResponse } = receipt;
		expect(r(noResponse)).toEqual(["receipt.shape"]);
	});
	it("validate.digest-mismatch and case-insensitive digest", () => {
		const d = docOf(good());
		expect(
			codes(
				validateProposal({ ...d, digest: `0x${"00".repeat(32)}` }, { now: NOW })
					.issues,
			),
		).toEqual(["proposal.digest_mismatch"]);
		expect(
			codes(validateProposal({ ...d, digest: 5 }, { now: NOW }).issues),
		).toEqual(["proposal.digest_mismatch"]);
		expect(
			validateProposal({ ...d, digest: up(d.digest as string) }, { now: NOW })
				.proposal,
		).toEqual(good());
	});
	it("validate.digest-failure after structure passes", () => {
		const d = docOf(good());
		(d.payload as Record<string, unknown>).action = {
			type: "x",
			wei: 1n << 64n,
		};
		(d.payload as Record<string, unknown>).action = {
			type: "x",
			wei: (1n << 64n) as unknown as number,
		};
		const r = validateProposal(d, { now: NOW });
		expect(r.proposal).toBeNull();
		expect(codes(r.issues)).toEqual(["digest.failed"]);
	});
	it("validate.user-signed-document round trip", async () => {
		const p = base({ action: usdSend() }).proposal as Proposal;
		const withSig = { ...p, signatures: [await signatureBy(p.payload, 2)] };
		expect(validateProposal(docOf(withSig), { now: NOW }).proposal).toEqual(
			withSig,
		);
	});
});

describe("deepEqual and proposalFlags", () => {
	it("deepEqual is key-order sensitive and bigint aware", () => {
		expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
		expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
		expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(deepEqual([1, 2n], [1, 2n])).toBe(true);
		expect(deepEqual([1, 2], [1])).toBe(false);
		expect(deepEqual([1], { 0: 1 })).toBe(false);
		expect(deepEqual(null, {})).toBe(false);
		expect(deepEqual({}, null)).toBe(false);
		expect(deepEqual(1, "1")).toBe(false);
		expect(deepEqual("x", "x")).toBe(true);
	});
	it("proposalFlags derives from the action", () => {
		expect(
			proposalFlags(base({ action: usdSend() }).proposal as Proposal),
		).toEqual(["funds_out"]);
		expect(proposalFlags(base().proposal as Proposal)).toEqual([]);
		expect(RECIPIENT).toBe(usdSend().destination);
		expect(SPARE).not.toBe(A);
		expect(POLICY.threshold).toBe(2);
	});
});
