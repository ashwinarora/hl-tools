import { describe, expect, it } from "vitest";
import { HELP_JARGON } from "../help";
import { FORBIDDEN_CLAIMS } from "../relay/copy";
import type { OnRecord } from "./record";
import { recordLine, recordTag, recordTagOf } from "./recordCopy";

const EVERY: readonly OnRecord[] = [
	{ kind: "found", hash: "0x1", time: 1 },
	{ kind: "likely", hash: "0x1", time: 1 },
	{ kind: "refused", hash: "0x1", time: 1, error: "Insufficient balance." },
	{ kind: "refused", hash: "0x1", time: 1, error: "" },
	{ kind: "missing" },
	{ kind: "too-old" },
	{ kind: "just-sent" },
	{ kind: "checking" },
	{ kind: "unchecked" },
];

describe("what the screens say of Hyperliquid's record", () => {
	it("is plain words, and claims nothing it cannot back", () => {
		for (const v of EVERY) {
			const texts = [recordLine(v).text, recordTag(v)?.text ?? ""];
			for (const text of texts) {
				for (const p of HELP_JARGON) expect(text).not.toMatch(p);
				for (const p of FORBIDDEN_CLAIMS) expect(text).not.toMatch(p);
			}
		}
	});

	it("says loudly only a missing or refused transaction", () => {
		const tones = EVERY.map((v) => [v.kind, recordLine(v).tone]);
		expect(tones).toEqual([
			["found", "ok"],
			["likely", "quiet"],
			["refused", "wrong"],
			["refused", "wrong"],
			["missing", "stop"],
			["too-old", "quiet"],
			["just-sent", "quiet"],
			["checking", "quiet"],
			["unchecked", "quiet"],
		]);
		expect(recordLine({ kind: "missing" }).text).toBe(
			"Hyperliquid's record has no transaction for this proposal, so we can't confirm it went through.",
		);
		// Hyperliquid's reason is passed on as it was given
		expect(recordLine(EVERY[2] as OnRecord).text).toContain(
			"refused: Insufficient balance.",
		);
		expect(recordLine(EVERY[3] as OnRecord).text).toContain("no reason given");
	});

	it("offers to look again only where the record could not be read", () => {
		expect(EVERY.filter((v) => recordLine(v).again).map((v) => v.kind)).toEqual(
			["unchecked"],
		);
	});

	it("tags a row only with what the record says for certain", () => {
		expect(EVERY.map((v) => recordTag(v)?.tone ?? null)).toEqual([
			"ok",
			null,
			"wrong",
			"wrong",
			"stop",
			null,
			null,
			null,
			null,
		]);
	});
});

describe("one tag for both steps of a move", () => {
	const found: OnRecord = { kind: "found", hash: "0x1", time: 1 };
	it("says the worst, and on record only when both are", () => {
		expect(recordTagOf([found, found])?.tone).toBe("ok");
		expect(recordTagOf([found, { kind: "missing" }])?.tone).toBe("stop");
		expect(
			recordTagOf([
				{ kind: "missing" },
				{ kind: "refused", hash: "0x", time: 1, error: "x" },
			])?.tone,
		).toBe("wrong");
		expect(recordTagOf([found, { kind: "checking" }])).toBeNull();
		expect(recordTagOf([])).toBeNull();
	});
});
