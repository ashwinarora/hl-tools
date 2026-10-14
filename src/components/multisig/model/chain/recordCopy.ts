/**
 * What the screens say about a proposal that reads as accepted, once
 * Hyperliquid's record was looked at (`record.ts`). One sentence each; the
 * screen adds the time and the link. Only a missing or refused transaction
 * is said loudly: that is when a report of acceptance cannot be believed.
 */
import type { OnRecord } from "./record";

/**
 * ok     the record agrees
 * stop   the record does not hold it: never folded away
 * wrong  the record says it was refused
 * quiet  nothing can be said yet, or not by the record
 */
export type RecordTone = "ok" | "stop" | "wrong" | "quiet";

export interface RecordLine {
	readonly tone: RecordTone;
	readonly text: string;
	/** Offer to read the record again. */
	readonly again: boolean;
}

export function recordLine(v: OnRecord): RecordLine {
	switch (v.kind) {
		case "found":
			return { tone: "ok", text: "On Hyperliquid's record.", again: false };
		case "likely":
			return {
				tone: "quiet",
				text: "Hyperliquid's record shows a vault step like this one carried out. A vault step carries no number of its own, so it may be another one like it.",
				again: false,
			};
		case "refused":
			return {
				tone: "wrong",
				// Hyperliquid's reason ends with its own full stop, or not
				text: `Hyperliquid's record shows it was refused: ${v.error.trim().replace(/\.+$/, "") || "no reason given"}. It was not carried out, whatever the report of its sending says.`,
				again: false,
			};
		case "missing":
			return {
				tone: "stop",
				text: "Hyperliquid's record has no transaction for this proposal, so we can't confirm it went through.",
				again: false,
			};
		case "too-old":
			return {
				tone: "quiet",
				text: "Too old to check: Hyperliquid's record lists the treasury's newest 300 transactions.",
				again: false,
			};
		case "just-sent":
			return {
				tone: "quiet",
				text: "Sent a moment ago: Hyperliquid's record may not list it yet.",
				again: false,
			};
		case "checking":
			return {
				tone: "quiet",
				text: "Checking Hyperliquid's record…",
				again: false,
			};
		case "unchecked":
			return {
				tone: "quiet",
				text: "Hyperliquid's record could not be read just now.",
				again: true,
			};
	}
}

/** The few words a list row carries; null where the row says nothing more. */
export function recordTag(
	v: OnRecord,
): { readonly text: string; readonly tone: RecordTone } | null {
	switch (v.kind) {
		case "found":
			return { text: "on Hyperliquid's record", tone: "ok" };
		case "missing":
			return { text: "not on Hyperliquid's record", tone: "stop" };
		case "refused":
			return { text: "refused on Hyperliquid's record", tone: "wrong" };
		default:
			return null;
	}
}

/** One tag for several proposals (both steps of a move): the worst word wins, and "on record" only for all. */
export function recordTagOf(
	verdicts: readonly OnRecord[],
): { readonly text: string; readonly tone: RecordTone } | null {
	const tags = verdicts.map(recordTag);
	return (
		tags.find((t) => t?.tone === "wrong") ??
		tags.find((t) => t?.tone === "stop") ??
		(tags.length > 0 && tags.every((t) => t?.tone === "ok") ? tags[0] : null) ??
		null
	);
}
