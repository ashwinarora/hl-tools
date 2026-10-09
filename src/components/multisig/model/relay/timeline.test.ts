import type { Hex } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, makeProposal, NOW, signAs, TREASURY } from "#/test/keys";
import { eventRow } from "#/test/relayRows";
import type { EventRow } from "./rows";
import {
	buildTimeline,
	entryText,
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
			`Send 120 USDC to 0x9a01…77c2 was accepted by Hyperliquid. Submitted by ${short(C)}.`,
			`${short(C)} signed Send 120 USDC to 0x9a01…77c2.`,
			`You proposed Send 120 USDC to 0x9a01…77c2 and signed. Finaliser: ${short(C)}.`,
		]);
	});

	it("marks the action line, and only it, as the strong part", () => {
		const [entry] = buildTimeline(
			[eventRow("signature_added", { id: 1, digest: D1, actor: B })],
			ctx(),
		);
		expect(entry?.parts).toEqual([
			{ text: `${short(B)} signed ` },
			{ text: "Send 120 USDC to 0x9a01…77c2", strong: true },
			{ text: "." },
		]);
		expect(entry?.digest).toBe(D1);
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
			`Send 120 USDC to 0x9a01…77c2 was withdrawn by the proposer, ${short(B)}.`,
		]);
		expect(
			texts([eventRow("proposal_declined", { digest: D1, actor: A })]),
		).toEqual([
			"Send 120 USDC to 0x9a01…77c2 was declined by the finaliser, you.",
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

	it("reports a rejection as retryable", () => {
		expect(
			texts([
				eventRow("submission_recorded", {
					digest: D1,
					actor: B,
					data: { accepted: false },
				}),
			]),
		).toEqual([
			`Hyperliquid rejected Send 120 USDC to 0x9a01…77c2. Submitted by ${short(B)}; it can be retried.`,
		]);
	});

	it("falls back to 'a proposal' when the document is not at hand", () => {
		expect(
			texts([eventRow("proposal_withdrawn", { digest: D2, actor: B })]),
		).toEqual([`A proposal was withdrawn by the proposer, ${short(B)}.`]);
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
			"Send 120 USDC to 0x9a01…77c2 was withdrawn by the proposer, someone.",
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
	});
});
