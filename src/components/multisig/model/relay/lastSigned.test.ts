import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C } from "#/test/keys";
import { FORBIDDEN_CLAIMS } from "./copy";
import {
	lastSigned,
	lastSignedText,
	missedByWindow,
	SIGNED_WINDOW,
} from "./lastSigned";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const row = (actor: Address | null, hoursAgo: number) => ({
	actor,
	at: NOW - hoursAgo * HOUR,
});

describe("last signed, next to each signer", () => {
	it("takes the newest signature of each signer, whatever order the rows come in", () => {
		const got = lastSigned({
			rows: [row(A, 1), row(B, 5), row(A, 30), row(null, 2)],
			signers: [A, B, C],
			complete: true,
		});
		expect(got.get(A)).toEqual({ kind: "signed", at: NOW - HOUR });
		expect(got.get(B)).toEqual({ kind: "signed", at: NOW - 5 * HOUR });
		// everything on record was read: C has none
		expect(got.get(C)).toEqual({ kind: "none" });
	});

	it("claims nothing about a signer a full window did not reach", () => {
		const rows = Array.from({ length: SIGNED_WINDOW }, (_, i) => row(A, i));
		expect(missedByWindow(rows, [A, B, C], false)).toEqual([B, C]);
		expect(missedByWindow(rows, [A, B, C], true)).toEqual([]);
		const got = lastSigned({ rows, signers: [A, B, C], complete: false });
		expect(got.get(A)?.kind).toBe("signed");
		expect(got.get(B)).toEqual({ kind: "unknown" });
		expect(lastSignedText(got.get(B), NOW)).toBe("");
	});

	it("uses the signer's own newest signature once it was read by itself", () => {
		const rows = Array.from({ length: SIGNED_WINDOW }, (_, i) => row(A, i));
		const got = lastSigned({
			rows,
			signers: [A, B, C],
			complete: false,
			// B signed long ago; C never did; nothing came back for nobody else
			single: new Map([
				[B, row(B, 24 * 90)],
				[C, null],
			]),
		});
		expect(got.get(B)).toEqual({ kind: "signed", at: NOW - 24 * 90 * HOUR });
		expect(got.get(C)).toEqual({ kind: "none" });
		expect(lastSignedText(got.get(B), NOW)).toBe("last signed 90 days ago");
	});

	it("says it in words that do not judge the signer", () => {
		expect(lastSignedText({ kind: "signed", at: NOW - 2 * HOUR }, NOW)).toBe(
			"last signed 2 hours ago",
		);
		const none = lastSignedText({ kind: "none" }, NOW);
		expect(none).toBe("no signature here yet");
		expect(none).not.toMatch(/cannot|never|inactive/i);
		for (const claim of FORBIDDEN_CLAIMS) expect(none).not.toMatch(claim);
		expect(lastSignedText(undefined, NOW)).toBe("");
		// a relay clock a little ahead of this one is still the past
		expect(lastSignedText({ kind: "signed", at: NOW + 90_000 }, NOW)).toBe(
			"last signed less than a minute ago",
		);
	});
});
