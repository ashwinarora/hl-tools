import {
	classifySignatures,
	type Policy,
	type Proposal,
	type Receipt,
	readiness,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	A,
	B,
	C,
	makeProposal,
	NONCE,
	NOW,
	OUTSIDER,
	POLICY,
	signAs,
	TREASURY,
	usdSend,
} from "#/test/keys";
import { deriveStage, type StageInput, shortAddress } from "./stage";

const DAY = 86_400_000;
const SIG = { r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: 27 };
const receipt = (response: unknown, httpStatus = 200): Receipt =>
	({
		submittedAt: NOW,
		signatureChainId: "0x3e6",
		outerSignature: SIG,
		httpStatus,
		response,
	}) as Receipt;
const OK = receipt({ status: "ok", response: { type: "default" } });
const ERR = receipt({
	status: "err",
	response: "Invalid multi-sig inner signer",
});

/** Judge like the page does, then derive. */
async function stage(
	p: Proposal,
	over: Partial<StageInput> & { policy?: Policy | null; judged?: boolean } = {},
) {
	const policy = over.policy === undefined ? POLICY : over.policy;
	const now = over.now ?? NOW;
	const classified = await classifySignatures(p, policy);
	return deriveStage({
		proposal: p,
		readiness:
			over.judged === false ? null : readiness(p, policy, classified, { now }),
		policy,
		wallet: null,
		walletChainId: null,
		now,
		...over,
	});
}

describe("deriveStage", () => {
	it("collects signatures: a signer may sign, the finaliser may finish when theirs completes it", async () => {
		const p = await signAs(makeProposal(), 1); // A signed, B leads
		const s = await stage(p);
		expect(s.phase).toBe("collecting");
		expect(s.headline).toBe("Collecting signatures · 1 of 2");
		expect(s.detail).toContain(shortAddress(B));
		expect(s.detail).toContain("submittable until");
		expect(s.role).toBe("disconnected");
		expect(s.signReason).toBe("Connect a wallet to sign.");
		expect(s.executeReason).toBe("1 of 2 signatures so far.");

		const asA = await stage(p, { wallet: A });
		expect([asA.role, asA.hasSigned, asA.canSign, asA.signReason]).toEqual([
			"signer",
			true,
			false,
			"You signed this.",
		]);
		expect(asA.canExecute).toBe(false);

		const asC = await stage(p, { wallet: C.toUpperCase().replace("0X", "0x") });
		expect([asC.role, asC.hasSigned, asC.canSign, asC.signReason]).toEqual([
			"signer",
			false,
			true,
			null,
		]);
		// C's signature would complete the threshold, but C is not the finaliser
		expect(asC.executeReason).toBe(
			`Only the finaliser ${shortAddress(B)} can submit.`,
		);
		expect(asC.executeAddsSignature).toBe(false);

		const asB = await stage(p, { wallet: B });
		expect([
			asB.role,
			asB.canSign,
			asB.canExecute,
			asB.executeAddsSignature,
		]).toEqual(["signer-finaliser", true, true, true]);

		const out = await stage(p, { wallet: OUTSIDER });
		expect(out.role).toBe("outsider");
		expect(out.signReason).toBe(
			`${shortAddress(OUTSIDER)} is not in the signer set.`,
		);
	});

	it("does not offer the one-step finish while it would still be short", async () => {
		const p = makeProposal(); // nobody signed, need 2
		const asB = await stage(p, { wallet: B });
		expect(asB.canSign).toBe(true);
		expect(asB.canExecute).toBe(false);
		expect(asB.executeReason).toBe("0 of 2 signatures so far.");
		expect((await stage(p)).detail).toMatch(
			/can still sign · submittable until/,
		);
	});

	it("is ready once the threshold is met: only the finaliser submits", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 3); // A and C
		const s = await stage(p, { wallet: B });
		expect(s.phase).toBe("ready");
		expect(s.headline).toBe("Ready · 2 of 2 signatures");
		// B is the finaliser and is the one looking
		expect(s.detail).toContain("You are the finaliser");
		expect([s.canSign, s.canExecute, s.executeAddsSignature]).toEqual([
			true,
			true,
			false,
		]);
		const asA = await stage(p, { wallet: A });
		expect(asA.executeReason).toBe(
			`Only the finaliser ${shortAddress(B)} can submit.`,
		);
		expect((await stage(p)).executeReason).toBe(
			"Connect the finaliser's wallet to submit.",
		);
	});

	it("lets a leader outside the signer set finish but not sign", async () => {
		// a funded agent can lead (lab); readiness reports it as needs-lookup and still ready
		const p = await signAs(
			await signAs(makeProposal({ leader: OUTSIDER }), 1),
			2,
		);
		const s = await stage(p, { wallet: OUTSIDER });
		expect(s.role).toBe("finaliser");
		expect(s.canSign).toBe(false);
		expect(s.canExecute).toBe(true);
	});

	it("names the chain signers sign under and whether the wallet is on it", async () => {
		const p = makeProposal();
		const off = await stage(p, { wallet: A, walletChainId: 1 });
		expect(off.requiredChain).toEqual({
			hex: "0x3e6",
			id: 998,
			label: "HyperEVM testnet (998)",
		});
		expect(off.onRequiredChain).toBe(false);
		expect(
			(await stage(p, { wallet: A, walletChainId: 998 })).onRequiredChain,
		).toBe(true);
		const odd = await stage(
			makeProposal({ action: usdSend({ signatureChainId: "0x5" }) }),
		);
		expect(odd.requiredChain?.label).toBe("chain 5");
	});

	it("waits while the judgement is pending", async () => {
		const s = await stage(makeProposal(), { wallet: A, judged: false });
		expect(s.phase).toBe("judging");
		expect([s.canSign, s.canExecute]).toEqual([false, false]);
		expect(s.signReason).toBe("Checking signatures…");
		expect(s.executeReason).toBe("Checking signatures…");
		expect(s.hasSigned).toBe(false);
	});

	it("stops at expiry, before the window opens, and without a signer set", async () => {
		const p = await signAs(makeProposal(), 1);
		const expired = await stage(p, { wallet: B, now: NONCE + 2 * DAY + 1 });
		expect(expired.phase).toBe("expired");
		expect(expired.detail).toContain("closed");
		expect([expired.canSign, expired.canExecute]).toEqual([false, false]);
		expect(expired.signReason).toBe("Expired");

		const early = await stage(p, { wallet: B, now: NONCE - 2 * DAY });
		expect(early.phase).toBe("not-yet-valid");
		expect(early.headline).toBe("Not submittable yet · 1 of 2");
		expect(early.canSign).toBe(true);
		expect(early.canExecute).toBe(false);

		const none = await stage(p, {
			wallet: B,
			policy: { authorizedUsers: [], threshold: 0, observedAt: NOW },
		});
		expect(none.phase).toBe("not-multisig");
		expect(none.headline).toBe("Not a multi-sig on testnet");
		expect(none.detail).toContain(shortAddress(TREASURY));
		expect(none.role).toBe("finaliser");
		expect([none.canSign, none.canExecute]).toEqual([false, false]);

		const unknown = await stage(p, { wallet: B, policy: null });
		expect(unknown.phase).toBe("unknown");
		expect(unknown.role).toBe("finaliser");
		expect(unknown.canExecute).toBe(false);
	});

	it("is finished once the chain accepted it, and offers a retry after a rejection", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 2);
		const done = await stage({ ...p, receipt: OK }, { wallet: B });
		expect(done.phase).toBe("submitted");
		expect(done.failedAttempt).toBeNull();
		expect([done.canSign, done.canExecute]).toEqual([false, false]);
		expect(done.executeReason).toBe("Submitted · accepted by Hyperliquid");

		const failed = await stage({ ...p, receipt: ERR }, { wallet: B });
		expect(failed.phase).toBe("ready");
		expect(failed.failedAttempt?.id).not.toBe("ok");
		expect(failed.canExecute).toBe(true);
		const http = await stage(
			{ ...p, receipt: receipt("Bad Gateway", 502) },
			{ wallet: B },
		);
		expect(http.failedAttempt?.source).toBe("http");
	});

	it("refuses L1 actions and documents that set unsigned fields", async () => {
		const base = await signAs(makeProposal(), 1);
		const l1: Proposal = { ...base, meta: { ...base.meta, kind: "l1" } };
		const s = await stage(l1, { wallet: B });
		expect(s.phase).toBe("unsupported");
		expect(s.headline).toBe("An L1 action: inspect only");
		expect([s.canSign, s.canExecute]).toEqual([false, false]);
		expect(s.requiredChain).not.toBeNull();
		// an accepted L1 document still reads as submitted
		expect((await stage({ ...l1, receipt: OK })).phase).toBe("submitted");

		for (const payload of [
			{ ...base.payload, expiresAfter: NOW + DAY },
			{ ...base.payload, vaultAddress: TREASURY },
		]) {
			const t = await stage({ ...base, payload }, { wallet: B });
			expect(t.phase).toBe("unsupported");
			expect(t.headline).toBe(
				"This document sets a vault address or an expiry",
			);
			expect([t.canSign, t.canExecute]).toEqual([false, false]);
		}
		const noChain = await stage({
			...l1,
			payload: { ...l1.payload, action: { type: "noop" } },
		});
		expect(noChain.requiredChain).toBeNull();
		expect(noChain.onRequiredChain).toBe(false);
	});

	it("notices a signer set that changed since the proposal was made", async () => {
		const p = makeProposal();
		expect((await stage(p)).policyChanged).toBe(false);
		expect(
			(await stage(p, { policy: { ...POLICY, threshold: 3 } })).policyChanged,
		).toBe(true);
		expect(
			(await stage(p, { policy: { ...POLICY, authorizedUsers: [A, B] } }))
				.policyChanged,
		).toBe(true);
		expect(
			(
				await stage(p, {
					policy: { ...POLICY, authorizedUsers: [A, B, OUTSIDER].sort() },
				})
			).policyChanged,
		).toBe(true);
		expect((await stage(p, { policy: null })).policyChanged).toBe(false);
		const noSnapshot: Proposal = {
			...p,
			meta: { ...p.meta, policyAtCreation: null },
		};
		expect((await stage(noSnapshot)).policyChanged).toBe(false);
	});

	it("defaults to the current time", () => {
		const s = deriveStage({
			proposal: makeProposal(),
			readiness: null,
			policy: null,
			wallet: null,
			walletChainId: null,
		});
		expect(s.window.validUntil).toBe(NONCE + 2 * DAY);
	});

	it("tells the finaliser the ready proposal is theirs to submit", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 3); // A and C signed, B leads
		expect((await stage(p, { wallet: B })).detail).toMatch(
			/^You are the finaliser: submit it when you are ready · submittable until/,
		);
		expect((await stage(p, { wallet: A })).detail).toContain(
			`The finaliser ${shortAddress(B)} signs the envelope and submits`,
		);
	});

	it("is over once the proposer withdrew it: nothing to sign, nothing to submit, and the honest caveat", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 3);
		const s = await stage(p, {
			wallet: B,
			ended: { kind: "withdrawn", by: A },
		});
		expect(s.phase).toBe("withdrawn");
		expect(s.headline).toBe(`Withdrawn by the proposer, ${shortAddress(A)}`);
		expect(s.detail).toContain("remain valid on chain until the window closes");
		expect(s.detail).toContain(
			`only the finaliser ${shortAddress(B)} could still submit it`,
		);
		expect([s.canSign, s.canExecute]).toEqual([false, false]);
		expect(s.signReason).toBe(s.headline);
		expect(s.executeReason).toBe(s.headline);
		// still a signer and still shown as having signed
		expect(s.role).toBe("signer-finaliser");
	});

	it("is over once the finaliser declined it", async () => {
		const p = await signAs(makeProposal(), 1);
		const s = await stage(p, { wallet: A, ended: { kind: "declined", by: B } });
		expect(s.phase).toBe("declined");
		expect(s.headline).toBe(`Declined by the finaliser, ${shortAddress(B)}`);
		expect(s.detail).toMatch(/Re-propose it with a different finaliser/);
		expect([s.canSign, s.canExecute]).toEqual([false, false]);
	});

	it("shows what happened on chain over what was said on the relay", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 2);
		const s = await stage(
			{ ...p, receipt: OK },
			{ wallet: B, ended: { kind: "withdrawn", by: A } },
		);
		expect(s.phase).toBe("submitted");
	});

	it("refuses to sign or submit while the header is on the other network", async () => {
		const p = await signAs(makeProposal(), 1); // testnet; A signed, B leads and would complete it
		const wrong = await stage(p, { wallet: B, headerNetwork: "mainnet" });
		expect(wrong.networkMismatch).toBe(true);
		expect([wrong.canSign, wrong.canExecute]).toEqual([false, false]);
		expect(wrong.signReason).toBe(
			"This proposal is for testnet; the header is on mainnet. Switch the header to testnet to continue.",
		);
		expect(wrong.executeReason).toBe(wrong.signReason);
		// the phase is still the proposal's own
		expect(wrong.phase).toBe("collecting");

		const right = await stage(p, { wallet: B, headerNetwork: "testnet" });
		expect(right.networkMismatch).toBe(false);
		expect([right.canSign, right.canExecute]).toEqual([true, true]);
		// with no header given (the inspector), nothing is refused
		expect((await stage(p, { wallet: B })).networkMismatch).toBe(false);
	});

	it("keeps saying why a ready proposal cannot be submitted by a non-finaliser on the wrong network", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 3);
		const s = await stage(p, { wallet: A, headerNetwork: "mainnet" });
		expect(s.executeReason).toMatch(/^This proposal is for testnet/);
	});
});
