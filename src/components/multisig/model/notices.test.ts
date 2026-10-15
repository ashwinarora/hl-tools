import { describe, expect, it } from "vitest";
import {
	copyNotesShown,
	type NoticeId,
	nextStepLabel,
	notesLabel,
	planNotices,
} from "./notices";

const ALL_IDS: readonly NoticeId[] = [
	"aside",
	"sharing-notes",
	"shortfall",
	"copy-notes",
	"record",
	"not-saved",
	"sharing",
	"older-sends",
	"refused-now",
	"copy-refusal",
	"rejected",
	"signers-changed",
	"sharing-refused",
];
const ALL = Object.fromEntries(ALL_IDS.map((id) => [id, 1]));

describe("the notices above a proposal's action", () => {
	it("shows what must not be missed in full, first, and folds the rest", () => {
		expect(planNotices(ALL)).toEqual({
			stops: [
				"record",
				"refused-now",
				"shortfall",
				"older-sends",
				"rejected",
				"signers-changed",
				"not-saved",
				"sharing-refused",
			],
			notes: [
				"copy-refusal",
				"copy-notes",
				"aside",
				"sharing",
				"sharing-notes",
			],
			noteCount: 5,
		});
	});

	it("never folds a stop notice, and places every notice once", () => {
		const plan = planNotices(ALL);
		expect([...plan.stops, ...plan.notes].sort()).toEqual([...ALL_IDS].sort());
		for (const id of [
			"record",
			"shortfall",
			"older-sends",
			"refused-now",
		] as const)
			expect(planNotices({ [id]: 1 }).notes).toEqual([]);
	});

	it("shows only what is there", () => {
		expect(planNotices({})).toEqual({ stops: [], notes: [], noteCount: 0 });
		expect(planNotices({ aside: 1, sharing: 0, shortfall: 0 })).toEqual({
			stops: [],
			notes: ["aside"],
			noteCount: 1,
		});
	});

	it("counts every folded callout, several under one id", () => {
		expect(planNotices({ "sharing-notes": 3, aside: 1, record: 1 })).toEqual({
			stops: ["record"],
			notes: ["aside", "sharing-notes"],
			noteCount: 4,
		});
	});

	it("leaves what was only for information out of a copy's notes", () => {
		expect(
			copyNotesShown([
				{ severity: "info", code: "a" },
				{ severity: "warning", code: "b" },
				{ severity: "error", code: "c" },
			]).map((i) => i.code),
		).toEqual(["b", "c"]);
		expect(copyNotesShown(undefined)).toEqual([]);
	});

	it("names the phone's bottom button after what the wallet can do now", () => {
		expect(nextStepLabel({ canSign: true, canExecute: false })).toBe("Sign");
		expect(
			nextStepLabel({
				canSign: true,
				canExecute: true,
				executeAddsSignature: true,
			}),
		).toBe("Sign and send to Hyperliquid");
		expect(
			nextStepLabel({
				canSign: false,
				canExecute: true,
				executeAddsSignature: false,
			}),
		).toBe("Send to Hyperliquid");
		expect(nextStepLabel({ canSign: false, canExecute: false })).toBeNull();
	});

	it("counts the folded notes", () => {
		expect(notesLabel(1)).toBe("1 note");
		expect(notesLabel(3)).toBe("3 notes");
	});
});
