import { encodeProposal, type Proposal, type Receipt } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, makeProposal, NOW, OUTSIDER, signAs } from "#/test/keys";
import { eventRow, rowFor } from "#/test/relayRows";
import {
	assembleProposal,
	bareDocument,
	countedSigners,
	effectiveProposal,
	receiptFromRow,
	receiptText,
	removedSigners,
	stabilise,
} from "./assemble";
import type { ReceiptRow } from "./rows";

const SIG = {
	r: `0x${"11".repeat(32)}`,
	s: `0x${"22".repeat(32)}`,
	v: 27,
} as const;
const receipt = (over: Partial<Receipt> = {}): Receipt =>
	({
		submittedAt: NOW,
		signatureChainId: "0x3e6",
		outerSignature: SIG,
		httpStatus: 200,
		response: { status: "ok", response: { type: "default" } },
		...over,
	}) as Receipt;
const rejected = (submittedAt: number): Receipt =>
	receipt({
		submittedAt,
		response: { status: "err", response: "Invalid multi-sig inner signer" },
	});
const codes = (issues: readonly { code: string }[]) =>
	issues.map((i) => i.code);
const signers = (p: Proposal | null | undefined) =>
	p?.signatures.map((s) => s.signer) ?? [];

describe("bareDocument", () => {
	it("is the proposal without signatures or receipt, and decodes to the same digest", async () => {
		const p = { ...(await signAs(makeProposal(), 1)), receipt: receipt() };
		const bare = JSON.parse(bareDocument(p));
		expect(bare.signatures).toEqual([]);
		expect(bare.receipt).toBeNull();
		expect(bare.digest).toBe(p.digest);
		expect(Object.keys(bare)).toEqual([
			"v",
			"payload",
			"digest",
			"signatures",
			"meta",
			"receipt",
		]);
	});
});

describe("assembleProposal", () => {
	it("returns the document with the signatures that verify", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 2);
		const { assembled, issues } = await assembleProposal(rowFor(p), {
			now: NOW,
		});
		expect(issues).toEqual([]);
		expect(signers(assembled?.proposal)).toEqual([A, B]);
		expect(assembled?.proposal.digest).toBe(p.digest);
		expect(assembled?.proposal.receipt).toBeNull();
		expect(assembled?.row.status).toBe("open");
	});

	it("keeps the time each signature reached the relay", async () => {
		const p = await signAs(makeProposal(), 1);
		const row = rowFor(p);
		const { assembled } = await assembleProposal(
			{
				...row,
				signatures: row.signatures.map((s) => ({ ...s, createdAt: 123 })),
			},
			{ now: NOW },
		);
		expect(assembled?.proposal.signatures[0]?.at).toBe(123);
	});

	it("ignores a document whose payload was changed after it was hashed", async () => {
		const p = makeProposal();
		const tampered = bareDocument(p).replace('"amount":"1"', '"amount":"1000"');
		expect(tampered).not.toBe(bareDocument(p));
		const { assembled, issues } = await assembleProposal(
			rowFor(p, { document: tampered }),
			{ now: NOW },
		);
		expect(assembled).toBeNull();
		expect(codes(issues)[0]).toBe("relay.row_invalid");
	});

	it("ignores text that is not a document", async () => {
		const { assembled, issues } = await assembleProposal(
			rowFor(makeProposal(), { document: "<html>" }),
			{ now: NOW },
		);
		expect(assembled).toBeNull();
		expect(codes(issues)).toContain("relay.row_invalid");
		expect(codes(issues)).toContain("proposal.parse");
	});

	it.each([
		["digest", { digest: `0x${"ab".repeat(32)}` }],
		["treasury", { treasury: OUTSIDER }],
		["finaliser", { finaliser: C }],
		["nonce", { nonce: 5 }],
		["network", { network: "mainnet" }],
	] as const)("ignores a row filed under another %s than its document states", async (_label, over) => {
		const { assembled, issues } = await assembleProposal(
			rowFor(makeProposal(), over),
			{ now: NOW },
		);
		expect(assembled).toBeNull();
		expect(codes(issues)).toEqual(["relay.row_mismatch"]);
	});

	it("ignores a row whose document carries signatures or a receipt of its own", async () => {
		const p = await signAs(makeProposal(), 1);
		const withSigs = await assembleProposal(
			rowFor(p, { document: encodeProposal(p) }),
			{ now: NOW },
		);
		expect(withSigs.assembled).toBeNull();
		expect(codes(withSigs.issues)).toEqual(["relay.row_mismatch"]);
		const bare = makeProposal();
		const withReceipt = await assembleProposal(
			rowFor(bare, {
				document: encodeProposal({ ...bare, receipt: receipt() }),
			}),
			{ now: NOW },
		);
		expect(withReceipt.assembled).toBeNull();
	});

	it("drops a signature filed under another signer's name, and says so", async () => {
		const p = await signAs(await signAs(makeProposal(), 1), 2);
		const row = rowFor(p);
		const relabelled = {
			...row,
			signatures: [
				row.signatures[0],
				{ ...row.signatures[1], signer: C },
			] as typeof row.signatures,
		};
		const { assembled, issues } = await assembleProposal(relabelled, {
			now: NOW,
		});
		expect(signers(assembled?.proposal)).toEqual([A]);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.code).toBe("relay.signature_dropped");
		expect(issues[0]?.message).toBe(
			"1 stored signature does not verify and was ignored.",
		);
	});

	it("drops signatures that recover to nothing, counting them", async () => {
		const p = await signAs(makeProposal(), 1);
		const row = rowFor(p);
		const junk = (signer: typeof A) => ({ signer, ...SIG, createdAt: NOW });
		const { assembled, issues } = await assembleProposal(
			{ ...row, signatures: [...row.signatures, junk(B), junk(C)] },
			{ now: NOW },
		);
		expect(signers(assembled?.proposal)).toEqual([A]);
		expect(issues[0]?.message).toBe(
			"2 stored signatures do not verify and were ignored.",
		);
	});

	it("drops a signature made over another proposal", async () => {
		const other = await signAs(
			makeProposal({
				title: "other",
				action: {
					type: "usdSend",
					signatureChainId: "0x3e6",
					hyperliquidChain: "Testnet",
					destination: A,
					amount: "2",
					time: 1_791_399_781_235,
				},
			}),
			1,
		);
		const p = makeProposal();
		const row = rowFor(p);
		const borrowed = rowFor(other).signatures;
		const { assembled, issues } = await assembleProposal(
			{ ...row, signatures: borrowed },
			{ now: NOW },
		);
		expect(signers(assembled?.proposal)).toEqual([]);
		expect(codes(issues)).toEqual(["relay.signature_dropped"]);
	});

	it("takes the accepted attempt over a later rejected one", async () => {
		const p = makeProposal();
		const rows = [
			rejected(NOW + 1),
			receipt({ submittedAt: NOW + 2 }),
			rejected(NOW + 3),
		].map((r) => rowFor({ ...p, receipt: r }).receipts[0] as ReceiptRow);
		const { assembled } = await assembleProposal(
			rowFor(p, { receipts: rows }),
			{ now: NOW },
		);
		expect(assembled?.proposal.receipt?.submittedAt).toBe(NOW + 2);
	});

	it("takes the latest of several rejected attempts", async () => {
		const p = makeProposal();
		const rows = [rejected(NOW + 1), rejected(NOW + 3), rejected(NOW + 2)].map(
			(r) => rowFor({ ...p, receipt: r }).receipts[0] as ReceiptRow,
		);
		const { assembled } = await assembleProposal(
			rowFor(p, { receipts: rows }),
			{ now: NOW },
		);
		expect(assembled?.proposal.receipt?.submittedAt).toBe(NOW + 3);
	});

	it("does not take the relay's word for 'accepted'", async () => {
		const p = makeProposal();
		const row = rowFor({ ...p, receipt: rejected(NOW) });
		const lying = {
			...row,
			receipts: row.receipts.map((r) => ({ ...r, accepted: true })),
		};
		const { assembled } = await assembleProposal(lying, { now: NOW });
		expect(assembled?.proposal.receipt?.response).toEqual({
			status: "err",
			response: "Invalid multi-sig inner signer",
		});
	});
});

describe("receipts as text", () => {
	it("round-trips an exchange answer, floats included", () => {
		const r = receipt({
			response: {
				status: "ok",
				response: {
					type: "order",
					data: { statuses: [{ filled: { avgPx: "1.5", totalSz: 0.25 } }] },
				},
			} as never,
		});
		const row = rowFor({ ...makeProposal(), receipt: r })
			.receipts[0] as ReceiptRow;
		expect(row.response).toBe(receiptText(r));
		expect(receiptFromRow(row)).toEqual(r);
	});

	it("keeps a body that was not JSON as a string", () => {
		const r = receipt({
			httpStatus: 502,
			response: "<html>bad gateway</html>",
		});
		const row = rowFor({ ...makeProposal(), receipt: r })
			.receipts[0] as ReceiptRow;
		expect(row.response).toBe('"<html>bad gateway</html>"');
		expect(receiptFromRow(row).response).toBe("<html>bad gateway</html>");
		expect(receiptFromRow({ ...row, response: "<html>" }).response).toBe(
			"<html>",
		);
	});
});

describe("removedSigners", () => {
	const digest = `0x${"d1".repeat(32)}` as const;
	const other = `0x${"d2".repeat(32)}` as const;
	const ev = (
		id: number,
		kind: "signature_added" | "signature_removed",
		actor: typeof A,
		d = digest,
	) => eventRow(kind, { id, digest: d, actor });

	it("is whoever's latest signature event is a removal", () => {
		const events = [
			ev(1, "signature_added", A),
			ev(2, "signature_added", B),
			ev(3, "signature_removed", A),
			ev(4, "signature_added", C),
			ev(5, "signature_removed", C),
			ev(6, "signature_added", C),
		];
		expect([...removedSigners(events, digest)]).toEqual([A]);
		// the order events arrive in does not matter
		expect([...removedSigners([...events].reverse(), digest)]).toEqual([A]);
	});

	it("looks at this proposal only, and at signature events only", () => {
		const events = [
			ev(1, "signature_removed", A, other),
			eventRow("proposal_withdrawn", { id: 2, digest, actor: B }),
			eventRow("signature_removed", { id: 3, digest, actor: null }),
		];
		expect(removedSigners(events, digest).size).toBe(0);
	});
});

describe("effectiveProposal", () => {
	it("is the local copy when the relay has none, and the relay's when this browser has none", async () => {
		const p = await signAs(makeProposal(), 1);
		expect((await effectiveProposal(null, p, new Set())).proposal).toBe(p);
		expect((await effectiveProposal(p, null, new Set())).proposal).toBe(p);
		expect(
			(await effectiveProposal(null, null, new Set())).proposal,
		).toBeNull();
	});

	it("adds signatures only this browser holds (a co-signer signed from a link)", async () => {
		const bare = makeProposal();
		const relay = await signAs(bare, 1);
		const local = await signAs(bare, 2);
		const { proposal, issues } = await effectiveProposal(
			relay,
			local,
			new Set(),
		);
		expect(signers(proposal)).toEqual([A, B]);
		expect(issues).toEqual([]);
	});

	it("leaves out a local signature its signer took back on the relay", async () => {
		const bare = makeProposal();
		const relay = await signAs(bare, 2);
		const local = await signAs(await signAs(bare, 1), 2);
		const { proposal } = await effectiveProposal(relay, local, new Set([A]));
		expect(signers(proposal)).toEqual([B]);
	});

	it("keeps a signature that is on the relay, whatever the removal list says", async () => {
		const relay = await signAs(makeProposal(), 1);
		const { proposal } = await effectiveProposal(
			relay,
			makeProposal(),
			new Set([A]),
		);
		expect(signers(proposal)).toEqual([A]);
	});

	it("prefers the relay's title and the better receipt", async () => {
		const relay = {
			...makeProposal({ title: "from the relay" }),
			receipt: rejected(NOW + 5),
		};
		const local = {
			...makeProposal({ title: "local title" }),
			receipt: receipt({ submittedAt: NOW + 1 }),
		};
		const { proposal } = await effectiveProposal(relay, local, new Set());
		expect(proposal?.meta.title).toBe("from the relay");
		expect(proposal?.receipt?.submittedAt).toBe(NOW + 1);
	});

	it("does not merge a local copy with a different payload under the same digest", async () => {
		const relay = await signAs(makeProposal(), 1);
		const local = {
			...(await signAs(makeProposal(), 2)),
			payload: { ...relay.payload, expiresAfter: NOW + 1000 },
		};
		const { proposal, issues } = await effectiveProposal(
			relay,
			local,
			new Set(),
		);
		expect(proposal).toBe(relay);
		expect(codes(issues)).toEqual(["relay.local_conflict"]);
	});

	it("drops a local signature that does not verify", async () => {
		const relay = await signAs(makeProposal(), 1);
		const local = {
			...makeProposal(),
			signatures: [{ signer: B, ...SIG, at: NOW }],
		};
		const { proposal, issues } = await effectiveProposal(
			relay,
			local,
			new Set(),
		);
		expect(signers(proposal)).toEqual([A]);
		expect(codes(issues)).toEqual(["merge.signature_dropped"]);
	});
});

describe("stabilise", () => {
	it("keeps the previous object when the proposal is unchanged", async () => {
		const prev = await signAs(makeProposal(), 1);
		const same = { ...prev, signatures: [...prev.signatures] };
		expect(stabilise(prev, same)).toBe(prev);
	});

	it("moves to the next one when anything changed", async () => {
		const prev = await signAs(makeProposal(), 1);
		const next = await signAs(prev, 2);
		expect(stabilise(prev, next)).toBe(next);
		expect(stabilise(null, next)).toBe(next);
		expect(stabilise(prev, null)).toBeNull();
	});
});

describe("countedSigners", () => {
	it("counts verified signatures of listed signers, once each", async () => {
		const p = await signAs(await signAs(await signAs(makeProposal(), 1), 2), 4);
		expect(await countedSigners(p, [A, B, C], 2)).toEqual([A, B]);
		expect(await countedSigners(p, [B, C], 2)).toEqual([B]);
		expect(await countedSigners(p, [], 1)).toEqual([]);
	});

	it("does not count a signature that does not verify", async () => {
		const p = {
			...makeProposal(),
			signatures: [{ signer: A, ...SIG, at: NOW }],
		};
		expect(await countedSigners(p, [A, B, C], 2)).toEqual([]);
	});
});
