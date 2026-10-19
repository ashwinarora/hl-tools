import { describe, expect, it } from "vitest";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import {
	done,
	failed,
	HIDE_COPY,
	mergeToast,
	PROVENANCE_CLOSE,
	stepAccepted,
	stepNotSent,
	TOAST_LINE_MAX,
	TOAST_LINES,
	TOAST_MS,
	TOAST_TITLES,
	unsure,
} from "./toasts";

describe("what a toast says", () => {
	const all = [
		...Object.values(TOAST_TITLES),
		...Object.values(TOAST_LINES),
		...Object.values(HIDE_COPY),
		PROVENANCE_CLOSE,
		stepAccepted(1),
		stepNotSent(2),
	];

	it("claims nothing the section must not claim", () => {
		for (const text of all)
			for (const claim of FORBIDDEN_CLAIMS) expect(text).not.toMatch(claim);
	});

	it("closes by itself, a failure a little later than a success", () => {
		expect(TOAST_MS.done).toBeGreaterThan(0);
		expect(TOAST_MS.failed).toBeGreaterThan(TOAST_MS.done);
		expect(TOAST_MS.failed).toBeLessThanOrEqual(10_000);
	});

	it("says what merging a returned copy came to", () => {
		expect(mergeToast({ kind: "merged", added: 2 })).toEqual({
			tone: "done",
			title: "Signatures added from the copy",
			line: "2 new signatures.",
		});
		expect(mergeToast({ kind: "merged", added: 1 }).line).toBe(
			"1 new signature.",
		);
		expect(mergeToast({ kind: "merged", added: 0 })).toEqual({
			tone: "done",
			title: "Nothing new in that copy",
		});
		expect(mergeToast({ kind: "other" }).tone).toBe("unsure");
		expect(
			mergeToast({ kind: "failed", issues: [{ message: "Not a proposal." }] }),
		).toEqual({
			tone: "failed",
			title: "Nothing was added from the copy",
			line: "Not a proposal.",
		});
	});

	it("says a result it cannot call yet as such, its line cut short", () => {
		expect(unsure("Accepted, not confirmed yet", "y".repeat(300))).toEqual({
			tone: "unsure",
			title: "Accepted, not confirmed yet",
			line: `${"y".repeat(TOAST_LINE_MAX)}…`,
		});
		expect(unsure("Waiting")).toEqual({ tone: "unsure", title: "Waiting" });
	});

	it("gives a result that went through its line only when there is one", () => {
		expect(done(TOAST_TITLES.signed, TOAST_LINES.signedOnly)).toEqual({
			tone: "done",
			title: "Signature added",
			line: "Nothing is sent until the finaliser sends it.",
		});
		expect(done(TOAST_TITLES.cancelled)).toEqual({
			tone: "done",
			title: "Cancelled for everyone",
		});
	});

	it("gives a failure its first reason, cut short, from whatever shape it came in", () => {
		const long = `Hyperliquid would refuse it: ${"x".repeat(400)}`;
		expect(failed(TOAST_TITLES.notSent, [{ message: long }]).line).toBe(
			`${long.slice(0, TOAST_LINE_MAX)}…`,
		);
		expect(
			failed(TOAST_TITLES.notSigned, [
				{ message: "Your wallet did not sign." },
				{ message: "second" },
			]),
		).toEqual({
			tone: "failed",
			title: "Not signed",
			line: "Your wallet did not sign.",
		});
		expect(failed(TOAST_TITLES.notShared, { message: " Offline. " }).line).toBe(
			"Offline.",
		);
		expect(failed(TOAST_TITLES.notAdded, "Not a multi-sig.").line).toBe(
			"Not a multi-sig.",
		);
		for (const nothing of [undefined, null, [], "  ", { message: "" }])
			expect(failed(TOAST_TITLES.notCreated, nothing)).toEqual({
				tone: "failed",
				title: "Not created",
			});
	});
});
