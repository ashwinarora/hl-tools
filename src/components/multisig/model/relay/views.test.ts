import { describe, expect, it } from "vitest";
import { A, B, C } from "#/test/keys";
import { seenBy, seenLabel, shouldRecordView, type ViewRow } from "./views";

const T0 = 1_791_000_000_000;
const views: ViewRow[] = [{ signer: B, seenAt: T0 + 60_000 }];
const of = (signer: typeof A, over = {}) =>
	seenBy(signer, { counted: [A], views, proposer: A, createdAt: T0, ...over });

describe("seenBy", () => {
	it("a signature says more than a look", () => {
		expect(of(A)).toEqual({ kind: "signed" });
		expect(of(B, { counted: [A, B] })).toEqual({ kind: "signed" });
	});
	it("tells who has opened it, and when, from who has not", () => {
		expect(of(B)).toEqual({ kind: "seen", at: T0 + 60_000, proposed: false });
		expect(of(C)).toEqual({ kind: "unseen" });
	});
	it("the proposer has seen their own proposal, from the moment they shared it", () => {
		expect(of(A, { counted: [] })).toEqual({
			kind: "seen",
			at: T0,
			proposed: true,
		});
		// even with a later recorded view
		expect(
			of(A, { counted: [], views: [{ signer: A, seenAt: T0 + 5 }] }),
		).toEqual({ kind: "seen", at: T0, proposed: true });
	});
	it("says nothing when the relay does not have the proposal", () => {
		expect(of(C, { views: null })).toEqual({ kind: "unknown" });
		// a signature still counts: it is in the document
		expect(of(A, { views: null })).toEqual({ kind: "signed" });
	});
});

describe("shouldRecordView", () => {
	const base = {
		visible: true,
		known: true,
		open: true,
		me: C,
		signer: true,
		views,
		proposer: A,
	};
	it("records a signer's first look at an open, shared proposal", () => {
		expect(shouldRecordView(base)).toBe(true);
	});
	it("never from a tab nobody is looking at", () => {
		expect(shouldRecordView({ ...base, visible: false })).toBe(false);
	});
	it("never before the relay's copy is on screen and verified", () => {
		expect(shouldRecordView({ ...base, known: false })).toBe(false);
		expect(shouldRecordView({ ...base, views: null })).toBe(false);
	});
	it("not for a closed or expired proposal, a wallet that is not signed in, or one that does not sign here", () => {
		expect(shouldRecordView({ ...base, open: false })).toBe(false);
		expect(shouldRecordView({ ...base, me: null })).toBe(false);
		expect(shouldRecordView({ ...base, signer: false })).toBe(false);
	});
	it("once: not again when the relay already has it, and never for the proposer", () => {
		expect(shouldRecordView({ ...base, me: B })).toBe(false);
		expect(shouldRecordView({ ...base, me: A })).toBe(false);
	});
});

describe("seenLabel", () => {
	const now = T0 + 3 * 3_600_000;
	const say = (seen: Parameters<typeof seenLabel>[0], closed = false) =>
		seenLabel(seen, { closed, now }).text;
	it("states what happened and passes no verdict", () => {
		expect(say({ kind: "signed" })).toBe("signed · verified");
		expect(say({ kind: "seen", at: T0, proposed: false })).toBe(
			"seen 3 hours ago, not signed",
		);
		expect(say({ kind: "seen", at: now - 5_000, proposed: false })).toBe(
			"seen just now, not signed",
		);
		expect(say({ kind: "unseen" })).toBe("not seen yet");
	});
	it("says nothing about looking when the relay does not have the proposal", () => {
		expect(say({ kind: "unknown" })).toBe("not yet");
	});
	it("drops who looked once nothing more can be signed", () => {
		expect(say({ kind: "seen", at: T0, proposed: false }, true)).toBe(
			"did not sign",
		);
		expect(say({ kind: "unseen" }, true)).toBe("did not sign");
		expect(say({ kind: "signed" }, true)).toBe("signed · verified");
	});
	it("carries the moment, for the exact time on hover", () => {
		expect(
			seenLabel(
				{ kind: "seen", at: T0, proposed: true },
				{ closed: false, now },
			),
		).toEqual({ text: "seen 3 hours ago, not signed", signed: false, at: T0 });
	});
});
