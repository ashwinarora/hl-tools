import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildEnvelope,
	checkReceipt,
	classifySignatures,
	createProposal,
	envelopeDigest,
	type Proposal,
	type ProposalSignature,
	padSig,
	type Receipt,
	recoverInnerSigner,
} from "../../src/multisig/index.ts";
import {
	ADDRESSES,
	NOW,
	POLICY,
	proposalOf,
	signatureBy,
	signDigest,
	userPayload,
} from "./_helpers.ts";

const CHAIN = "0x66eee" as const;
const SENT = NOW + 5_000;

/** A receipt as the finaliser's page makes it: the request built from what counts, signed by `by`. */
async function receiptFor(
	p: Proposal,
	by = 1,
	over: Partial<Receipt> = {},
): Promise<Receipt> {
	const classified = await classifySignatures(p, POLICY);
	const { request } = buildEnvelope(p, {
		signatureChainId: CHAIN,
		classified,
	});
	const digest = envelopeDigest(request, p.payload.network).digest;
	return {
		submittedAt: SENT,
		signatureChainId: CHAIN,
		outerSignature: await signDigest(digest as `0x${string}`, by),
		httpStatus: 200,
		response: { status: "ok", response: { type: "default" } },
		...over,
	};
}

const signed = async (...by: number[]): Promise<ProposalSignature[]> =>
	Promise.all(by.map((i) => signatureBy(userPayload(), i)));

describe("whose word a receipt is", () => {
	it("the finaliser's, when its signature is over this proposal's submission", async () => {
		const p = proposalOf(userPayload(), await signed(1, 2));
		expect(await checkReceipt(p, await receiptFor(p))).toBe("finaliser");
		// a submission with no signature in it is one too (Hyperliquid refuses it)
		const bare = proposalOf(userPayload());
		expect(await checkReceipt(bare, await receiptFor(bare))).toBe("finaliser");
	});

	it("nobody's, when another key signed it or it belongs to another proposal", async () => {
		const p = proposalOf(userPayload(), await signed(1, 2));
		// a co-signer writes "accepted" into a copy and signs it themselves
		expect(await checkReceipt(p, await receiptFor(p, 2))).toBe("unverified");
		// the finaliser's real receipt for another proposal, pasted into this one
		const other = proposalOf(
			userPayload({ nonce: p.payload.nonce + 1 }),
			await Promise.all([
				signatureBy(userPayload({ nonce: p.payload.nonce + 1 }), 1),
			]),
		);
		expect(await checkReceipt(p, await receiptFor(other))).toBe("unverified");
		// signed under another chain id than the receipt names
		const real = await receiptFor(p);
		expect(await checkReceipt(p, { ...real, signatureChainId: "0xa4b1" })).toBe(
			"unverified",
		);
	});

	it("still the finaliser's in a copy that gained a signature since", async () => {
		const [a, b] = await signed(1, 2);
		const sent = proposalOf(userPayload(), [
			a as ProposalSignature,
			b as ProposalSignature,
		]);
		const receipt = await receiptFor(sent);
		// C signed a moment after the submission
		const late = await signatureBy(userPayload(), 3, SENT + 1);
		const later = { ...sent, signatures: [...sent.signatures, late] };
		expect(await checkReceipt(later, receipt)).toBe("finaliser");
		// and with no dates to go by: the selections are tried
		const undated = {
			...sent,
			signatures: [...sent.signatures, late].map((s) => ({ ...s, at: null })),
		};
		expect(await checkReceipt(undated, receipt)).toBe("finaliser");
		// one that was in the submission and is no longer in the copy cannot be put back
		const without = { ...sent, signatures: [a as ProposalSignature] };
		expect(await checkReceipt(without, receipt)).toBe("unverified");
	});

	it("still the finaliser's in a copy that holds the signatures in another order", async () => {
		const [a, b, c] = await signed(1, 2, 3);
		const sent = proposalOf(userPayload(), [
			a as ProposalSignature,
			b as ProposalSignature,
			c as ProposalSignature,
		]);
		const receipt = await receiptFor(sent);
		const turned = {
			...sent,
			signatures: [
				c as ProposalSignature,
				a as ProposalSignature,
				b as ProposalSignature,
			],
		};
		expect(await checkReceipt(turned, receipt)).toBe("finaliser");
	});

	it("looks only at signatures that are what they say, one per signer", async () => {
		const [a, b] = await signed(1, 2);
		const sent = proposalOf(userPayload(), [
			a as ProposalSignature,
			b as ProposalSignature,
		]);
		const receipt = await receiptFor(sent);
		const noisy = {
			...sent,
			signatures: [
				// B's signature filed under an outsider: never sent, never tried
				{ ...(b as ProposalSignature), signer: ADDRESSES[4] as never },
				a as ProposalSignature,
				a as ProposalSignature,
				b as ProposalSignature,
			],
		};
		expect(await checkReceipt(noisy, receipt)).toBe("finaliser");
		// signatures a merge has just recovered are taken as they are
		expect(
			await checkReceipt(sent, receipt, {
				signatures: sent.signatures,
				verified: true,
			}),
		).toBe("finaliser");
	});

	it("stops at its budget, in either round", async () => {
		const [a, b, c] = (await signed(1, 2, 3)) as [
			ProposalSignature,
			ProposalSignature,
			ProposalSignature,
		];
		const copy = proposalOf(userPayload(), [a, b, c]);
		const sortedKey = [a, b, c]
			.sort((x, y) => (x.signer < y.signer ? -1 : 1))
			.map((s) => s.signer)
			.join();
		// an order no selection gives: not the copy's, not with the finaliser's
		// (A's) last, not the sorted one
		const sentOrder = (
			[
				[a, c, b],
				[b, a, c],
				[c, a, b],
			] as ProposalSignature[][]
		).find((o) => o.map((s) => s.signer).join() !== sortedKey);
		const sent = proposalOf(userPayload(), sentOrder as ProposalSignature[]);
		const receipt = await receiptFor(sent);
		expect(await checkReceipt(copy, receipt)).toBe("finaliser");
		// the least budget that finds it, and one less: the round of every order
		let least = 0;
		while (
			(await checkReceipt(copy, receipt, { budget: least })) !== "finaliser"
		)
			least += 1;
		expect(least).toBeGreaterThan(8);
		expect(await checkReceipt(copy, receipt, { budget: least - 1 })).toBe(
			"unverified",
		);
		// and far too little: it stops among the selections
		expect(await checkReceipt(copy, receipt, { budget: 3 })).toBe("unverified");
		expect(await checkReceipt(copy, receipt, { budget: 0 })).toBe("unverified");
	});

	it("finds the finaliser's own signature last, and a sorted copy, in a long list too", async () => {
		// six signers: too many for every order to be tried
		const all = await signed(0, 1, 2, 3, 4, 5);
		const policy = { ...POLICY, authorizedUsers: [...ADDRESSES] };
		const sentAs = async (order: ProposalSignature[]) => {
			const sent = proposalOf(userPayload(), order);
			const classified = await classifySignatures(sent, policy);
			const { request } = buildEnvelope(sent, {
				signatureChainId: CHAIN,
				classified,
			});
			return {
				submittedAt: SENT,
				signatureChainId: CHAIN,
				outerSignature: await signDigest(
					envelopeDigest(request, "testnet").digest as `0x${string}`,
					1,
				),
				httpStatus: 200,
				response: { status: "ok" },
			} satisfies Receipt;
		};
		const [t, a, ...rest] = all as [
			ProposalSignature,
			ProposalSignature,
			...ProposalSignature[],
		];
		// the finaliser (A) signed at the moment of sending: its signature went last
		const lastReceipt = await sentAs([t, ...rest, a]);
		expect(
			await checkReceipt(proposalOf(userPayload(), all), lastReceipt),
		).toBe("finaliser");
		// sent from a copy that held the signers in sorted order
		const sorted = [...all].sort((x, y) => (x.signer < y.signer ? -1 : 1));
		const sortedReceipt = await sentAs(sorted);
		expect(
			await checkReceipt(
				proposalOf(userPayload(), [...sorted].reverse()),
				sortedReceipt,
			),
		).toBe("finaliser");
	});

	it("says who sent it, not what was answered: the answer is outside the signature", async () => {
		const p = proposalOf(userPayload(), await signed(1, 2));
		const real = await receiptFor(p);
		// the same signature beside another answer still passes: a page must
		// not take a receipt's "refused" or "accepted" for Hyperliquid's word
		const flipped: Receipt = {
			...real,
			response: { status: "err", response: "Insufficient balance" },
		};
		expect(await checkReceipt(p, flipped)).toBe("finaliser");
	});

	it("does not try every order of a long list", async () => {
		const all = await signed(0, 1, 2, 3, 4, 5);
		// sent with the last signature first: no selection in the copy's order gives that
		const sent = proposalOf(userPayload(), [
			all[5] as ProposalSignature,
			...all.slice(0, 5),
		]);
		const policy = { ...POLICY, authorizedUsers: [...ADDRESSES] };
		const classified = await classifySignatures(sent, policy);
		const { request } = buildEnvelope(sent, {
			signatureChainId: CHAIN,
			classified,
		});
		const receipt: Receipt = {
			submittedAt: SENT,
			signatureChainId: CHAIN,
			outerSignature: await signDigest(
				envelopeDigest(request, "testnet").digest as `0x${string}`,
				1,
			),
			httpStatus: 200,
			response: { status: "ok" },
		};
		expect(await checkReceipt(sent, receipt)).toBe("finaliser");
		expect(await checkReceipt({ ...sent, signatures: all }, receipt)).toBe(
			"unverified",
		);
	});
});

describe("a receipt Hyperliquid really answered (fixtures/multisig/mode-switch.json)", () => {
	interface Recorded {
		about: string;
		request: {
			action: {
				signatureChainId: `0x${string}`;
				signatures: { r: `0x${string}`; s: `0x${string}`; v: number }[];
				payload: {
					multiSigUser: `0x${string}`;
					outerSigner: `0x${string}`;
					action: Record<string, unknown>;
				};
			};
			nonce: number;
			signature: { r: `0x${string}`; s: `0x${string}`; v: number };
		};
		answer: { status: string; response: unknown };
	}
	const fx = JSON.parse(
		readFileSync(
			new URL("../../fixtures/multisig/mode-switch.json", import.meta.url),
			"utf8",
		),
	) as { requests: Recorded[]; switches: Recorded[] };

	/** The proposal and the receipt a page would hold of a recorded submission. */
	async function held(r: Recorded) {
		const made = createProposal(
			{
				network: "testnet",
				multiSigUser: r.request.action.payload.multiSigUser,
				outerSigner: r.request.action.payload.outerSigner,
				action: r.request.action.payload.action as never,
				nonce: r.request.nonce,
			},
			{ now: r.request.nonce },
		).proposal as Proposal;
		const signatures: ProposalSignature[] = [];
		for (const raw of r.request.action.signatures) {
			const sig = padSig(raw as never);
			const signer = await recoverInnerSigner(made.digest, sig);
			signatures.push({ ...sig, signer: signer as never, at: null });
		}
		const receipt: Receipt = {
			submittedAt: r.request.nonce,
			signatureChainId: r.request.action.signatureChainId,
			outerSignature: padSig(r.request.signature as never),
			httpStatus: 200,
			response: r.answer as never,
		};
		return { proposal: { ...made, signatures }, receipt };
	}

	it("the accepted switches are their finaliser's: the one-letter code is hashed here as Hyperliquid hashes it", async () => {
		expect(fx.switches.length).toBeGreaterThan(0);
		for (const r of fx.switches.filter((x) => x.answer.status === "ok")) {
			const { proposal, receipt } = await held(r);
			expect(await checkReceipt(proposal, receipt), r.about).toBe("finaliser");
		}
	});
	it("a submission Hyperliquid refused for its outer signature is nobody's here either", async () => {
		const refused = fx.requests.filter(
			(x) => x.answer.response === "Invalid multi-sig outer signer",
		);
		expect(refused.length).toBeGreaterThan(0);
		for (const r of refused) {
			const { proposal, receipt } = await held(r);
			expect(await checkReceipt(proposal, receipt), r.about).toBe("unverified");
		}
	});
});
