/**
 * The proposal nonce doubles as its deadline: the chain accepts a nonce from
 * one day before it until two days after it. "now" gives signers two days;
 * dating the nonce 23 hours ahead keeps it submittable at once and gives
 * almost three.
 */
import { nonceWindow } from "@hl-tools/core";

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
}

const minute = (ms: number) =>
	`${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function describeWindow(nonce: number, now: number): WindowInfo {
	const { validFrom, validUntil } = nonceWindow(nonce);
	const submittableNow = now > validFrom && now < validUntil;
	const hoursLeft = Math.max(0, Math.floor((validUntil - now) / 3_600_000));
	const text =
		now >= validUntil
			? `closed ${minute(validUntil)}`
			: now <= validFrom
				? `opens ${minute(validFrom)}, closes ${minute(validUntil)}`
				: `submittable until ${minute(validUntil)} (${hoursLeft} h left)`;
	return { validFrom, validUntil, submittableNow, hoursLeft, text };
}
