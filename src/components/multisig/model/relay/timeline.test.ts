import type { Hex } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, makeProposal, NOW, signAs, TREASURY } from "#/test/keys";
import { eventRow } from "#/test/relayRows";
import type { EventRow } from "./rows";
import {
	buildTimeline,
	entryText,
	historyCsv,
	historyExport,
	historyFilename,
} from "./timeline";

const D1 = `0x${"d1".repeat(32)}` as Hex;
const D2 = `0x${"d2".repeat(32)}` as Hex;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const lines: Record<string, string> = { [D1]: "Send 120 USDC to 0x9a01…77c2" };
const ctx = (me: typeof A | null = A) => ({
	me,
	line: (d: Hex) => lines[d] ?? null,
});
const texts = (events: EventRow[], me: typeof A | null = A) =>
	buildTimeline(events, ctx(me)).map(entryText);

describe("buildTimeline", () => {
	it("tells a proposal's life in the mockup's sentences, newest first", () => {
		const events = [
			eventRow("proposal_created", {
				id: 1,
				digest: D1,
				actor: A,
				data: { finaliser: C },
			}),
			eventRow("signature_added", { id: 2, digest: D1, actor: A }),
			eventRow("signature_added", { id: 3, digest: D1, actor: C }),
			eventRow("submission_recorded", {
				id: 4,
				digest: D1,
				actor: C,
				data: { accepted: true, http_status: 200 },
			}),
		];
		expect(texts(events)).toEqual([
			`Send 120 USDC to 0x9a01…77c2 was accepted by Hyperliquid. Sent by ${short(C)}.`,
			`${short(C)} signed Send 120 USDC to 0x9a01…77c2.`,
			`You proposed Send 120 USDC to 0x9a01…77c2 and signed. Finaliser: ${short(C)}.`,
		]);
		// only the report of acceptance is checked against Hyperliquid's record
		expect(buildTimeline(events, ctx()).map((e) => e.accepted ?? null)).toEqual(
			[[D1], null, null],
		);
	});

	it("marks no rejected submission, and none without a proposal, for the record check", () => {
		const entries = buildTimeline(
			[
				eventRow("submission_recorded", {
					id: 1,
					digest: D1,
					actor: C,
					data: { accepted: false, http_status: 200 },
				}),
				eventRow("submission_recorded", {
					id: 2,
					digest: null,
					actor: C,
					data: { accepted: true },
				}),
			],
			ctx(),
		);
		expect(entries.map((e) => e.accepted ?? null)).toEqual([null, null]);
	});

	it("marks the action line as the strong part, and names whose address a part is", () => {
		const [entry] = buildTimeline(
			[eventRow("signature_added", { id: 1, digest: D1, actor: B })],
			ctx(),
		);
		expect(entry?.parts).toEqual([
			// a screen may show B's nickname here; the text stays the plain address
			{ text: short(B), who: B },
			{ text: " signed " },
			{ text: "Send 120 USDC to 0x9a01…77c2", strong: true },
			{ text: "." },
		]);
		expect(entry?.digest).toBe(D1);
		// the reader is named as "You", and still as an address a screen can recognise
		const [mine] = buildTimeline(
			[eventRow("signature_added", { id: 1, digest: D1, actor: A })],
			ctx(),
		);
		expect(mine?.parts[0]).toEqual({ text: "You", who: A });
		// nobody is nobody's address
		const [nobody] = buildTimeline(
			[eventRow("signature_added", { id: 1, digest: D1, actor: null })],
			ctx(),
		);
		expect(nobody?.parts[0]).toEqual({ text: "Someone signed " });
	});

	it("names every address in a list as a part of its own", () => {
		const [entry] = buildTimeline(
			[
				eventRow("treasury_added", {
					id: 1,
					actor: A,
					data: { signers: [A, B, C], threshold: 2 },
				}),
			],
			ctx(B),
		);
		expect(
			entry?.parts.filter((p) => p.who).map((p) => [p.text, p.who]),
		).toEqual([
			[short(A), A],
			[short(A), A],
			["you", B],
			[short(C), C],
		]);
		expect(entryText(entry as never)).toBe(
			`Treasury added by ${short(A)}. Signers: ${short(A)}, you, ${short(C)}. Threshold 2.`,
		);
	});

	it("adds the proposal's title after the action, quietly, to tell like actions apart", () => {
		const titled = {
			me: A,
			line: (d: Hex) => lines[d] ?? null,
			title: (d: Hex) => (d === D1 ? "October payout" : null),
		};
		const [entry] = buildTimeline(
			[eventRow("signature_added", { id: 1, digest: D1, actor: B })],
			titled,
		);
		expect(entry?.parts).toEqual([
			{ text: short(B), who: B },
			{ text: " signed " },
			{ text: "Send 120 USDC to 0x9a01…77c2", strong: true },
			{ text: " (“October payout”)", quiet: true },
			{ text: "." },
		]);
		// never a title in place of the action
		const [unknown] = buildTimeline(
			[eventRow("signature_added", { id: 2, digest: D2, actor: B })],
			{ ...titled, title: () => "Looks harmless" },
		);
		expect(entryText(unknown as never)).toBe(`${short(B)} signed a proposal.`);
	});

	it("does not fold a signature that is not the proposer's, or not the next thing that happened", () => {
		const other = [
			eventRow("proposal_created", {
				id: 1,
				digest: D1,
				actor: A,
				data: { finaliser: C },
			}),
			eventRow("signature_added", { id: 2, digest: D1, actor: B }),
		];
		expect(texts(other)).toHaveLength(2);
		const later = [
			eventRow("proposal_created", {
				id: 1,
				digest: D1,
				actor: A,
				data: { finaliser: C },
			}),
			eventRow("signature_added", { id: 2, digest: D1, actor: B }),
			eventRow("signature_added", { id: 3, digest: D1, actor: A }),
		];
		expect(texts(later)).toHaveLength(3);
		expect(texts(later)[2]).toBe(
			`You proposed Send 120 USDC to 0x9a01…77c2. Finaliser: ${short(C)}.`,
		);
	});

	it("folds across events of other proposals in between, and takes the later id", () => {
		const events = [
			eventRow("proposal_created", {
				id: 1,
				digest: D1,
				actor: B,
				data: { finaliser: A },
			}),
			eventRow("proposal_created", {
				id: 2,
				digest: D2,
				actor: C,
				data: { finaliser: C },
			}),
			eventRow("signature_added", { id: 3, digest: D1, actor: B }),
		];
		const out = buildTimeline(events, ctx());
		expect(out.map((e) => e.id)).toEqual([3, 2]);
		expect(entryText(out[0] as never)).toBe(
			`${short(B)} proposed Send 120 USDC to 0x9a01…77c2 and signed. Finaliser: you.`,
		);
		expect(entryText(out[1] as never)).toBe(
			`${short(C)} proposed a proposal. Finaliser: ${short(C)}.`,
		);
	});

	it("says who ended a proposal, and how", () => {
		expect(
			texts([eventRow("proposal_withdrawn", { digest: D1, actor: B })]),
		).toEqual([
			`Send 120 USDC to 0x9a01…77c2 was cancelled by the proposer, ${short(B)}.`,
		]);
		expect(
			texts([eventRow("proposal_declined", { digest: D1, actor: A })]),
		).toEqual([
			"Send 120 USDC to 0x9a01…77c2 will not be sent: you, its finaliser, said no.",
		]);
	});

	it("says whose signature was taken back", () => {
		expect(
			texts([eventRow("signature_removed", { digest: D1, actor: A })]),
		).toEqual([
			"You took back your signature on Send 120 USDC to 0x9a01…77c2.",
		]);
		expect(
			texts([eventRow("signature_removed", { digest: D1, actor: B })]),
		).toEqual([
			`${short(B)} took back their signature on Send 120 USDC to 0x9a01…77c2.`,
		]);
	});

	it("says who said no, and who took a no back", () => {
		expect(
			texts([eventRow("objection_added", { digest: D1, actor: B })]),
		).toEqual([`${short(B)} said no to Send 120 USDC to 0x9a01…77c2.`]);
		expect(
			texts([eventRow("objection_added", { digest: D1, actor: A })]),
		).toEqual(["You said no to Send 120 USDC to 0x9a01…77c2."]);
		expect(
			texts([eventRow("objection_removed", { digest: D1, actor: B })]),
		).toEqual([
			`${short(B)} took back their no to Send 120 USDC to 0x9a01…77c2.`,
		]);
		expect(
			texts([eventRow("objection_removed", { digest: D1, actor: A })]),
		).toEqual(["You took back your no to Send 120 USDC to 0x9a01…77c2."]);
	});

	it("tells a change of position as one step: a no that took a signature back, a signature in place of a no", () => {
		// the relay writes two entries for each; the log says each once
		const said = buildTimeline(
			[
				eventRow("signature_added", { id: 1, digest: D1, actor: B }),
				eventRow("signature_removed", { id: 2, digest: D1, actor: B }),
				eventRow("objection_added", { id: 3, digest: D1, actor: B }),
			],
			ctx(),
		);
		expect(said.map(entryText)).toEqual([
			`${short(B)} said no to Send 120 USDC to 0x9a01…77c2, taking back their signature.`,
			`${short(B)} signed Send 120 USDC to 0x9a01…77c2.`,
		]);
		expect(said[0]?.id).toBe(3);
		const signed = buildTimeline(
			[
				eventRow("objection_added", { id: 1, digest: D1, actor: A }),
				eventRow("objection_removed", { id: 2, digest: D1, actor: A }),
				eventRow("signature_added", { id: 3, digest: D1, actor: A }),
			],
			ctx(),
		);
		expect(signed.map(entryText)).toEqual([
			"You signed Send 120 USDC to 0x9a01…77c2, in place of your no.",
			"You said no to Send 120 USDC to 0x9a01…77c2.",
		]);
		expect(signed[0]?.id).toBe(3);
	});

	it("does not fold a co-signer's step into one's own, or a step on another proposal", () => {
		// B took a signature back; then C said no: two people, two entries
		expect(
			texts([
				eventRow("signature_removed", { id: 1, digest: D1, actor: B }),
				eventRow("objection_added", { id: 2, digest: D1, actor: C }),
			]),
		).toEqual([
			`${short(C)} said no to Send 120 USDC to 0x9a01…77c2.`,
			`${short(B)} took back their signature on Send 120 USDC to 0x9a01…77c2.`,
		]);
		// B took back a no on one proposal and signed another
		expect(
			texts([
				eventRow("objection_removed", { id: 1, digest: D1, actor: B }),
				eventRow("signature_added", { id: 2, digest: D2, actor: B }),
			]),
		).toEqual([
			`${short(B)} signed a proposal.`,
			`${short(B)} took back their no to Send 120 USDC to 0x9a01…77c2.`,
		]);
	});

	it("never calls a proposal Hyperliquid refused retryable", () => {
		const rejected = (data: Record<string, unknown>) =>
			texts([
				eventRow("submission_recorded", { digest: D1, actor: B, data }),
			])[0];
		// answered by Hyperliquid: the proposal's number is used up
		expect(rejected({ accepted: false, http_status: 200 })).toBe(
			`Hyperliquid did not accept Send 120 USDC to 0x9a01…77c2. Sent by ${short(B)}. Its page says why.`,
		);
		// never reached Hyperliquid's books: that one can go again
		expect(rejected({ accepted: false, http_status: 502 })).toBe(
			`Hyperliquid did not accept Send 120 USDC to 0x9a01…77c2. Sent by ${short(B)}. The request did not get through (HTTP 502), so it can be sent again.`,
		);
		// an entry that does not say: nothing is claimed either way
		expect(rejected({ accepted: false })).toBe(
			`Hyperliquid did not accept Send 120 USDC to 0x9a01…77c2. Sent by ${short(B)}. Open it to see why.`,
		);
	});

	it("falls back to 'a proposal' when the document is not at hand", () => {
		expect(
			texts([eventRow("proposal_withdrawn", { digest: D2, actor: B })]),
		).toEqual([`A proposal was cancelled by the proposer, ${short(B)}.`]);
		expect(
			texts([eventRow("signature_added", { digest: D2, actor: B })]),
		).toEqual([`${short(B)} signed a proposal.`]);
	});

	it("describes the treasury's own events", () => {
		expect(
			texts([
				eventRow("treasury_added", {
					actor: A,
					data: { signers: [A, B], threshold: 2 },
				}),
			]),
		).toEqual([
			`Treasury added by you. Signers: you, ${short(B)}. Threshold 2.`,
		]);
		expect(texts([eventRow("treasury_added", { actor: B, data: {} })])).toEqual(
			[`Treasury added by ${short(B)}.`],
		);
		// the account that was converted registered itself: nobody added it
		const self = eventRow("treasury_added", {
			actor: C,
			data: { signers: [A, B], threshold: 2 },
		});
		expect(texts([{ ...self, treasury: C }])).toEqual([
			`Treasury registered by the account itself when it was converted. Signers: you, ${short(B)}. Threshold 2.`,
		]);
		expect(
			texts([
				eventRow("signers_changed", {
					data: {
						added: [C],
						removed: [B],
						threshold_before: 2,
						threshold_after: 2,
					},
				}),
			]),
		).toEqual([
			`Signers changed: ${short(C)} added, ${short(B)} removed. Threshold stays 2.`,
		]);
		expect(
			texts([
				eventRow("signers_changed", {
					data: {
						added: [A],
						removed: [],
						threshold_before: 2,
						threshold_after: 3,
					},
				}),
			]),
		).toEqual(["Signers changed: you added. Threshold changed from 2 to 3."]);
		expect(
			texts([
				eventRow("signers_changed", {
					data: {
						added: [],
						removed: [],
						threshold_before: 2,
						threshold_after: 3,
					},
				}),
			]),
		).toEqual(["Threshold changed from 2 to 3."]);
		expect(texts([eventRow("treasury_frozen")])[0]).toMatch(
			/stopped being a multi-sig/,
		);
		expect(texts([eventRow("treasury_unfrozen")])).toEqual([
			"This account is a multi-sig again.",
		]);
	});

	it("speaks of everyone by address when nobody is signed in", () => {
		expect(
			texts([eventRow("signature_added", { digest: D1, actor: A })], null),
		).toEqual([`${short(A)} signed Send 120 USDC to 0x9a01…77c2.`]);
		expect(
			texts(
				[eventRow("proposal_withdrawn", { digest: D1, actor: null })],
				null,
			),
		).toEqual([
			"Send 120 USDC to 0x9a01…77c2 was cancelled by the proposer, someone.",
		]);
	});

	it("says when a proposal was carried out outside the tool, and who noticed", () => {
		const TX = `0x${"72".repeat(32)}`;
		expect(
			texts([
				eventRow("proposal_carried_out", {
					id: 5,
					digest: D1,
					data: { tx_hash: TX, tx_time: NOW, reported_by: B },
				}),
			]),
		).toEqual([
			`Send 120 USDC to 0x9a01…77c2 was carried out without being reported here. Its transaction was found on Hyperliquid; ${short(B)} noticed it.`,
		]);
		// the one who noticed, reading it
		expect(
			texts(
				[
					eventRow("proposal_carried_out", {
						id: 5,
						digest: D1,
						data: { tx_hash: TX, reported_by: B },
					}),
				],
				B,
			)[0],
		).toContain("; you noticed it.");
		expect(
			texts([eventRow("proposal_carried_out", { id: 5, digest: D1 })]),
		).toEqual([
			"Send 120 USDC to 0x9a01…77c2 was carried out without being reported here. Its transaction was found on Hyperliquid.",
		]);
	});

	it("says it once when the finaliser's own result arrives after all", () => {
		const carried = eventRow("proposal_carried_out", {
			id: 5,
			digest: D1,
			data: { reported_by: B },
		});
		const accepted = eventRow("submission_recorded", {
			id: 6,
			digest: D1,
			actor: C,
			data: { accepted: true, http_status: 200 },
		});
		expect(texts([carried, accepted])).toEqual([
			`Send 120 USDC to 0x9a01…77c2 was accepted by Hyperliquid. Sent by ${short(C)}.`,
		]);
		// a rejected attempt afterwards does not unsay that it was carried out
		const rejected = eventRow("submission_recorded", {
			id: 6,
			digest: D1,
			actor: C,
			data: { accepted: false, http_status: 200 },
		});
		expect(texts([carried, rejected])).toHaveLength(2);
		// and another proposal's acceptance has nothing to do with it
		expect(texts([carried, { ...accepted, digest: D2 }])).toHaveLength(2);
	});

	it("keeps an entry it cannot describe, and says so", () => {
		expect(
			texts([
				{
					...eventRow("unknown", { id: 9 }),
					rawKind: "treasury_renamed",
				},
			]),
		).toEqual([
			"An entry this version of the page cannot describe (“treasury_renamed”).",
		]);
	});

	it("orders by event id whatever order the rows arrive in", () => {
		const a = eventRow("treasury_unfrozen", { id: 9 });
		const b = eventRow("treasury_frozen", { id: 4 });
		expect(buildTimeline([b, a], ctx()).map((e) => e.id)).toEqual([9, 4]);
		expect(buildTimeline([a, b], ctx()).map((e) => e.id)).toEqual([9, 4]);
	});
});

describe("historyExport", () => {
	it("is one JSON file with the events in order and the proposal documents exactly as the core encodes them", async () => {
		const p = await signAs(makeProposal(), 1);
		const events = [
			eventRow("signature_added", {
				id: 2,
				treasury: TREASURY,
				digest: p.digest,
				actor: A,
			}),
			eventRow("proposal_created", {
				id: 1,
				treasury: TREASURY,
				digest: p.digest,
				actor: A,
				data: { finaliser: B },
			}),
		];
		const text = historyExport({
			network: "testnet",
			treasury: TREASURY,
			exportedAt: NOW,
			events,
			proposals: [p],
		});
		const parsed = JSON.parse(text);
		expect(parsed.format).toBe("hl-tools-multisig-history");
		expect(parsed.v).toBe(1);
		expect(parsed.treasury).toBe(TREASURY);
		expect(parsed.exportedAt).toBe(new Date(NOW).toISOString());
		expect(parsed.events.map((e: { id: number }) => e.id)).toEqual([1, 2]);
		expect(parsed.events[0]).toEqual({
			id: 1,
			at: new Date(NOW + 1000).toISOString(),
			kind: "proposal_created",
			actor: A,
			digest: p.digest,
			data: { finaliser: B },
		});
		expect(parsed.proposals).toHaveLength(1);
		expect(parsed.proposals[0].digest).toBe(p.digest);
		expect(parsed.proposals[0].signatures[0].signer).toBe(A);
		expect(text.endsWith("}\n")).toBe(true);
	});

	it("is valid JSON with no events and no proposals", () => {
		const parsed = JSON.parse(
			historyExport({
				network: "mainnet",
				treasury: TREASURY,
				exportedAt: NOW,
				events: [],
				proposals: [],
			}),
		);
		expect(parsed.events).toEqual([]);
		expect(parsed.proposals).toEqual([]);
		expect(parsed.network).toBe("mainnet");
	});

	it("names the file after the network and the treasury", () => {
		expect(historyFilename("testnet", TREASURY)).toBe(
			`multisig-history-testnet-${TREASURY.slice(0, 10)}.json`,
		);
		expect(historyFilename("testnet", TREASURY, "csv")).toBe(
			`multisig-history-testnet-${TREASURY.slice(0, 10)}.csv`,
		);
	});
});

describe("historyCsv", () => {
	it("lists the log oldest first, in UTC, every address whole, and the record only beside an accepted send", () => {
		const events = [
			eventRow("proposal_created", {
				id: 1,
				digest: D1,
				actor: A,
				data: { finaliser: C },
			}),
			eventRow("signature_added", { id: 2, digest: D1, actor: A }),
			eventRow("signature_added", { id: 3, digest: D1, actor: C }),
			eventRow("submission_recorded", {
				id: 4,
				digest: D1,
				actor: C,
				data: { accepted: true, http_status: 200 },
			}),
		];
		const entries = buildTimeline(events, ctx(null));
		const asked: Hex[][] = [];
		const csv = historyCsv(entries, (e) => {
			asked.push([...(e.accepted ?? [])]);
			return "on Hyperliquid's record";
		});
		expect(csv.columns).toEqual([
			"Time (UTC)",
			"What happened",
			"Proposal",
			"Hyperliquid's record",
		]);
		expect(csv.rows.map((r) => r[1])).toEqual([
			`${A} proposed Send 120 USDC to 0x9a01…77c2 and signed. Finaliser: ${C}.`,
			`${C} signed Send 120 USDC to 0x9a01…77c2.`,
			`Send 120 USDC to 0x9a01…77c2 was accepted by Hyperliquid. Sent by ${C}.`,
		]);
		expect(csv.rows.map((r) => r[0])).toEqual(
			entries
				.map((e) => new Date(e.at).toISOString().slice(0, 19).replace("T", " "))
				.reverse(),
		);
		expect(csv.rows.map((r) => r[2])).toEqual([D1, D1, D1]);
		expect(csv.rows.map((r) => r[3])).toEqual([
			null,
			null,
			"on Hyperliquid's record",
		]);
		expect(asked).toEqual([[D1]]);
	});
});

describe("a move of two steps in the Signing log", () => {
	const MOVE = "Stake 100 HYPE with 0x946b…5b21";
	const refs = {
		[D1]: { step: 1 as const, other: D2, line: MOVE },
		[D2]: { step: 2 as const, other: D1, line: MOVE },
	};
	const moved = (events: EventRow[], me: typeof A | null = A) =>
		buildTimeline(events, {
			...ctx(me),
			move: (d: Hex) => refs[d] ?? null,
		});
	const said = (events: EventRow[], me: typeof A | null = A) =>
		moved(events, me).map(entryText);
	const both = (
		kind: Parameters<typeof eventRow>[0],
		id: number,
		actor: typeof A,
		data: Record<string, unknown> = {},
	) => [
		eventRow(kind, { id, digest: D1, actor, data }),
		eventRow(kind, { id: id + 1, digest: D2, actor, data }),
	];

	it("says once what happened to both steps alike", () => {
		const events = [
			...both("proposal_created", 1, A, { finaliser: C }),
			...both("signature_added", 3, A),
			...both("signature_added", 5, C),
			...both("submission_recorded", 7, C, { accepted: true }),
		];
		expect(said(events)).toEqual([
			`${MOVE} (both steps) was accepted by Hyperliquid. Sent by ${short(C)}.`,
			`${short(C)} signed ${MOVE} (both steps).`,
			`You proposed ${MOVE} (both steps) and signed. Finaliser: ${short(C)}.`,
		]);
		// one entry for both steps checks both against Hyperliquid's record
		expect(moved(events)[0]?.accepted).toEqual([D1, D2]);
	});

	it("an entry for both steps opens the move, and sorts by its later event", () => {
		const [entry] = moved(both("signature_added", 5, C));
		expect(entry).toMatchObject({ id: 6, digest: D1 });
		expect(entry?.parts).toContainEqual({ text: MOVE, strong: true });
		expect(entry?.parts).toContainEqual({ text: " (both steps)", quiet: true });
	});

	it("names the step where the two did not fare alike", () => {
		// C signed step 1 only; Hyperliquid took step 1 and refused step 2
		const events = [
			eventRow("signature_added", { id: 1, digest: D1, actor: C }),
			eventRow("submission_recorded", {
				id: 2,
				digest: D1,
				actor: C,
				data: { accepted: true },
			}),
			eventRow("submission_recorded", {
				id: 3,
				digest: D2,
				actor: C,
				data: { accepted: false, http_status: 200 },
			}),
		];
		expect(said(events)).toEqual([
			`Hyperliquid did not accept ${MOVE} (step 2 of 2). Sent by ${short(C)}. Its page says why.`,
			`${MOVE} (step 1 of 2) was accepted by Hyperliquid. Sent by ${short(C)}.`,
			`${short(C)} signed ${MOVE} (step 1 of 2).`,
		]);
	});

	it("a proposer who signed only one of the two: each step says its own", () => {
		const events = [
			...both("proposal_created", 1, A, { finaliser: C }),
			eventRow("signature_added", { id: 3, digest: D1, actor: A }),
		];
		expect(said(events)).toEqual([
			`You proposed ${MOVE} (step 1 of 2) and signed. Finaliser: ${short(C)}.`,
			`You proposed ${MOVE} (step 2 of 2). Finaliser: ${short(C)}.`,
		]);
	});

	it("a no to both, a withdrawal of both and a change of mind read as one step each", () => {
		const noAfterSigning = [
			eventRow("signature_removed", { id: 1, digest: D1, actor: C }),
			eventRow("objection_added", { id: 2, digest: D1, actor: C }),
			eventRow("signature_removed", { id: 3, digest: D2, actor: C }),
			eventRow("objection_added", { id: 4, digest: D2, actor: C }),
		];
		expect(said(noAfterSigning)).toEqual([
			`${short(C)} said no to ${MOVE} (both steps), taking back their signature.`,
		]);
		expect(said(both("objection_removed", 1, C))).toEqual([
			`${short(C)} took back their no to ${MOVE} (both steps).`,
		]);
		expect(said(both("proposal_withdrawn", 1, A))).toEqual([
			`${MOVE} (both steps) was cancelled by the proposer, you.`,
		]);
	});

	it("does not take together what happened at different times", () => {
		const events = [
			eventRow("signature_added", { id: 1, digest: D1, actor: C }),
			// ten minutes later
			eventRow("signature_added", { id: 601, digest: D2, actor: C }),
		];
		expect(said(events)).toEqual([
			`${short(C)} signed ${MOVE} (step 2 of 2).`,
			`${short(C)} signed ${MOVE} (step 1 of 2).`,
		]);
	});

	it("a proposal that stands alone reads as before", () => {
		const alone = `0x${"d3".repeat(32)}` as Hex;
		expect(
			said([eventRow("signature_added", { id: 1, digest: alone, actor: C })]),
		).toEqual([`${short(C)} signed a proposal.`]);
	});
});
