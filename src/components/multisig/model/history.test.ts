import type { Proposal, Receipt } from "@hl-tools/core";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { A, B, makeProposal, NOW, signAs } from "#/test/keys";
import {
	betterReceipt,
	deleteProposal,
	listProposals,
	loadProposal,
	receiptOk,
	saveProposal,
	toStored,
} from "./history";

const SIG = { r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: 27 };
const receipt = (over: Partial<Receipt> = {}): Receipt =>
	({
		submittedAt: NOW,
		signatureChainId: "0x3e6",
		outerSignature: SIG,
		httpStatus: 200,
		response: { status: "ok", response: { type: "default" } },
		...over,
	}) as Receipt;
const failed = (submittedAt = NOW) =>
	receipt({
		submittedAt,
		response: { status: "err", response: "Invalid multi-sig inner signer" },
	});

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
});

describe("history", () => {
	it("saves and loads a proposal unchanged", async () => {
		const p = await signAs(makeProposal(), 1);
		const saved = await saveProposal(p, { now: 10 });
		expect(saved.saved).toBe(true);
		expect(saved.issues).toEqual([]);
		const loaded = await loadProposal(p.digest);
		expect(loaded.proposal).toEqual(p);
		expect(await loadProposal("0xabc")).toEqual({ proposal: null, issues: [] });
	});

	it("summarises the document for the list", async () => {
		const p = await signAs(makeProposal({ title: "pay Bob" }), 1);
		expect(toStored(p, 7)).toMatchObject({
			digest: p.digest,
			network: "testnet",
			title: "pay Bob",
			kind: "user-signed",
			actionType: "usdSend",
			signatures: 1,
			submitted: null,
			updatedAt: 7,
		});
		expect(toStored({ ...p, receipt: receipt() }).submitted).toBe("ok");
		expect(toStored({ ...p, receipt: failed() }).submitted).toBe("error");
	});

	it("merges a returned copy by signer instead of appending", async () => {
		const base = makeProposal();
		const withA = await signAs(base, 1);
		const withB = await signAs(base, 2);
		await saveProposal(withA);
		const merged = await saveProposal(withB);
		expect(merged.proposal.signatures.map((s) => s.signer).sort()).toEqual(
			[A, B].sort(),
		);
		// the same copy again changes nothing
		const again = await saveProposal(withB);
		expect(again.proposal.signatures).toHaveLength(2);
		expect((await loadProposal(base.digest)).proposal?.signatures).toHaveLength(
			2,
		);
	});

	it("drops a signature that does not recover to its claimed signer", async () => {
		const p = await signAs(makeProposal(), 1);
		const forged: Proposal = {
			...p,
			signatures: [
				...p.signatures,
				{ ...(p.signatures[0] as Proposal["signatures"][number]), signer: B },
			],
		};
		const saved = await saveProposal(forged);
		expect(saved.proposal.signatures.map((s) => s.signer)).toEqual([A]);
		expect(saved.issues.map((i) => i.code)).toEqual([
			"merge.signature_dropped",
		]);
	});

	it("refuses a copy with the same digest and a different payload", async () => {
		const p = await signAs(makeProposal(), 1);
		await saveProposal(p);
		// expiresAfter is outside the user-signed digest, so the digest still matches
		const tampered: Proposal = {
			...p,
			payload: { ...p.payload, expiresAfter: NOW + 1000 },
		};
		const r = await saveProposal(tampered);
		expect(r.saved).toBe(false);
		expect(r.issues.map((i) => i.code)).toEqual(["history.payload_conflict"]);
		expect(r.proposal).toEqual(p);
		expect((await loadProposal(p.digest)).proposal?.payload.expiresAfter).toBe(
			null,
		);
	});

	it("keeps the better receipt", async () => {
		const p = await signAs(makeProposal(), 1);
		await saveProposal({ ...p, receipt: failed(NOW) });
		// a later failure replaces an earlier one
		let r = await saveProposal({ ...p, receipt: failed(NOW + 5) });
		expect(r.proposal.receipt?.submittedAt).toBe(NOW + 5);
		// an accepted submission wins
		r = await saveProposal({
			...p,
			receipt: receipt({ submittedAt: NOW + 1 }),
		});
		expect(receiptOk(r.proposal.receipt as Receipt)).toBe(true);
		// and a stale failure arriving later does not displace it
		r = await saveProposal({ ...p, receipt: failed(NOW + 99) });
		expect(receiptOk(r.proposal.receipt as Receipt)).toBe(true);
		// a copy without a receipt keeps the stored one
		r = await saveProposal(p);
		expect(r.proposal.receipt).not.toBeNull();
		expect(betterReceipt(null, null)).toBeNull();
		expect(betterReceipt(failed(9), failed(3))?.submittedAt).toBe(9);
	});

	it("lists newest first, filters by network and deletes", async () => {
		const one = makeProposal({ title: "one" });
		const two = makeProposal({ title: "two", leader: A });
		await saveProposal(one, { now: 1 });
		await saveProposal(two, { now: 2 });
		expect((await listProposals()).map((r) => r.title)).toEqual(["two", "one"]);
		expect(await listProposals("mainnet")).toEqual([]);
		expect(await listProposals("testnet")).toHaveLength(2);
		await deleteProposal(one.digest);
		expect((await listProposals()).map((r) => r.title)).toEqual(["two"]);
	});
});
