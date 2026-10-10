import { describe, expect, it } from "vitest";
import type { Address } from "../../src/identity.ts";
import type { PlainJson } from "../../src/json.ts";
import {
	diagnoseSignature,
	type ProposalPayload,
	SECP256K1_N,
	ZERO_ADDRESS,
} from "../../src/multisig/index.ts";
import { DIAGNOSE_MAX_ATTEMPTS } from "../../src/rules/multisig.ts";
import {
	A,
	B,
	C,
	NONCE,
	NOW,
	ORDER,
	POLICY,
	payload,
	proposalOf,
	SPARE,
	signatureBy,
	usdSend,
	userPayload,
	VAULT,
} from "./_helpers.ts";

const base = payload({ vaultAddress: VAULT, expiresAfter: NOW + 1000 });
const signedAs = async (variant: ProposalPayload, claimedAs = 2) =>
	signatureBy(variant, claimedAs);

describe("diagnoseSignature (L1)", () => {
	it("diag.matches", async () => {
		const d = await diagnoseSignature(
			await signedAs(base),
			proposalOf(base),
			POLICY,
		);
		expect(d).toEqual({
			cause: "matches",
			recovered: B,
			detail: "The signature matches the proposal.",
			attempts: 1,
		});
	});
	it("diag.other-network", async () => {
		const d = await diagnoseSignature(
			await signedAs({ ...base, network: "mainnet" }),
			proposalOf(base),
			POLICY,
		);
		expect(d.cause).toBe("other-network");
		expect(d.detail).toContain("mainnet");
	});
	it("diag.leader-swapped (lab neg-B-signed-for-lead-C)", async () => {
		const d = await diagnoseSignature(
			await signedAs({ ...base, outerSigner: C }),
			proposalOf(base),
			POLICY,
		);
		expect(d.cause).toBe("other-leader");
		expect(d.detail).toContain(C);
		// without a policy the candidate must be supplied
		expect(
			(
				await diagnoseSignature(
					await signedAs({ ...base, outerSigner: C }),
					proposalOf(base),
					null,
				)
			).cause,
		).toBe("unknown");
		expect(
			(
				await diagnoseSignature(
					await signedAs({ ...base, outerSigner: SPARE }),
					proposalOf(base),
					null,
					{ candidateLeaders: [SPARE] },
				)
			).cause,
		).toBe("other-leader");
	});
	it("diag.nonce-minus-1 and plus-2 (lab neg-B-signed-different-nonce)", async () => {
		expect(
			(
				await diagnoseSignature(
					await signedAs({ ...base, nonce: NONCE - 1 }),
					proposalOf(base),
					POLICY,
				)
			).cause,
		).toBe("other-nonce");
		const d = await diagnoseSignature(
			await signedAs({ ...base, nonce: NONCE + 2 }),
			proposalOf(base),
			POLICY,
		);
		expect(d.cause).toBe("other-nonce");
		expect(d.detail).toContain("(+2)");
	});
	it("diag.vault-omitted and diag.expires-omitted (lab §7)", async () => {
		expect(
			(
				await diagnoseSignature(
					await signedAs({ ...base, vaultAddress: null }),
					proposalOf(base),
					POLICY,
				)
			).cause,
		).toBe("vault-omitted");
		expect(
			(
				await diagnoseSignature(
					await signedAs({ ...base, expiresAfter: null }),
					proposalOf(base),
					POLICY,
				)
			).cause,
		).toBe("expires-omitted");
	});
	it("diag.non-canonical-action when the original is supplied", async () => {
		const original = {
			grouping: "na",
			orders: ORDER.orders as PlainJson,
			type: "order",
		};
		const sig = await signedAs({ ...base, action: original });
		expect((await diagnoseSignature(sig, proposalOf(base), POLICY)).cause).toBe(
			"unknown",
		);
		expect(
			(
				await diagnoseSignature(sig, proposalOf(base), POLICY, {
					originalAction: original,
				})
			).cause,
		).toBe("non-canonical-action");
	});
	it("diag.action-differs → unknown with the baseline recovery", async () => {
		const other = {
			...base,
			action: {
				...ORDER,
				orders: [{ ...(ORDER.orders as object[])[0], p: "50001" }],
			},
		};
		const d = await diagnoseSignature(
			await signedAs(other),
			proposalOf(base),
			POLICY,
		);
		expect(d.cause).toBe("unknown");
		expect(d.recovered).toMatch(/^0x/);
		expect(d.recovered).not.toBe(B);
		expect(d.detail).toContain(d.recovered as string);
	});
	it("diag.unrecoverable signature", async () => {
		const d = await diagnoseSignature(
			{
				signer: B,
				r: `0x${SECP256K1_N.toString(16)}`,
				s: "0x1",
				v: 27,
				at: null,
			},
			proposalOf(base),
			POLICY,
		);
		expect(d.cause).toBe("unknown");
		expect(d.recovered).toBeNull();
		expect(d.detail).toContain("nothing");
	});
	it("diag.bounded-cost: the search stops at the budget", async () => {
		const many = Array.from(
			{ length: 60 },
			(_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address,
		);
		const sig = await signedAs({
			...base,
			action: { ...ORDER, grouping: "normalTpsl" },
		});
		const d = await diagnoseSignature(sig, proposalOf(base), POLICY, {
			candidateLeaders: many,
		});
		expect(d.cause).toBe("unknown");
		expect(d.attempts).toBe(DIAGNOSE_MAX_ATTEMPTS);
		const small = await diagnoseSignature(sig, proposalOf(base), POLICY, {
			candidateLeaders: many,
			maxAttempts: 3,
		});
		expect(small.attempts).toBe(3);
	});
	it("diag.mainnet-base: the other-network variant of a mainnet proposal is testnet", async () => {
		const main = { ...base, network: "mainnet" as const };
		const d = await diagnoseSignature(
			await signedAs({ ...main, network: "testnet" }),
			proposalOf(main),
			POLICY,
		);
		expect(d.cause).toBe("other-network");
		expect(d.detail).toContain("testnet");
	});
	it("diag.unhashable-variant: a variant that cannot be hashed is skipped, not fatal", async () => {
		const zero = { ...base, nonce: 0, expiresAfter: null, vaultAddress: null };
		const d = await diagnoseSignature(
			await signedAs({ ...zero, action: { ...ORDER, grouping: "normalTpsl" } }),
			proposalOf(zero),
			POLICY,
		);
		expect(d.cause).toBe("unknown");
		expect(d.attempts).toBeGreaterThan(5);
	});
	it("diag.unclaimed: with a zero-address claimed signer, a variant matches when it recovers to any authorized user", async () => {
		const unclaimed = async (variant: typeof base) => ({
			...(await signatureBy(variant, 2)),
			signer: ZERO_ADDRESS,
		});
		expect(
			(await diagnoseSignature(await unclaimed(base), proposalOf(base), POLICY))
				.cause,
		).toBe("matches");
		const d = await diagnoseSignature(
			await unclaimed({ ...base, nonce: NONCE - 1 }),
			proposalOf(base),
			POLICY,
		);
		expect(d.cause).toBe("other-nonce");
		expect(d.detail).toContain(B);
		// an outsider's signature matches no variant
		expect(
			(
				await diagnoseSignature(
					{ ...(await signatureBy(base, 4)), signer: ZERO_ADDRESS },
					proposalOf(base),
					POLICY,
				)
			).cause,
		).toBe("unknown");
		// without a policy there is nothing to match against
		const np = await diagnoseSignature(
			await unclaimed({ ...base, nonce: NONCE - 1 }),
			proposalOf(base),
			null,
		);
		expect(np.cause).toBe("unknown");
		expect(np.detail).toContain("no signer set");
		expect(np.attempts).toBe(1);
	});
	it("diag.claimed-signer-is-the-key: a signature by A claimed as B never 'matches'", async () => {
		const sig = { ...(await signatureBy(base, 1)), signer: B };
		const d = await diagnoseSignature(sig, proposalOf(base), POLICY);
		expect(d.cause).toBe("unknown");
		expect(d.recovered).toBe(A);
	});
});

describe("diagnoseSignature (user-signed)", () => {
	const ub = userPayload();
	it("diag.other-network flips network and hyperliquidChain together", async () => {
		const d = await diagnoseSignature(
			await signedAs({
				...ub,
				network: "mainnet",
				action: usdSend(NONCE, "mainnet"),
			}),
			proposalOf(ub),
			POLICY,
		);
		expect(d.cause).toBe("other-network");
	});
	it("diag.chain-string-only: a wrong hyperliquidChain string is the same divergence as the other network", async () => {
		const d = await diagnoseSignature(
			await signedAs({
				...ub,
				action: { ...ub.action, hyperliquidChain: "Mainnet" },
			}),
			proposalOf(ub),
			POLICY,
		);
		expect(d.cause).toBe("other-network");
		expect(d.detail).toContain('hyperliquidChain "Mainnet"');
	});
	it("diag.other-nonce moves the inner time with the nonce", async () => {
		const d = await diagnoseSignature(
			await signedAs({
				...ub,
				nonce: NONCE + 1,
				action: { ...ub.action, time: NONCE + 1 },
			}),
			proposalOf(ub),
			POLICY,
		);
		expect(d.cause).toBe("other-nonce");
	});
	it("diag.user-signed-nonce-not-in-digest: payload.nonce is bound only through the action's time field", async () => {
		const skewed = { ...ub, action: { ...ub.action, time: NONCE - 5000 } };
		const sig = await signedAs({ ...skewed, nonce: NONCE - 5000 });
		expect(
			(await diagnoseSignature(sig, proposalOf(skewed), POLICY)).cause,
		).toBe("matches");
	});
	it("diag.other-signature-chain-id", async () => {
		const d = await diagnoseSignature(
			await signedAs({
				...ub,
				action: { ...ub.action, signatureChainId: "0xa4b1" },
			}),
			proposalOf(ub),
			POLICY,
		);
		expect(d.cause).toBe("other-signature-chain-id");
		expect(d.detail).toContain("0xa4b1");
		const d1 = await diagnoseSignature(
			await signedAs({
				...ub,
				action: { ...ub.action, signatureChainId: "0x1" },
			}),
			proposalOf(ub),
			POLICY,
		);
		expect(d1.cause).toBe("other-signature-chain-id");
	});
	it("diag.nonce-field-named-nonce (approveAgent) is handled too", async () => {
		const approve = {
			...ub,
			action: {
				type: "approveAgent",
				signatureChainId: "0x66eee",
				hyperliquidChain: "Testnet",
				agentAddress: SPARE,
				agentName: "x",
				nonce: NONCE,
			},
		};
		const d = await diagnoseSignature(
			await signedAs({
				...approve,
				nonce: NONCE - 1,
				action: { ...approve.action, nonce: NONCE - 1 },
			}),
			proposalOf(approve),
			POLICY,
		);
		expect(d.cause).toBe("other-nonce");
	});
});
