/**
 * Differential oracle: for random proposals, the signatures our module leads a
 * wallet to produce must be byte-identical to what @nktkas/hyperliquid produces
 * for the same inputs (RFC 6979 makes ECDSA deterministic), for both inner
 * schemes and for the envelope.
 */
import {
	signL1Action,
	signMultiSigAction,
	signUserSignedAction,
} from "@nktkas/hyperliquid/signing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	buildEnvelope,
	canonicalEnvelopeAction,
	createProposal,
	type Proposal,
	recoverInnerSigner,
	signEnvelope,
	signProposal,
	trimSig,
	viemSigner,
} from "../../src/multisig/index.ts";
import { USER_SIGNED_SPECS, userSignedSpec } from "../../src/rules/signing.ts";
import { ACCOUNTS, ADDRESSES, NOW } from "./_helpers.ts";

const RUNS = Number(process.env.MULTISIG_ORACLE_RUNS ?? 300);
const SEED = 20261008;
type Account = NonNullable<(typeof ACCOUNTS)[number]>;
const account = (i: number) => ACCOUNTS[i] as Account;

// ---------------------------------------------------------------- arbitraries

const hex = (bytes: number) =>
	fc
		.uint8Array({ minLength: bytes, maxLength: bytes })
		.map(
			(u) =>
				`0x${Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("")}`,
		);
const address = hex(20);
const cloid = hex(16);
/** Canonical decimal string: no leading zeros (except "0."), no trailing zeros. */
const decimal = fc
	.tuple(
		fc.integer({ min: 0, max: 999_999 }),
		fc.option(fc.integer({ min: 1, max: 999 }), { nil: null }),
	)
	.map(([int, frac]) => {
		if (frac === null) return int === 0 ? "1" : String(int);
		const f = String(frac).replace(/0+$/, "");
		return `${int}.${f}`;
	});
const name = fc.stringMatching(/^[a-z][a-zA-Z]{0,7}$/);
const network = fc.constantFrom("mainnet" as const, "testnet" as const);

const orderAction = fc
	.array(
		fc.record({
			a: fc.integer({ min: 0, max: 200_000 }),
			b: fc.boolean(),
			p: decimal,
			s: decimal,
			r: fc.boolean(),
			t: fc.constantFrom(
				{ limit: { tif: "Gtc" } },
				{ limit: { tif: "Ioc" } },
				{ limit: { tif: "Alo" } },
			),
			c: fc.option(cloid, { nil: undefined }),
		}),
		{ minLength: 1, maxLength: 3 },
	)
	.map((orders) => ({
		type: "order",
		orders: orders.map((o) =>
			o.c === undefined
				? { a: o.a, b: o.b, p: o.p, s: o.s, r: o.r, t: o.t }
				: o,
		),
		grouping: "na",
	}));
const cancelAction = fc
	.array(
		fc.record({
			a: fc.integer({ min: 0, max: 200_000 }),
			o: fc.integer({ min: 0, max: 2 ** 40 }),
		}),
		{ minLength: 1, maxLength: 3 },
	)
	.map((cancels) => ({ type: "cancel", cancels }));
const cancelByCloidAction = fc
	.array(fc.record({ asset: fc.integer({ min: 0, max: 200_000 }), cloid }), {
		minLength: 1,
		maxLength: 3,
	})
	.map((cancels) => ({ type: "cancelByCloid", cancels }));
const leverageAction = fc
	.record({
		asset: fc.integer({ min: 0, max: 1000 }),
		isCross: fc.boolean(),
		leverage: fc.integer({ min: 1, max: 50 }),
	})
	.map((x) => ({ type: "updateLeverage", ...x }));
const scheduleCancelAction = fc
	.option(fc.integer({ min: NOW, max: NOW + 10 ** 9 }), { nil: undefined })
	.map((time) =>
		time === undefined
			? { type: "scheduleCancel" }
			: { type: "scheduleCancel", time },
	);
const vaultTransferAction = fc
	.record({
		vaultAddress: address,
		isDeposit: fc.boolean(),
		usd: fc.integer({ min: 1, max: 10 ** 9 }),
	})
	.map((x) => ({ type: "vaultTransfer", ...x }));
const subAccountAction = name.map((n) => ({
	type: "createSubAccount",
	name: n,
}));
const unknownAction = fc
	.record({
		n: fc.integer({ min: 0, max: 2 ** 31 }),
		s: name,
		nested: fc.record({
			flag: fc.boolean(),
			list: fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 3 }),
		}),
	})
	.map((x) => ({ type: "spotDeployLike", ...x }));
const l1Action = fc.oneof(
	orderAction,
	cancelAction,
	cancelByCloidAction,
	leverageAction,
	scheduleCancelAction,
	vaultTransferAction,
	subAccountAction,
	fc.constant({ type: "noop" }),
	unknownAction,
);

const signersJson = fc
	.tuple(
		fc.uniqueArray(address, { minLength: 1, maxLength: 3 }),
		fc.integer({ min: 1, max: 3 }),
		fc.boolean(),
	)
	.map(([users, t, revert]) =>
		revert
			? "null"
			: JSON.stringify({
					authorizedUsers: [...users].sort(),
					threshold: Math.min(t, users.length),
				}),
	);

function userSignedAction(net: "mainnet" | "testnet", nonce: number) {
	return fc
		.constantFrom(...USER_SIGNED_SPECS.map((s) => s.actionType))
		.chain((type) => {
			const spec = userSignedSpec(type) as NonNullable<
				ReturnType<typeof userSignedSpec>
			>;
			const fields: Record<string, fc.Arbitrary<unknown>> = {};
			for (const f of spec.fields) {
				if (f.name === "hyperliquidChain") continue;
				if (f.name === spec.nonceField) fields[f.name] = fc.constant(nonce);
				else if (f.name === "signers") fields[f.name] = signersJson;
				else if (f.type === "string")
					fields[f.name] = fc.oneof(
						fc.string({ maxLength: 20 }),
						decimal,
						address,
					);
				else if (f.type === "address") fields[f.name] = address;
				else if (f.type === "bool") fields[f.name] = fc.boolean();
				else if (f.type === "uint32")
					fields[f.name] = fc.integer({ min: 0, max: 2 ** 32 - 1 });
				else if (f.type === "uint64")
					fields[f.name] = fc.oneof(
						fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
						fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }),
					);
				else if (f.type === "bytes")
					fields[f.name] = fc
						.uint8Array({ maxLength: 8 })
						.map(
							(u) =>
								`0x${Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("")}`,
						);
				else throw new Error(`unhandled type ${f.type}`);
			}
			return fc.record(fields).map((values) => ({
				type,
				signatureChainId: "0x66eee",
				hyperliquidChain: net === "mainnet" ? "Mainnet" : "Testnet",
				...values,
			}));
		});
}

const scenario = fc
	.tuple(
		network,
		fc.integer({ min: NOW - 3600_000, max: NOW + 3600_000 }),
		fc.constantFrom("0x66eee", "0xa4b1", "0x1"),
	)
	.chain(([net, nonce, sigChain]) =>
		fc.record({
			net: fc.constant(net),
			nonce: fc.constant(nonce),
			sigChain: fc.constant(sigChain),
			action: fc.oneof(l1Action, userSignedAction(net, nonce)),
			treasury: fc.integer({ min: 0, max: 5 }),
			leader: fc.integer({ min: 0, max: 5 }),
			signers: fc.uniqueArray(fc.integer({ min: 0, max: 5 }), {
				minLength: 1,
				maxLength: 4,
			}),
			vault: fc.option(address, { nil: null }),
			expires: fc.option(fc.integer({ min: NOW + 1, max: NOW + 10 ** 8 }), {
				nil: null,
			}),
		}),
	)
	.filter((s) => s.treasury !== s.leader);

// ---------------------------------------------------------------- the oracle

describe(`oracle vs @nktkas/hyperliquid (${RUNS} runs, seed ${SEED})`, () => {
	it("inner and envelope signatures are byte-identical to the SDK's", async () => {
		await fc.assert(
			fc.asyncProperty(scenario, async (s) => {
				const r = createProposal(
					{
						network: s.net,
						multiSigUser: ADDRESSES[s.treasury] as string,
						outerSigner: ADDRESSES[s.leader] as string,
						action: s.action,
						nonce: s.nonce,
						vaultAddress: s.vault,
						expiresAfter: s.expires,
					},
					{ now: NOW },
				);
				expect(
					r.issues.filter((i) => i.severity === "error"),
					JSON.stringify(s.action, (_k, v) =>
						typeof v === "bigint" ? `${v}n` : v,
					),
				).toEqual([]);
				const p = r.proposal as Proposal;
				const isTestnet = s.net === "testnet";
				const treasury = p.payload.multiSigUser;
				const leader = p.payload.outerSigner;
				const userSigned = p.meta.kind === "user-signed";
				const innerSigs = [];
				for (const i of s.signers) {
					const ours = await signProposal(p, viemSigner(account(i)));
					expect(ours.issues).toEqual([]);
					const sig = ours.signature as NonNullable<typeof ours.signature>;
					expect(sig.signer).toBe(ADDRESSES[i]);
					const theirs = userSigned
						? await signUserSignedAction({
								wallet: account(i),
								action: {
									...p.payload.action,
									payloadMultiSigUser: treasury,
									outerSigner: leader,
								} as never,
								types: {
									[(
										userSignedSpec(
											p.payload.action.type as string,
										) as NonNullable<ReturnType<typeof userSignedSpec>>
									).primaryType]: (
										userSignedSpec(
											p.payload.action.type as string,
										) as NonNullable<ReturnType<typeof userSignedSpec>>
									).fields.map((f) => ({ ...f })),
								},
							})
						: await signL1Action({
								wallet: account(i),
								action: [treasury, leader, p.payload.action] as never,
								nonce: p.payload.nonce,
								isTestnet,
								vaultAddress: p.payload.vaultAddress ?? undefined,
								expiresAfter: p.payload.expiresAfter ?? undefined,
							});
					expect(trimSig({ r: sig.r, s: sig.s, v: sig.v })).toEqual(
						trimSig(theirs as never),
					);
					expect(await recoverInnerSigner(p.digest, theirs as never)).toBe(
						ADDRESSES[i],
					);
					innerSigs.push(sig);
				}
				const withSigs = { ...p, signatures: innerSigs };
				const { request } = buildEnvelope(withSigs, {
					signatureChainId: s.sigChain as `0x${string}`,
				});
				const ourOuter = await signEnvelope(
					request,
					s.net,
					viemSigner(account(s.leader)),
				);
				expect(ourOuter.issues).toEqual([]);
				const theirOuter = await signMultiSigAction({
					wallet: account(s.leader),
					action: canonicalEnvelopeAction(request) as never,
					nonce: p.payload.nonce,
					isTestnet,
					vaultAddress: p.payload.vaultAddress ?? undefined,
					expiresAfter: p.payload.expiresAfter ?? undefined,
				});
				expect(trimSig(ourOuter.signature as never)).toEqual(
					trimSig(theirOuter as never),
				);
			}),
			{ numRuns: RUNS, seed: SEED, endOnFailure: true },
		);
	}, 600_000);
});
