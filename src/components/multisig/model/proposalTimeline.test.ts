import type { Address, Hex, Proposal } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	A,
	B,
	C,
	makeProposal,
	NOW,
	receiptFor,
	signAs,
	TREASURY,
	usdSend,
} from "#/test/keys";
import { partsText } from "./parts";
import {
	proposalTimeline,
	recordEntries,
	TIMELINE_COPY,
	type TimelineStep,
} from "./proposalTimeline";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import type { EventRow } from "./relay/rows";

const MIN = 60_000;
let id = 0;
const event = (
	digest: Hex,
	kind: EventRow["kind"],
	actor: Address | null,
	at: number,
	data: Record<string, unknown> = {},
): EventRow => ({
	id: ++id,
	network: "testnet",
	treasury: TREASURY,
	digest,
	kind,
	rawKind: kind,
	actor,
	data,
	at,
});
const texts = (steps: readonly TimelineStep[], me: Address | null = null) =>
	proposalTimeline(steps, me).items.map((i) => [
		i.step,
		i.at,
		partsText(i.parts),
	]);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

describe("a proposal's timeline, from the sharing service's history", () => {
	const p = makeProposal();
	const d = p.digest;

	it("tells who did what, oldest first, folding what was one step", () => {
		const events = [
			event(d, "proposal_created", A, NOW, { finaliser: B }),
			event(d, "signature_added", A, NOW + 1),
			event(d, "objection_added", C, NOW + 2 * MIN),
			event(d, "objection_removed", C, NOW + 3 * MIN),
			event(d, "signature_added", C, NOW + 3 * MIN),
			event(d, "submission_recorded", B, NOW + 4 * MIN, { accepted: true }),
			// said again by the treasury's record: nothing new after an accepted result
			event(d, "proposal_carried_out", null, NOW + 5 * MIN, {
				tx_hash: "0xabc",
			}),
			// another proposal's entry is not this one's
			event("0x01" as Hex, "signature_added", B, NOW + MIN),
		];
		expect(texts([{ proposal: p, events, counted: null }], A)).toEqual([
			[null, NOW, `You proposed it and signed. Finaliser: ${short(B)}.`],
			[null, NOW + 2 * MIN, `${short(C)} said no.`],
			[null, NOW + 3 * MIN, `${short(C)} signed, in place of their no.`],
			[null, NOW + 4 * MIN, `Sent by ${short(B)}; accepted by Hyperliquid.`],
		]);
	});

	it("tells taking back, saying no, cancelling and refusals", () => {
		const events = [
			event(d, "signature_added", B, NOW),
			event(d, "signature_removed", B, NOW + MIN),
			event(d, "objection_added", B, NOW + MIN),
			event(d, "objection_removed", B, NOW + 2 * MIN),
			event(d, "signature_added", C, NOW + 3 * MIN),
			event(d, "signature_removed", C, NOW + 4 * MIN),
			event(d, "proposal_declined", B, NOW + 5 * MIN),
			event(d, "submission_recorded", B, NOW + 6 * MIN, {
				accepted: false,
				http_status: 200,
			}),
			event(d, "proposal_withdrawn", A, NOW + 7 * MIN),
			event(d, "unknown", null, NOW + 8 * MIN),
		];
		const out = proposalTimeline([{ proposal: p, events, counted: null }], B);
		expect(out.fromCopy).toBe(false);
		expect(out.items.map((i) => partsText(i.parts))).toEqual([
			"You signed.",
			"You said no, taking back your signature.",
			"You took back your no.",
			`${short(C)} signed.`,
			`${short(C)} took back their signature.`,
			"You, its finaliser, said no: it will not be sent.",
			"Sent by you; Hyperliquid refused it. It cannot be sent again as it is: open it to see why, and propose it again if it is still wanted.",
			`Cancelled for everyone by the proposer, ${short(A)}.`,
			"An entry this version of the page cannot describe (“unknown”).",
		]);
		expect(out.items.find((i) => i.tone === "wrong")).toBeDefined();
	});

	it("tells two decisions apart, and one step as one", () => {
		const events = [
			event(d, "objection_added", C, NOW),
			// a minute later: taking the no back, then signing, are two decisions
			event(d, "objection_removed", C, NOW + MIN),
			event(d, "signature_added", C, NOW + 2 * MIN),
			// saying no takes the signature back in the same step: one
			event(d, "signature_removed", C, NOW + 3 * MIN),
			event(d, "objection_added", C, NOW + 3 * MIN + 1),
		];
		expect(
			proposalTimeline(
				[{ proposal: p, events, counted: null }],
				null,
			).items.map((i) => partsText(i.parts)),
		).toEqual([
			`${short(C)} said no.`,
			`${short(C)} took back their no.`,
			`${short(C)} signed.`,
			`${short(C)} said no, taking back their signature.`,
		]);
	});

	it("puts Hyperliquid's record after the send it records", () => {
		const out = proposalTimeline(
			[
				{
					proposal: p,
					events: [
						event(d, "submission_recorded", B, NOW + 2_000, { accepted: true }),
					],
					counted: null,
				},
			],
			null,
			// the transaction's own time is a moment before the send was noted
			[{ hash: "0x1", at: NOW }],
		);
		expect(out.items.map((i) => [i.at, partsText(i.parts)])).toEqual([
			[NOW + 2_000, `Sent by ${short(B)}; accepted by Hyperliquid.`],
			[NOW, "On Hyperliquid's record."],
		]);
	});

	it("tells a proposal carried out without being sent from here, with its transaction", () => {
		const out = proposalTimeline(
			[
				{
					proposal: p,
					events: [
						event(d, "proposal_created", null, NOW),
						event(d, "proposal_carried_out", null, NOW + 9 * MIN, {
							tx_hash: "0xfeed",
							tx_time: NOW + 8 * MIN,
							reported_by: C,
						}),
					],
					counted: null,
				},
			],
			null,
		);
		expect(out.items.map((i) => [i.at, partsText(i.parts), i.hash])).toEqual([
			[NOW, "Someone proposed it.", undefined],
			[
				NOW + 8 * MIN,
				`Carried out without being sent from here: its transaction is on Hyperliquid's record, noticed by ${short(C)}.`,
				"0xfeed",
			],
		]);
	});

	it("adds what Hyperliquid's record says, refusal or not", () => {
		const out = proposalTimeline(
			[{ proposal: p, events: [], counted: null }],
			null,
			[
				{ hash: "0x1", at: NOW + MIN },
				{ hash: "0x2", at: NOW, refused: "Insufficient balance." },
			],
		);
		expect(out.items.map((i) => [i.tone, partsText(i.parts), i.hash])).toEqual([
			[
				"wrong",
				"Hyperliquid's record shows it refused: Insufficient balance.",
				"0x2",
			],
			["ok", "On Hyperliquid's record.", "0x1"],
		]);
	});
});

describe("a proposal's timeline, from a copy alone", () => {
	it("says what the copy can: when it was made, its verified signatures and the send", async () => {
		const signed = await signAs(await signAs(makeProposal(), 1), 3);
		const p: Proposal = {
			...signed,
			// a signature whose time the copy does not give
			signatures: signed.signatures.map((s, i) =>
				i === 1 ? { ...s, at: null } : s,
			),
			receipt: await receiptFor(signed, { submittedAt: NOW + MIN }),
		};
		const out = proposalTimeline(
			// only A's signature verified on this page: C's is not told
			[{ proposal: p, events: null, counted: [A] }],
			A,
		);
		expect(out.fromCopy).toBe(true);
		expect(out.items.map((i) => [i.at, partsText(i.parts)])).toEqual([
			[NOW, "Proposed."],
			[NOW, "You signed."],
			[NOW + MIN, `Sent to Hyperliquid by ${short(B)}, its finaliser.`],
		]);
		// who proposed a copy is not signed: never named
		expect(out.items[0]?.parts.some((x) => x.who)).toBe(false);
	});

	it("puts a signature the copy does not date last", async () => {
		const signed = await signAs(await signAs(makeProposal(), 1), 2);
		const p = {
			...signed,
			meta: { ...signed.meta, createdAt: null },
			signatures: signed.signatures.map((s, i) =>
				i === 0 ? { ...s, at: null } : s,
			),
		};
		expect(texts([{ proposal: p, events: null, counted: [A, B] }])).toEqual([
			[null, NOW, `${short(B)} signed.`],
			[null, null, `${short(A)} signed.`],
		]);
	});
});

describe("a move's timeline", () => {
	const one = makeProposal();
	const two = makeProposal({
		nonce: one.payload.nonce + 1,
		action: usdSend({ time: one.payload.nonce + 1 }),
	});

	it("says once what both steps had alike at the same moment, and apart what they did not", () => {
		const steps: TimelineStep[] = [
			{
				proposal: one,
				step: 1,
				counted: null,
				events: [
					event(one.digest, "proposal_created", A, NOW),
					event(one.digest, "signature_added", B, NOW + MIN),
					event(one.digest, "submission_recorded", B, NOW + 3 * MIN, {
						accepted: true,
					}),
				],
			},
			{
				proposal: two,
				step: 2,
				counted: null,
				events: [
					event(two.digest, "proposal_created", A, NOW),
					event(two.digest, "signature_added", B, NOW + MIN + 1_000),
					// the same words a day later: not the same moment
					event(
						two.digest,
						"submission_recorded",
						B,
						NOW + 3 * MIN + 86_400_000,
						{
							accepted: true,
						},
					),
				],
			},
		];
		expect(texts(steps)).toEqual([
			[null, NOW, `${short(A)} proposed it.`],
			[null, NOW + MIN + 1_000, `${short(B)} signed.`],
			[1, NOW + 3 * MIN, `Sent by ${short(B)}; accepted by Hyperliquid.`],
			[
				2,
				NOW + 3 * MIN + 86_400_000,
				`Sent by ${short(B)}; accepted by Hyperliquid.`,
			],
		]);
	});

	it("keeps a record entry of each step apart", () => {
		const out = proposalTimeline(
			[
				{ proposal: one, step: 1, counted: null, events: [] },
				{ proposal: two, step: 2, counted: null, events: [] },
			],
			null,
			[
				{ step: 1, hash: "0x1", at: NOW },
				{ step: 2, hash: "0x2", at: NOW },
			],
		);
		expect(out.items.map((i) => i.step)).toEqual([1, 2]);
	});
});

describe("Hyperliquid's record in the timeline", () => {
	it("is an entry once the record has the transaction, refused or not", () => {
		expect(recordEntries({ kind: "found", hash: "0x1", time: NOW })).toEqual([
			{ hash: "0x1", at: NOW },
		]);
		expect(
			recordEntries({ kind: "likely", hash: "0x2", time: NOW }, 2),
		).toEqual([{ step: 2, hash: "0x2", at: NOW }]);
		expect(
			recordEntries(
				{ kind: "refused", hash: "0x3", time: NOW, error: "No." },
				1,
			),
		).toEqual([{ step: 1, hash: "0x3", at: NOW, refused: "No." }]);
	});

	it("is nothing while the record says nothing yet", () => {
		expect(recordEntries(null)).toEqual([]);
		for (const kind of [
			"missing",
			"too-old",
			"just-sent",
			"checking",
			"unchecked",
		] as const)
			expect(recordEntries({ kind })).toEqual([]);
	});

	it("is told in words the section may use", () => {
		for (const text of Object.values(TIMELINE_COPY))
			for (const claim of FORBIDDEN_CLAIMS) expect(text).not.toMatch(claim);
	});
});
