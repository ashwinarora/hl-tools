import { describe, expect, it } from "vitest";
import {
	classifySignatures,
	leaderStatus,
	type Policy,
	readiness,
} from "../../src/multisig/index.ts";
import { POLICY_STALE_MS } from "../../src/rules/multisig.ts";
import {
	A,
	B,
	C,
	codes,
	NONCE,
	NOW,
	OUTSIDER,
	POLICY,
	payload,
	proposalOf,
	signatureBy,
	TREASURY,
} from "./_helpers.ts";

const DAY = 24 * 3600 * 1000;
const p = payload();

async function ready(
	signers: number[],
	policy: Policy | null = POLICY,
	now = NOW,
	over: Partial<ReturnType<typeof payload>> = {},
) {
	const pl = { ...p, ...over };
	const prop = proposalOf(
		pl,
		await Promise.all(signers.map((i) => signatureBy(pl, i))),
	);
	const classified = await classifySignatures(prop, policy);
	return readiness(prop, policy, classified, { now });
}

describe("leaderStatus", () => {
	it("authorized / not-authorized / needs-lookup", () => {
		expect(leaderStatus(proposalOf(p), POLICY)).toBe("authorized");
		expect(
			leaderStatus(proposalOf({ ...p, outerSigner: TREASURY }), POLICY),
		).toBe("not-authorized");
		expect(
			leaderStatus(proposalOf({ ...p, outerSigner: OUTSIDER }), POLICY),
		).toBe("needs-lookup");
	});
});

describe("readiness", () => {
	it("ready.threshold-met-exact", async () => {
		const r = await ready([1, 2]);
		expect(r.status).toBe("ready");
		expect(r.have).toBe(2);
		expect(r.need).toBe(2);
		expect(r.counted).toEqual([A, B]);
		expect(r.missing).toEqual([C]);
		expect(r.leader).toBe("authorized");
		expect(r.issues).toEqual([]);
		expect(r.validFrom).toBe(NONCE - DAY);
		expect(r.validUntil).toBe(NONCE + 2 * DAY);
	});
	it("ready.extra-signatures-ok", async () => {
		const r = await ready([1, 2, 3]);
		expect(r.status).toBe("ready");
		expect(r.have).toBe(3);
		expect(r.missing).toEqual([]);
	});
	it("ready.below-threshold-missing-list", async () => {
		const r = await ready([2]);
		expect(r.status).toBe("not-ready");
		expect(r.have).toBe(1);
		expect(r.missing).toEqual([A, C].sort());
	});
	it("ready.duplicates-and-outsiders-not-counted", async () => {
		const r = await ready([1, 1, 4]);
		expect(r.status).toBe("not-ready");
		expect(r.have).toBe(1);
	});
	it("ready.signer-removed-since-signing: the vote drops", async () => {
		const smaller: Policy = { ...POLICY, authorizedUsers: [B, C].sort() };
		const r = await ready([1, 2], smaller);
		expect(r.status).toBe("not-ready");
		expect(r.counted).toEqual([B]);
	});
	it("ready.threshold-raised-since", async () => {
		const r = await ready([1, 2], { ...POLICY, threshold: 3 });
		expect(r.status).toBe("not-ready");
		expect(r.need).toBe(3);
	});
	it("ready.policy-null → unknown", async () => {
		const r = await ready([1, 2], null);
		expect(r.status).toBe("unknown");
		expect(r.need).toBeNull();
		expect(r.leader).toBeNull();
		expect(r.have).toBe(0);
		expect(codes(r.issues)).toEqual(["policy.unknown"]);
	});
	it("ready.policy-reverted → not-multisig", async () => {
		for (const pol of [
			{ ...POLICY, authorizedUsers: [] },
			{ ...POLICY, threshold: 0 },
		]) {
			const r = await ready([1, 2], pol);
			expect(r.status).toBe("not-multisig");
			expect(codes(r.issues)).toEqual(["policy.not_multisig"]);
		}
	});
	it("ready.stale-policy-warning", async () => {
		const r = await ready([1, 2], {
			...POLICY,
			observedAt: NOW - POLICY_STALE_MS - 1,
		});
		expect(r.status).toBe("ready");
		expect(codes(r.issues)).toEqual(["policy.stale"]);
	});
	it("ready.leader-not-authorized blocks even with enough signatures", async () => {
		const r = await ready([1, 2], POLICY, NOW, { outerSigner: TREASURY });
		expect(r.status).toBe("not-ready");
		expect(r.leader).toBe("not-authorized");
		expect(codes(r.issues)).toEqual(["leader.not_authorized"]);
	});
	it("ready.leader-needs-lookup is a warning, not a block", async () => {
		const r = await ready([1, 2], POLICY, NOW, { outerSigner: OUTSIDER });
		expect(r.status).toBe("ready");
		expect(r.leader).toBe("needs-lookup");
		expect(codes(r.issues)).toEqual(["leader.needs_lookup"]);
	});
	it("ready.leader-need-not-sign", async () => {
		const r = await ready([1, 2], POLICY, NOW, { outerSigner: C });
		expect(r.status).toBe("ready");
	});
	it("ready.expired by nonce window and by expiresAfter", async () => {
		const late = await ready([1, 2], POLICY, NONCE + 2 * DAY);
		expect(late.status).toBe("expired");
		expect(late.issues.map((i) => i.message)).toContain(
			"The nonce window has closed.",
		);
		const exp = await ready([1, 2], POLICY, NOW + 10, {
			expiresAfter: NOW + 5,
		});
		expect(exp.status).toBe("expired");
		expect(exp.issues.map((i) => i.message)).toContain(
			"expiresAfter has passed.",
		);
	});
	it("ready.not-yet-valid for a future-dated nonce", async () => {
		const r = await ready([1, 2], POLICY, NONCE - DAY - 1);
		expect(r.status).toBe("not-yet-valid");
	});
	it("ready.clock-defaults-to-now", async () => {
		const prop = proposalOf({ ...p, nonce: Date.now() }, []);
		const r = readiness(prop, POLICY, [], {});
		expect(r.status).toBe("not-ready");
		expect(
			readiness(prop, { ...POLICY, observedAt: Date.now() }, []).issues,
		).toEqual([]);
	});
	it("ready.user-signed proposal", async () => {
		const r = await ready([1, 3], POLICY, NOW, {
			action: {
				type: "usdSend",
				signatureChainId: "0x66eee",
				hyperliquidChain: "Testnet",
				destination: A,
				amount: "1",
				time: NONCE,
			},
		});
		expect(r.status).toBe("ready");
	});
});
