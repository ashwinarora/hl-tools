/**
 * Who has seen an open proposal. The relay keeps one fact per signer ("opened
 * it, at this time") and shares it with the treasury's signers, so someone
 * waiting for signatures can tell "has not looked yet" from "looked, has not
 * signed". Pure: what a row of the signatures list says, and when this page
 * may record that its own reader has looked.
 */
import type { Address } from "@hl-tools/core";
import { fromNow } from "../time";

export interface ViewRow {
	readonly signer: Address;
	/** Unix ms. */
	readonly seenAt: number;
}

/**
 * signed   their signature is on the proposal and verifies
 * seen     they opened it (or proposed it) and have not signed
 * unseen   the relay has no sign that they opened it
 * unknown  nothing can be said: the proposal is not on the relay
 */
export type Seen =
	| { readonly kind: "signed" }
	| { readonly kind: "seen"; readonly at: number; readonly proposed: boolean }
	| { readonly kind: "unseen" }
	| { readonly kind: "unknown" };

export function seenBy(
	signer: Address,
	i: {
		/** Signers whose signature verified. */
		readonly counted: readonly Address[];
		/** Null when the relay does not have the proposal. */
		readonly views: readonly ViewRow[] | null;
		/** Who shared it, and when: the proposer has seen their own proposal. */
		readonly proposer: Address | null;
		readonly createdAt: number | null;
	},
): Seen {
	if (i.counted.includes(signer)) return { kind: "signed" };
	if (i.views === null) return { kind: "unknown" };
	const view = i.views.find((v) => v.signer === signer);
	if (signer === i.proposer && i.createdAt !== null)
		return {
			kind: "seen",
			at: Math.min(i.createdAt, view?.seenAt ?? i.createdAt),
			proposed: true,
		};
	return view
		? { kind: "seen", at: view.seenAt, proposed: false }
		: { kind: "unseen" };
}

/**
 * Whether this page may tell the relay that its reader has seen a proposal.
 * Only when a person is in fact looking at the relay's own, verified copy,
 * as the wallet that is signed in:
 */
export function shouldRecordView(i: {
	/** The tab is in front (not a background tab, not a prerender). */
	readonly visible: boolean;
	/** The relay has the proposal and its copy verified in this browser. */
	readonly known: boolean;
	/** Still collecting: open on the relay and inside its signing window. */
	readonly open: boolean;
	/** The signed-in wallet, which is also the connected one (relay mode "on"). */
	readonly me: Address | null;
	/** `me` is in the relay's copy of the treasury's signers. */
	readonly signer: boolean;
	/** The relay already has `me`'s view. */
	readonly views: readonly ViewRow[] | null;
	readonly proposer: Address | null;
}): boolean {
	if (!i.visible || !i.known || !i.open || !i.me || !i.signer) return false;
	if (i.views === null) return false;
	// the proposer's own look is implied; a recorded one would only add noise
	if (i.me === i.proposer) return false;
	return !i.views.some((v) => v.signer === i.me);
}

export interface SeenLabel {
	readonly text: string;
	readonly signed: boolean;
	/** The moment the text speaks of (for the exact time on hover); null when it names none. */
	readonly at: number | null;
}

/**
 * What a signer's row says. Factual, never a verdict: someone who looked and
 * has not signed is "seen …, not signed", not "refused".
 */
export function seenLabel(
	seen: Seen,
	o: {
		/** Nothing more can be signed: who looked no longer matters. */
		readonly closed: boolean;
		readonly now: number;
	},
): SeenLabel {
	if (seen.kind === "signed")
		return { text: "signed · verified", signed: true, at: null };
	if (o.closed) return { text: "did not sign", signed: false, at: null };
	if (seen.kind === "seen") {
		const when =
			o.now - seen.at < 60_000 ? "just now" : fromNow(seen.at, o.now);
		return { text: `seen ${when}, not signed`, signed: false, at: seen.at };
	}
	return {
		text: seen.kind === "unseen" ? "not seen yet" : "not yet",
		signed: false,
		at: null,
	};
}
