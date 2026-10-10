/** Invariants that must hold for arbitrary inputs, not just the hand-written cases. */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	fromPlain,
	parseJson,
	stringifyJson,
	toPlain,
} from "../../src/json.ts";
import {
	createProposal,
	decodeProposal,
	encodeProposal,
	explainExchangeError,
	mergeProposals,
	type Proposal,
	type ProposalSignature,
	padSig,
	parseEnvelope,
	prepareInnerAction,
	SECP256K1_N,
	trimSig,
	validateProposal,
} from "../../src/multisig/index.ts";
import { ADDRESSES, NOW, ORDER, signatureBy, usdSend } from "./_helpers.ts";

/** The receipt's response is foreign JSON; its canonical in-memory form is what the codec produces. */
const foreign = (v: unknown) =>
	toPlain(parseJson(stringifyJson(fromPlain(v, true), 0)));

const RUNS = Number(process.env.MULTISIG_PROPERTY_RUNS ?? 100);
const hex32 = fc
	.bigInt({ min: 1n, max: SECP256K1_N - 1n })
	.map((n) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`);
const address = fc
	.uint8Array({ minLength: 20, maxLength: 20 })
	.map(
		(u) =>
			`0x${Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`,
	);
const decimal = fc
	.tuple(
		fc.integer({ min: 1, max: 99999 }),
		fc.option(fc.integer({ min: 1, max: 999 }), { nil: null }),
	)
	.map(([i, f]) =>
		f === null ? String(i) : `${i}.${String(f).replace(/0+$/, "")}`,
	);

const proposalArb = fc
	.record({
		network: fc.constantFrom("mainnet" as const, "testnet" as const),
		pair: fc
			.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }))
			.filter(([a, b]) => a !== b),
		kind: fc.constantFrom("l1", "user"),
		price: decimal,
		amount: decimal,
		nonce: fc.integer({ min: NOW - 3600_000, max: NOW + 3600_000 }),
		vault: fc.option(address, { nil: null }),
		expires: fc.option(fc.integer({ min: NOW + 1, max: NOW + 10 ** 8 }), {
			nil: null,
		}),
		title: fc.option(fc.string({ maxLength: 30 }), { nil: null }),
		note: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
		sigs: fc.uniqueArray(
			fc.record({
				signer: address,
				r: hex32,
				s: hex32,
				v: fc.constantFrom(27 as const, 28 as const),
				at: fc.option(fc.integer({ min: 0, max: NOW }), { nil: null }),
			}),
			{ maxLength: 3, selector: (s) => s.signer },
		),
		receipt: fc.option(
			fc.record({
				submittedAt: fc.integer({ min: 0, max: NOW }),
				signatureChainId: fc.constantFrom(
					"0x66eee" as const,
					"0xa4b1" as const,
				),
				outerSignature: fc.record({
					r: hex32,
					s: hex32,
					v: fc.constantFrom(27 as const, 28 as const),
				}),
				httpStatus: fc.constantFrom(200, 422, 500),
				response: fc.jsonValue(),
			}),
			{ nil: null },
		),
	})
	.map((x) => {
		const action =
			x.kind === "l1"
				? {
						...ORDER,
						orders: [
							{ ...(ORDER.orders as object[])[0], p: x.price, s: x.amount },
						],
					}
				: { ...usdSend(x.nonce, x.network), amount: x.amount };
		const r = createProposal(
			{
				network: x.network,
				multiSigUser: ADDRESSES[x.pair[0]] as string,
				outerSigner: ADDRESSES[x.pair[1]] as string,
				action,
				nonce: x.nonce,
				vaultAddress: x.vault,
				expiresAfter: x.expires,
				title: x.title,
				note: x.note,
			},
			{ now: NOW },
		);
		if (!r.proposal)
			throw new Error(
				`generator produced an invalid proposal: ${JSON.stringify(r.issues)}`,
			);
		const receipt = x.receipt
			? { ...x.receipt, response: foreign(x.receipt.response) }
			: null;
		return {
			...r.proposal,
			signatures: x.sigs as ProposalSignature[],
			receipt: receipt as Proposal["receipt"],
		} as Proposal;
	});

describe(`properties (${RUNS} runs)`, () => {
	it("decode(encode(p)) deep-equals p, compact and pretty", () => {
		fc.assert(
			fc.property(proposalArb, (p) => {
				for (const pretty of [false, true]) {
					const text = encodeProposal(p, { pretty });
					const d = decodeProposal(text, { now: NOW });
					expect(d.proposal, text).toEqual(p);
					expect(encodeProposal(d.proposal as Proposal, { pretty })).toBe(text);
				}
			}),
			{ numRuns: RUNS, seed: 1 },
		);
	});
	it("merge is idempotent and commutative on the signature set (real signatures)", async () => {
		await fc.assert(
			fc.asyncProperty(
				proposalArb,
				fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { maxLength: 3 }),
				fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { maxLength: 3 }),
				async (p, ia, ib) => {
					const a = {
						...p,
						signatures: await Promise.all(
							ia.map((i) => signatureBy(p.payload, i)),
						),
					};
					const b = {
						...p,
						signatures: await Promise.all(
							ib.map((i) => signatureBy(p.payload, i)),
						),
					};
					const aa = (await mergeProposals(a, a)).merged as Proposal;
					expect(aa).toEqual(a);
					const ab = (await mergeProposals(a, b)).merged as Proposal;
					const ba = (await mergeProposals(b, a)).merged as Proposal;
					expect(new Set(ab.signatures.map((s) => s.signer))).toEqual(
						new Set([...ia, ...ib].map((i) => ADDRESSES[i])),
					);
					expect(new Set(ab.signatures)).toEqual(new Set(ba.signatures));
					expect(ab.digest).toBe(p.digest);
				},
			),
			{ numRuns: Math.min(RUNS, 40), seed: 2 },
		);
	});
	it("trim/pad round-trip for arbitrary 32-byte values", () => {
		fc.assert(
			fc.property(
				hex32,
				hex32,
				fc.constantFrom(27 as const, 28 as const),
				(r, s, v) => {
					const sig = { r, s, v };
					expect(padSig(trimSig(sig))).toEqual(sig);
					expect(trimSig(trimSig(sig))).toEqual(trimSig(sig));
					expect(padSig(padSig(sig))).toEqual(sig);
					expect(trimSig(sig).r).not.toMatch(/^0x0./);
				},
			),
			{ numRuns: RUNS, seed: 3 },
		);
	});
	it("validateProposal, prepareInnerAction, parseEnvelope and explainExchangeError never throw on arbitrary values", () => {
		fc.assert(
			fc.property(
				fc.anything(),
				fc.integer({ min: 100, max: 599 }),
				(v, status) => {
					expect(() => validateProposal(v, { now: NOW })).not.toThrow();
					expect(() => prepareInnerAction(v, "testnet", NOW)).not.toThrow();
					expect(() => parseEnvelope(v)).not.toThrow();
					expect(() => explainExchangeError(v, status)).not.toThrow();
				},
			),
			{ numRuns: RUNS * 3, seed: 4 },
		);
	});
	it("decodeProposal never throws on arbitrary text, and only ever returns a proposal whose digest re-verifies", () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.string(),
					fc.json(),
					proposalArb.map((p) => encodeProposal(p)),
				),
				(text) => {
					const d = decodeProposal(text, { now: NOW });
					if (d.proposal)
						expect(validateProposal(d.proposal, { now: NOW }).proposal).toEqual(
							d.proposal,
						);
				},
			),
			{ numRuns: RUNS, seed: 5 },
		);
	});
	it("a structurally valid document with a tampered payload never validates", () => {
		fc.assert(
			fc.property(
				proposalArb,
				fc.integer({ min: 1, max: 1000 }),
				(p, delta) => {
					const doc = JSON.parse(
						encodeProposal({ ...p, signatures: [], receipt: null }),
					);
					doc.payload.nonce += delta;
					expect(validateProposal(doc, { now: NOW }).proposal).toBeNull();
				},
			),
			{ numRuns: RUNS, seed: 6 },
		);
	});
});
