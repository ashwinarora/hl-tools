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
import {
	deriveStage,
	finaliserLeft,
	type StageInput,
	shortAddress,
} from "./stage";

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

	it("is closed as carried out outside the tool once the relay has checked the transaction", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 2);
		const s = await stage(p, {
			wallet: B,
			walletChainId: 998,
			carriedOut: { txHash: `0x${"72".repeat(32)}` },
		});
		expect(s.phase).toBe("carried-out");
		expect(s.headline).toBe("Carried out outside this tool");
		expect(s.detail).toContain("The relay checked the transaction itself");
		// ready on paper, but there is nothing left to do
		expect(s.canSign).toBe(false);
		expect(s.canExecute).toBe(false);
		expect(s.signReason).toBe("Carried out outside this tool");
		expect(s.executeReason).toBe("Carried out outside this tool");
		// it outranks a withdrawal: what happened on chain is what happened
		expect(
			(
				await stage(p, {
					carriedOut: { txHash: null },
					ended: { kind: "withdrawn", by: A },
				})
			).phase,
		).toBe("carried-out");
		// and the finaliser's own accepted result outranks it
		expect(
			(await stage({ ...p, receipt: OK }, { carriedOut: { txHash: null } }))
				.phase,
		).toBe("submitted");
	});

	it("is closed, without a guess, when the relay closed it in a way this version does not know", async () => {
		const s = await stage(await signAs(makeProposal(), 1), {
			wallet: B,
			closedUnknown: true,
		});
		expect(s.phase).toBe("closed");
		expect(s.headline).toBe("Closed");
		expect(s.canSign).toBe(false);
		expect(s.canExecute).toBe(false);
	});

	it("cannot be finished once its finaliser has left the signer set", async () => {
		// B leads; the chain now lists A, C and a newcomer
		const without = {
			...POLICY,
			authorizedUsers: [A, C, OUTSIDER].sort(),
		};
		const ready = await signAs(await signAs(makeProposal(), 1), 3);
		const s = await stage(ready, {
			policy: without,
			wallet: A,
			walletChainId: 998,
		});
		expect(s.phase).toBe("stuck");
		expect(s.headline).toBe("Cannot be finished");
		expect(s.detail).toContain(shortAddress(B));
		expect(s.detail).toContain("propose it again with another finaliser");
		expect(s.canSign).toBe(false);
		expect(s.canExecute).toBe(false);
		// the finaliser themself, reading it
		const own = await stage(ready, {
			policy: without,
			wallet: B,
			walletChainId: 998,
		});
		expect(own.phase).toBe("stuck");
		expect(own.detail).toContain("your wallet is no longer");
		expect(own.canExecute).toBe(false);
		// still collecting: the same, there is no point in signing
		expect(
			(await stage(makeProposal(), { policy: without, wallet: A })).phase,
		).toBe("stuck");
		// an expired one is expired first
		expect(
			(await stage(ready, { policy: without, now: NONCE + 3 * DAY })).phase,
		).toBe("expired");
	});

	it("says a send cannot be submitted once a newer send of the treasury was carried out", async () => {
		// two signatures, the finaliser's wallet connected: it would be "ready"
		const p = await signAs(await signAs(makeProposal(), 1), 2);
		expect((await stage(p, { wallet: B })).phase).toBe("ready");
		const s = await stage(p, { wallet: B, overtaken: true });
		expect(s.phase).toBe("overtaken");
		expect(s.headline).toBe("Cannot be submitted any more");
		expect(s.detail).toMatch(/in the order they were proposed/);
		expect(s.detail).toMatch(/Propose it again/);
		// nobody is asked for anything any more
		expect(s.canExecute).toBe(false);
		expect(s.canSign).toBe(false);
		expect(s.executeReason).toBe("Cannot be submitted any more");
		expect(
			(await stage(makeProposal(), { wallet: A, overtaken: true })).canSign,
		).toBe(false);
	});

	it("reads the same from an attempt Hyperliquid refused for that reason", async () => {
		const refused = receipt({ status: "err", response: "Nonce already used." });
		const p = {
			...(await signAs(await signAs(makeProposal(), 1), 2)),
			receipt: refused,
		};
		const s = await stage(p, { wallet: B });
		expect(s.phase).toBe("overtaken");
		expect(s.failedAttempt?.id).toBe("nonce-used");
		// another rejection is still only a failed attempt: it can be retried
		const other = await stage({ ...p, receipt: ERR }, { wallet: B });
		expect(other.phase).toBe("ready");
	});

	it("keeps what ended a proposal ahead of 'overtaken': accepted, withdrawn, expired", async () => {
		const p = await signAs(makeProposal(), 1);
		expect(
			(await stage({ ...p, receipt: OK }, { overtaken: true })).phase,
		).toBe("submitted");
		expect(
			(
				await stage(p, {
					overtaken: true,
					ended: { kind: "withdrawn", by: A },
				})
			).phase,
		).toBe("withdrawn");
		expect(
			(await stage(p, { overtaken: true, now: NONCE + 3 * DAY })).phase,
		).toBe("expired");
	});

	it("does not call it stuck when the finaliser never was a signer, or when that cannot be known", async () => {
		// a document made elsewhere may name a signer's funded API wallet as finaliser
		const led = makeProposal({ leader: OUTSIDER });
		expect(finaliserLeft(led, POLICY)).toBe(false);
		expect((await stage(led)).phase).toBe("collecting");
		const p = makeProposal();
		expect(finaliserLeft(p, POLICY)).toBe(false);
		expect(finaliserLeft(p, null)).toBe(false);
		// not a multi-sig any more is its own state
		expect(
			finaliserLeft(p, { ...POLICY, authorizedUsers: [], threshold: 0 }),
		).toBe(false);
		expect(
			finaliserLeft(
				{ ...p, meta: { ...p.meta, policyAtCreation: null } },
				{
					...POLICY,
					authorizedUsers: [A, C],
				},
			),
		).toBe(false);
		expect(finaliserLeft(p, { ...POLICY, authorizedUsers: [A, C] })).toBe(true);
	});

	it("marks the addresses and moments in its sentences, so a screen can show nicknames and local time", async () => {
		const collecting = await stage(await signAs(makeProposal(), 1));
		// B and C have not signed; the window closes two days after the nonce
		expect(
			collecting.detailParts.filter((p) => p.who).map((p) => p.who),
		).toEqual([B, C].sort());
		expect(collecting.detailParts.find((p) => p.when)?.when).toBe(
			NONCE + 2 * DAY,
		);
		// the plain strings are the parts read as text: nothing else changed
		expect(collecting.detailParts.map((p) => p.text).join("")).toBe(
			collecting.detail,
		);
		expect(collecting.headlineParts.map((p) => p.text).join("")).toBe(
			collecting.headline,
		);

		const withdrawn = await stage(makeProposal(), {
			ended: { kind: "withdrawn", by: A },
		});
		expect(withdrawn.headlineParts).toEqual([
			{ text: "Withdrawn by the proposer, " },
			{ text: shortAddress(A), who: A },
		]);
		expect(withdrawn.detailParts.filter((p) => p.who)).toEqual([
			{ text: shortAddress(B), who: B },
		]);

		const done = await stage({ ...makeProposal(), receipt: OK });
		expect(done.detailParts.find((p) => p.when)).toEqual({
			text: new Date(NOW).toISOString(),
			when: NOW,
		});

		// the reader, among those who can still sign, is "you" and comes first
		const mine = await stage(await signAs(makeProposal(), 1), { wallet: C });
		expect(mine.detail).toContain(`you, ${shortAddress(B)} can still sign`);
		expect(mine.detailParts.find((p) => p.text === "you")).toEqual({
			text: "you",
			who: C,
		});

		// "your wallet" is words, not an address to look up
		const stuck = await stage(makeProposal(), {
			policy: { ...POLICY, authorizedUsers: [A, C] },
			wallet: B,
		});
		expect(stuck.detailParts.some((p) => p.who)).toBe(false);
	});
});
