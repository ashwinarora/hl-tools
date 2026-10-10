import type { Proposal, Receipt } from "@hl-tools/core";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { A, B, makeProposal, NOW, signAs } from "#/test/keys";
import {
	betterReceipt,
	deleteProposal,
	listProposals,
	loadProposal,
	receiptOk,
	rewriteProposal,
	saveProposal,
	toStored,
	withProposalLock,
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

describe("writes of one proposal take turns", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps both signatures when two copies are saved at the same moment", async () => {
		const base = makeProposal();
		const [withA, withB, withC] = await Promise.all([
			signAs(base, 1),
			signAs(base, 2),
			signAs(base, 3),
		]);
		// without the lock each save reads "nothing stored" and the last write wins
		const saved = await Promise.all(
			[withA, withB, withC].map((p) => saveProposal(p as Proposal)),
		);
		expect(saved.every((r) => r.saved)).toBe(true);
		const stored = (await loadProposal(base.digest)).proposal;
		expect(stored?.signatures.map((s) => s.signer).sort()).toEqual(
			[A, B, (withC as Proposal).signatures[0]?.signer].sort(),
		);
	});

	it("runs in the order asked, one at a time, and lets other proposals through", async () => {
		const log: string[] = [];
		const job = (name: string, ms: number) => async () => {
			log.push(`${name} start`);
			await new Promise((r) => setTimeout(r, ms));
			log.push(`${name} end`);
			return name;
		};
		const results = await Promise.all([
			withProposalLock("0xd1", job("first", 20)),
			withProposalLock("0xd1", job("second", 1)),
			withProposalLock("0xd2", job("other", 1)),
		]);
		expect(results).toEqual(["first", "second", "other"]);
		expect(log.indexOf("first end")).toBeLessThan(log.indexOf("second start"));
		expect(log.indexOf("other end")).toBeLessThan(log.indexOf("first end"));
	});

	it("is not stuck by a write that fails", async () => {
		const failed = withProposalLock("0xd3", async () => {
			throw new Error("disk full");
		});
		const next = withProposalLock("0xd3", async () => "fine");
		await expect(failed).rejects.toThrow("disk full");
		await expect(next).resolves.toBe("fine");
	});

	it("uses the browser's Web Locks when it has them, so tabs take turns too", async () => {
		const names: string[] = [];
		vi.stubGlobal("navigator", {
			locks: {
				request: (name: string, fn: () => Promise<unknown>) => {
					names.push(name);
					return fn();
				},
			},
		});
		const p = await signAs(makeProposal(), 1);
		const saved = await saveProposal(p);
		expect(saved.saved).toBe(true);
		expect(names).toEqual([`hl-tools:proposal:${p.digest}`]);
	});
});

describe("rewriteProposal", () => {
	it("can remove a signature, which saving never does", async () => {
		const base = makeProposal();
		const both = await signAs(await signAs(base, 1), 2);
		await saveProposal(both);
		// saving a copy without A's signature leaves A's signature in place
		await saveProposal(await signAs(base, 2));
		expect((await loadProposal(base.digest)).proposal?.signatures).toHaveLength(
			2,
		);

		const r = await rewriteProposal(base.digest, async (stored) => {
			expect(stored?.signatures).toHaveLength(2);
			return stored
				? {
						...stored,
						signatures: stored.signatures.filter((s) => s.signer !== A),
					}
				: null;
		});
		expect(r?.saved).toBe(true);
		expect(
			(await loadProposal(base.digest)).proposal?.signatures.map(
				(s) => s.signer,
			),
		).toEqual([B]);
	});

	it("stores a proposal this browser did not have", async () => {
		const p = await signAs(makeProposal(), 1);
		const r = await rewriteProposal(p.digest, async (stored) => {
			expect(stored).toBeNull();
			return p;
		});
		expect(r).toEqual({ proposal: p, saved: true, issues: [] });
		expect((await loadProposal(p.digest)).proposal).toEqual(p);
	});

	it("writes nothing when the decision is to leave things alone, or changes nothing", async () => {
		const p = await signAs(makeProposal(), 1);
		await saveProposal(p, { now: 5 });
		expect(await rewriteProposal(p.digest, async () => null)).toBeNull();
		const same = await rewriteProposal(p.digest, async (stored) => stored, {
			now: 99,
		});
		expect(same?.saved).toBe(false);
		expect((await listProposals())[0]?.updatedAt).toBe(5);
	});

	it("refuses a copy filed under another digest or carrying another payload", async () => {
		const p = await signAs(makeProposal(), 1);
		await saveProposal(p);
		const other = makeProposal({ title: "another", leader: A });
		expect(await rewriteProposal(p.digest, async () => other)).toBeNull();
		const r = await rewriteProposal(p.digest, async (stored) =>
			stored
				? { ...stored, payload: { ...stored.payload, expiresAfter: NOW + 1 } }
				: null,
		);
		expect(r?.saved).toBe(false);
		expect(r?.issues.map((i) => i.code)).toEqual(["history.payload_conflict"]);
		expect((await loadProposal(p.digest)).proposal).toEqual(p);
	});

	it("decides on the copy as it is after any save already under way", async () => {
		const base = makeProposal();
		const withA = await signAs(base, 1);
		const withB = await signAs(base, 2);
		// a signature made on the page, and a relay update that knows only A, at the same moment
		const [, rewritten] = await Promise.all([
			saveProposal(withB),
			rewriteProposal(base.digest, async (stored) => {
				const merged = await saveLike(stored, withA);
				return merged;
			}),
		]);
		expect(rewritten?.proposal.signatures.map((s) => s.signer).sort()).toEqual(
			[A, B].sort(),
		);
	});
});

/** What a relay update does inside the lock: merge its copy with whatever is stored now. */
async function saveLike(
	stored: Proposal | null,
	incoming: Proposal,
): Promise<Proposal> {
	if (!stored) return incoming;
	const have = new Set(stored.signatures.map((s) => s.signer));
	return {
		...stored,
		signatures: [
			...stored.signatures,
			...incoming.signatures.filter((s) => !have.has(s.signer)),
		],
	};
}
