/**
 * "Last signed", next to each signer of a treasury: when that signer last
 * signed one of its proposals through the relay. It is read from the history
 * the relay already keeps (`signature_added`), newest first, a window at a
 * time. Three answers, and the third matters: a signer whose last signature
 * is older than the window must not read "no signature here yet".
 *
 * It only knows signatures that passed through the relay: one made with
 * another tool, or passed by hand, is not there. So the wording never says a
 * signer cannot or does not sign.
 */
import type { Address } from "@hl-tools/core";
import { fromNow } from "../time";

/** How many of the newest signatures are read in one go. */
export const SIGNED_WINDOW = 500;

export type LastSigned =
	/** The newest signature by this signer on record. */
	| { readonly kind: "signed"; readonly at: number }
	/** Every signature on record was read, and none is by this signer. */
	| { readonly kind: "none" }
	/** Not known: the window did not reach back far enough, or the read failed. */
	| { readonly kind: "unknown" };

/** As much of a history entry as this needs. */
export interface SignedRow {
	readonly actor: Address | null;
	readonly at: number;
}

export function lastSigned(input: {
	/** `signature_added` entries, newest first. */
	readonly rows: readonly SignedRow[];
	readonly signers: readonly Address[];
	/** The read returned fewer entries than the window: nothing older exists. */
	readonly complete: boolean;
	/**
	 * For signers the window missed: their newest signature read by itself
	 * (null: there is none). A signer absent from this map was not asked about.
	 */
	readonly single?: ReadonlyMap<Address, SignedRow | null>;
}): Map<Address, LastSigned> {
	const newest = new Map<Address, number>();
	for (const r of input.rows) {
		if (r.actor === null) continue;
		const have = newest.get(r.actor);
		if (have === undefined || r.at > have) newest.set(r.actor, r.at);
	}
	const out = new Map<Address, LastSigned>();
	for (const s of input.signers) {
		const at = newest.get(s);
		if (at !== undefined) {
			out.set(s, { kind: "signed", at });
			continue;
		}
		if (input.complete) {
			out.set(s, { kind: "none" });
			continue;
		}
		const one = input.single?.get(s);
		out.set(
			s,
			one === undefined
				? { kind: "unknown" }
				: one === null
					? { kind: "none" }
					: { kind: "signed", at: one.at },
		);
	}
	return out;
}

/** The signers a full window said nothing about: each is asked about by itself. */
export function missedByWindow(
	rows: readonly SignedRow[],
	signers: readonly Address[],
	complete: boolean,
): Address[] {
	if (complete) return [];
	const seen = new Set(rows.map((r) => r.actor));
	return signers.filter((s) => !seen.has(s));
}

/** The words under a signer's name; empty when nothing is known. */
export function lastSignedText(l: LastSigned | undefined, now: number): string {
	if (!l || l.kind === "unknown") return "";
	return l.kind === "none"
		? "no signature here yet"
		: `last signed ${fromNow(l.at, now)}`;
}
