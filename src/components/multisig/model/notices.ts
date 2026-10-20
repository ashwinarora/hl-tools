/**
 * The notices under a proposal's status, in two kinds. A stop notice is one
 * a reader must not miss before signing or sending: it is shown in full,
 * first, and never folded. Everything else is a note: folded into "N notes",
 * one tap away. Pure: the page says which notices it has, this says where
 * each goes and in what order.
 */

/** Every notice the proposal page can show above the action. */
export type NoticeId =
	/** Hyperliquid's record has no transaction, or a refused one, for a proposal reported accepted. */
	| "record"
	/** Hyperliquid would refuse it as things stand: the mode, a send to itself. */
	| "refused-now"
	/** The treasury cannot cover the amount now. */
	| "shortfall"
	/** Sending this first shuts out an older send, or a withdrawal should let older sends go first. */
	| "older-sends"
	/** The last attempt to send it was refused. */
	| "rejected"
	/** The signers changed since it was proposed. */
	| "signers-changed"
	/** This browser could not save it. */
	| "not-saved"
	/** The hl-tools server refused a write: co-signers may not see what was done here. */
	| "sharing-refused"
	/** A copy reports a refusal that Hyperliquid's record overrides. */
	| "copy-refusal"
	/** What opening the copy left out of it. */
	| "copy-notes"
	/** What the page that opened it has to say (one step of a move). */
	| "aside"
	/** The hl-tools server did not answer. */
	| "sharing"
	/** What this browser would not take from the hl-tools server's copy. */
	| "sharing-notes";

const STOP: readonly NoticeId[] = [
	"record",
	"refused-now",
	"shortfall",
	"older-sends",
	"rejected",
	"signers-changed",
	"not-saved",
	"sharing-refused",
];
const NOTE: readonly NoticeId[] = [
	"copy-refusal",
	"copy-notes",
	"aside",
	"sharing",
	"sharing-notes",
];

export interface NoticePlan {
	/** Shown in full, in this order. */
	readonly stops: readonly NoticeId[];
	/** Folded together, in this order. */
	readonly notes: readonly NoticeId[];
	/** How many notices the fold holds: one id can stand for several. */
	readonly noteCount: number;
}

/** Where each notice the page has goes, given how many of each it has (none: 0 or left out). */
export function planNotices(
	counts: Partial<Readonly<Record<NoticeId, number>>>,
): NoticePlan {
	const has = (id: NoticeId) => (counts[id] ?? 0) > 0;
	const notes = NOTE.filter(has);
	return {
		stops: STOP.filter(has),
		notes,
		noteCount: notes.reduce((n, id) => n + (counts[id] ?? 0), 0),
	};
}

/** "1 note", "3 notes". */
export const notesLabel = (n: number): string =>
	`${n} ${n === 1 ? "note" : "notes"}`;

/** What a copy's notes show: what was only for information stays out. */
export const copyNotesShown = <T extends { readonly severity: string }>(
	notes: readonly T[] | undefined,
): readonly T[] => (notes ?? []).filter((i) => i.severity !== "info");

/**
 * The button of the bar a phone keeps at the bottom of a proposal's page,
 * named after what the connected wallet can do now; null when it can do
 * nothing there. The bar only brings the reader's part of the page into
 * view: what is signed is read there first.
 */
export function nextStepLabel(stage: {
	readonly canSign: boolean;
	readonly canExecute: boolean;
	readonly executeAddsSignature?: boolean;
}): string | null {
	if (stage.canExecute)
		return stage.executeAddsSignature
			? "Sign and send to Hyperliquid"
			: "Send to Hyperliquid";
	return stage.canSign ? "Sign" : null;
}
