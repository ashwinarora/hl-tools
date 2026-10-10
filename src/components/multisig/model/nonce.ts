/**
 * The proposal nonce doubles as its deadline: the chain accepts a nonce from
 * one day before it until two days after it. "now" gives signers two days;
 * dating the nonce 23 hours ahead keeps it submittable at once and gives
 * almost three.
 */
import { nonceWindow } from "@hl-tools/core";
import { type Part, partsText, say } from "./parts";

export type NonceMode = "now" | "extended";

export const EXTENDED_OFFSET_MS = 23 * 60 * 60 * 1000;

export function nonceFor(mode: NonceMode, now: number = Date.now()): number {
	return mode === "extended" ? now + EXTENDED_OFFSET_MS : now;
}

export interface WindowInfo {
	readonly validFrom: number;
	readonly validUntil: number;
	readonly submittableNow: boolean;
	/** Whole hours until the window closes (0 once closed). */
	readonly hoursLeft: number;
	readonly text: string;
	/** The same sentence with its moments marked, so a screen can show them in local time. */
	readonly parts: readonly Part[];
}

const minute = (ms: number) =>
	`${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function describeWindow(nonce: number, now: number): WindowInfo {
	const { validFrom, validUntil } = nonceWindow(nonce);
	const submittableNow = now > validFrom && now < validUntil;
	const hoursLeft = Math.max(0, Math.floor((validUntil - now) / 3_600_000));
	const at = (ms: number): Part => ({ text: minute(ms), when: ms });
	const parts =
		now >= validUntil
			? say`closed ${at(validUntil)}`
			: now <= validFrom
				? say`opens ${at(validFrom)}, closes ${at(validUntil)}`
				: say`submittable until ${at(validUntil)} (${String(hoursLeft)} h left)`;
	return {
		validFrom,
		validUntil,
		submittableNow,
		hoursLeft,
		text: partsText(parts),
		parts,
	};
}
