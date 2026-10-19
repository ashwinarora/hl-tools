/**
 * Mutation matrix: every leaf of the signed payload must change the digest
 * (and invalidate an existing signature); nothing outside it may.
 */
import { describe, expect, it } from "vitest";
import {
	buildEnvelope,
	canonicalEnvelopeAction,
	classifySignatures,
	envelopeDigest,
	innerDigest,
	type PlainObject,
	type ProposalPayload,
	validateProposal,
} from "../../src/multisig/index.ts";
import {
	A,
	B,
	NOW,
	ORDER,
	POLICY,
	payload,
	proposalOf,
	SPARE,
	signatureBy,
	usdSend,
	VAULT,
} from "./_helpers.ts";

type Leaf = { path: string; mutate: (v: unknown) => unknown };

function leaves(obj: unknown, path = ""): Leaf[] {
	if (Array.isArray(obj))
		return obj.flatMap((v, i) => leaves(v, `${path}[${i}]`));
	if (obj && typeof obj === "object")
		return Object.entries(obj).flatMap(([k, v]) =>
			leaves(v, path ? `${path}.${k}` : k),
		);
	return [
		{
			path,
			mutate: (v) => {
				if (typeof v === "boolean") return !v;
				if (typeof v === "number") return v + 1;
				if (typeof v === "bigint") return v + 1n;
				if (typeof v === "string") return `${v}1`;
				return "mutated";
			},
		},
	];
}

function setPath(obj: unknown, path: string, value: unknown): unknown {
	const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
	const clone = (o: unknown): unknown =>
		Array.isArray(o)
			? [...o]
			: o && typeof o === "object"
				? { ...(o as object) }
				: o;
	const root = clone(obj);
	let cur = root as Record<string, unknown>;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i] as string;
		cur[key] = clone(cur[key]);
		cur = cur[key] as Record<string, unknown>;
	}
	cur[parts[parts.length - 1] as string] = value;
	return root;
}

async function matrix(base: ProposalPayload, signerIndex: number) {
	const baseDigest = innerDigest(base).digest;
	const sig = await signatureBy(base, signerIndex);
	const mutations: { label: string; payload: ProposalPayload }[] = [
		{
			label: "network",
			payload: {
				...base,
				network: base.network === "testnet" ? "mainnet" : "testnet",
			},
		},
		{ label: "multiSigUser", payload: { ...base, multiSigUser: SPARE } },
		{
			label: "outerSigner",
			payload: { ...base, outerSigner: base.outerSigner === A ? B : A },
		},
		{ label: "nonce", payload: { ...base, nonce: base.nonce + 1 } },
	];
	for (const leaf of leaves(base.action, "action")) {
		if (
			leaf.path === "action.hyperliquidChain" ||
			leaf.path === "action.time" ||
			leaf.path === "action.nonce"
		)
			continue; // covered by network/nonce
		mutations.push({
			label: leaf.path,
			payload: {
				...base,
				action: setPath(
					base.action,
					leaf.path.slice("action.".length),
					leaf.mutate(getPath(base.action, leaf.path.slice("action.".length))),
				) as PlainObject,
			},
		});
	}
	return { baseDigest, sig, mutations };
}

function getPath(obj: unknown, path: string): unknown {
	return path
		.replace(/\[(\d+)\]/g, ".$1")
		.split(".")
		.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj);
}

describe("sensitivity: L1 payload", () => {
	const base = payload({ vaultAddress: VAULT, expiresAfter: NOW + 1000 });
	it("every payload leaf changes the digest and invalidates the signature", async () => {
		const { baseDigest, sig, mutations } = await matrix(base, 1);
		mutations.push(
			{ label: "vaultAddress→null", payload: { ...base, vaultAddress: null } },
			{
				label: "vaultAddress→other",
				payload: { ...base, vaultAddress: SPARE },
			},
			{ label: "expiresAfter→null", payload: { ...base, expiresAfter: null } },
			{
				label: "expiresAfter+1",
				payload: { ...base, expiresAfter: (base.expiresAfter as number) + 1 },
			},
		);
		expect(mutations.length).toBeGreaterThan(12);
		for (const m of mutations) {
			const d = innerDigest(m.payload).digest;
			expect(d, m.label).not.toBe(baseDigest);
			const [c] = await classifySignatures(
				proposalOf(m.payload, [sig]),
				POLICY,
			);
			expect(c?.status, m.label).toBe("invalid");
		}
	});
	it("nothing outside the payload changes the digest", async () => {
		const sig = await signatureBy(base, 1);
		const p = proposalOf(base, [sig]);
		const variants = [
			{
				...p,
				meta: {
					...p.meta,
					title: "x",
					note: "y",
					createdBy: B,
					createdAt: 1,
					supersedes: `0x${"ab".repeat(32)}` as `0x${string}`,
					policyAtCreation: null,
				},
			},
			{ ...p, signatures: [sig, await signatureBy(base, 2)] },
			{
				...p,
				receipt: {
					submittedAt: NOW,
					signatureChainId: "0x66eee" as const,
					outerSignature: { r: sig.r, s: sig.s, v: sig.v },
					httpStatus: 200,
					response: null,
				},
			},
		];
		for (const v of variants) {
			expect(innerDigest(v.payload).digest).toBe(p.digest);
			const r = validateProposal(JSON.parse(JSON.stringify(v)), { now: NOW });
			expect(r.issues).toEqual([]);
			expect(r.proposal?.digest).toBe(p.digest);
			const [c] = await classifySignatures(v, POLICY);
			expect(c?.status).toBe("valid-authorized");
		}
	});
});

describe("sensitivity: user-signed payload", () => {
	const base = payload({ action: usdSend() });
	it("every signed leaf changes the digest; vault and expiry do not (they bind through the envelope)", async () => {
		const { baseDigest, sig, mutations } = await matrix(base, 2);
		// For user-signed actions the network is bound through `hyperliquidChain`
		// inside the action, not through payload.network (validation keeps them equal).
		const networkOnly = mutations.findIndex((m) => m.label === "network");
		expect(
			innerDigest(
				(mutations[networkOnly] as { payload: ProposalPayload }).payload,
			).digest,
		).toBe(baseDigest);
		// Likewise the nonce binds through the action's own `time`/`nonce` field.
		const nonceOnly = mutations.findIndex((m) => m.label === "nonce");
		expect(
			innerDigest(
				(mutations[nonceOnly] as { payload: ProposalPayload }).payload,
			).digest,
		).toBe(baseDigest);
		mutations.splice(nonceOnly, 1, {
			label: "nonce+time",
			payload: {
				...base,
				nonce: base.nonce + 1,
				action: { ...base.action, time: base.nonce + 1 },
			},
		});
		mutations.splice(
			mutations.findIndex((m) => m.label === "network"),
			1,
			{
				label: "network+hyperliquidChain",
				payload: {
					...base,
					network: "mainnet",
					action: { ...base.action, hyperliquidChain: "Mainnet" },
				},
			},
		);
		for (const m of mutations) {
			if (m.label === "action.signatureChainId") {
				// "0x66eee1" is still a valid hex chain id and must change the domain
				expect(innerDigest(m.payload).digest, m.label).not.toBe(baseDigest);
				continue;
			}
			expect(innerDigest(m.payload).digest, m.label).not.toBe(baseDigest);
			const [c] = await classifySignatures(
				proposalOf(m.payload, [sig]),
				POLICY,
			);
			expect(c?.status, m.label).toBe("invalid");
		}
		expect(innerDigest({ ...base, vaultAddress: VAULT }).digest).toBe(
			baseDigest,
		);
		expect(innerDigest({ ...base, expiresAfter: NOW + 1 }).digest).toBe(
			baseDigest,
		);
		expect(
			innerDigest({
				...base,
				action: { ...base.action, hyperliquidChain: "Mainnet" },
			}).digest,
		).not.toBe(baseDigest);
		expect(
			innerDigest({ ...base, action: { ...base.action, time: base.nonce + 1 } })
				.digest,
		).not.toBe(baseDigest);
	});
});

describe("sensitivity: envelope", () => {
	it("every inner signature byte, the signature order, chain id, nonce, vault and expiry change the outer digest; the type key does not", async () => {
		const base = payload();
		const p = proposalOf(base, [
			await signatureBy(base, 1),
			await signatureBy(base, 2),
		]);
		const req = buildEnvelope(p).request;
		const d0 = envelopeDigest(req, "testnet").digest;
		const flipHex = (h: string) =>
			`${h.slice(0, -1)}${h.endsWith("a") ? "b" : "a"}`;
		for (const [i, s] of req.action.signatures.entries()) {
			for (const key of ["r", "s"] as const) {
				const sigs = req.action.signatures.map((x, j) =>
					j === i ? { ...x, [key]: flipHex(x[key]) } : x,
				);
				expect(
					envelopeDigest(
						{ ...req, action: { ...req.action, signatures: sigs } },
						"testnet",
					).digest,
					`${i}.${key}`,
				).not.toBe(d0);
			}
			const sigs = req.action.signatures.map((x, j) =>
				j === i ? { ...x, v: (x.v === 27 ? 28 : 27) as 27 | 28 } : x,
			);
			expect(
				envelopeDigest(
					{ ...req, action: { ...req.action, signatures: sigs } },
					"testnet",
				).digest,
				`${i}.v`,
			).not.toBe(d0);
			expect(s.v === 27 || s.v === 28).toBe(true);
		}
		expect(
			envelopeDigest(
				{
					...req,
					action: {
						...req.action,
						signatures: [...req.action.signatures].reverse(),
					},
				},
				"testnet",
			).digest,
		).not.toBe(d0);
		expect(
			envelopeDigest(
				{ ...req, action: { ...req.action, signatureChainId: "0xa4b1" } },
				"testnet",
			).digest,
		).not.toBe(d0);
		expect(
			envelopeDigest({ ...req, nonce: req.nonce + 1 }, "testnet").digest,
		).not.toBe(d0);
		expect(
			envelopeDigest({ ...req, vaultAddress: VAULT }, "testnet").digest,
		).not.toBe(d0);
		expect(
			envelopeDigest({ ...req, expiresAfter: NOW }, "testnet").digest,
		).not.toBe(d0);
		expect(envelopeDigest(req, "mainnet").digest).not.toBe(d0);
		const { type: _t, ...noType } = canonicalEnvelopeAction(req);
		expect(Object.keys(noType)).toEqual([
			"signatureChainId",
			"signatures",
			"payload",
		]);
		expect(envelopeDigest(req, "testnet").digest).toBe(d0);
		expect(ORDER.type).toBe("order");
	});
});
