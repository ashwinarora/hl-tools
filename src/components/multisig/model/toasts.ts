/**
 * The short lines a toast says. A toast repeats what the page shows (the
 * page keeps its own line, announced through `Heard` where there is one):
 * it is for the reader whose eyes are elsewhere when a result arrives. It
 * closes by itself, success or not. Every sentence here is checked against
 * the forbidden claims and the jargon list (`toasts.test.ts`).
 */
import { cutTo } from "@hl-tools/core";

/** How long a toast stays, in milliseconds. */
export const TOAST_MS = { done: 4_000, failed: 8_000, undo: 6_000 } as const;

/** The longest reason a failure's toast shows; the page has the rest. */
export const TOAST_LINE_MAX = 180;

/** What a toast says: a title, and a line under it when there is more. */
export interface ToastText {
	/** "unsure": it may have gone through; the page says what to check. */
	readonly tone: "done" | "failed" | "unsure";
	readonly title: string;
	readonly line?: string;
}

/** The title of each result. */
export const TOAST_TITLES = {
	signed: "Signature added",
	notSigned: "Not signed",
	accepted: "Accepted by Hyperliquid",
	refused: "Refused by Hyperliquid",
	unclear: "No clear answer from Hyperliquid",
	used: "Already used: it most likely went through",
	notSent: "Not sent",
	moveSigned: "Both steps signed",
	moveNotSigned: "Not everything was signed",
	moveAccepted: "Both steps accepted by Hyperliquid",
	firstStepAccepted: "Step 1 accepted by Hyperliquid",
	takenBack: "Signature taken back",
	saidNo: "Your no is recorded",
	noTakenBack: "Your no is taken back",
	cancelled: "Cancelled for everyone",
	sharingRefused: "The hl-tools server did not take it",
	signedOut: "Signed out of the hl-tools server",
	created: "Proposal created",
	notCreated: "Not created",
	converted: "Your treasury is set up",
	added: "Treasury added",
	notAdded: "Not added",
	nicknameSaved: "Nickname saved",
	nicknameRemoved: "Nickname removed",
	nicknameNotSaved: "Nickname not saved",
	shared: "Shared with your co-signers",
	notShared: "Not shared",
	merged: "Signatures added from the copy",
	nothingNew: "Nothing new in that copy",
	otherCopy: "That copy is not this proposal",
	nothingSent: "Nothing was sent",
	notMerged: "Nothing was added from the copy",
} as const;

/**
 * What the page says after a send whose answer is not "accepted"
 * (`sendAnswer` in `model/submit.ts`). An unclear answer stores nothing and
 * offers to send the very same proposal again, which cannot pay twice: only
 * a new proposal, with a new number, could.
 */
export const SEND_ANSWER = {
	unclear:
		"We don't know whether this went through. Trying again is safe: Hyperliquid carries out a proposal at most once, and says so if it already did.",
	/** In a move, when the step before was accepted. */
	unclearStep: (n: number) =>
		`Step ${n - 1} was accepted and stands. We don't know whether step ${n} went through. Trying again is safe: Hyperliquid carries out a proposal at most once, and says so if it already did.`,
	tryAgain: "Try again",
	/** Under the button: what it does, and does not. */
	tryAgainNote:
		"Try again posts the same signed request once more: no wallet prompt, and Hyperliquid carries it out at most once.",
	tryingAgain: "Sending to Hyperliquid again…",
	used: "Hyperliquid says this proposal was already used, so it most likely went through. Check Hyperliquid's record.",
	usedStep: (n: number) =>
		`Hyperliquid says step ${n} was already used, so it most likely went through. Check Hyperliquid's record.`,
	checkRecord: "Check Hyperliquid's record",
} as const;

/**
 * While a send is on its way: Hyperliquid is asked first whether it would
 * refuse, then the wallet (audit F-003: no wallet prompt may follow at all).
 */
export const SENDING = "Checking with Hyperliquid, then asking your wallet…";

/** One step of a move, accepted. */
export const stepAccepted = (n: number) => `Step ${n} accepted by Hyperliquid`;
/** One step of a move, not sent (the one before it was). */
export const stepNotSent = (n: number) => `Step ${n} was not sent`;

/** The line under a result that went through, where one helps. */
export const TOAST_LINES = {
	signedOnly: "Nothing is sent until the finaliser sends it.",
	final: "It cannot be undone.",
	refused: "This page says why.",
	secondStepLater: "Step 2 is sent once its time comes.",
	keptOther:
		"What it asks everyone to sign is different. Compare it before opening it.",
	/** A session that ended without this page asking (audit F-069). */
	signedOut:
		"This wallet's sign-in here has ended. Sign in again to see your co-signers' updates.",
} as const;

/** A result the page cannot call either way yet. */
export const unsure = (title: string, line?: string): ToastText => ({
	tone: "unsure",
	title,
	...(line ? { line: cutTo(line, TOAST_LINE_MAX) } : {}),
});

/** A result that went through. */
export const done = (title: string, line?: string): ToastText => ({
	tone: "done",
	title,
	...(line ? { line } : {}),
});

/**
 * A result that did not: the first reason given, cut short (the page shows
 * it whole). A reason may be a message, an issue or a list of them.
 */
export function failed(
	title: string,
	why?:
		| string
		| { readonly message: string }
		| readonly { readonly message: string }[]
		| null,
): ToastText {
	const first =
		typeof why === "string"
			? why
			: Array.isArray(why)
				? why[0]?.message
				: (why as { readonly message: string } | null | undefined)?.message;
	const line = first?.trim() ? cutTo(first.trim(), TOAST_LINE_MAX) : undefined;
	return { tone: "failed", title, ...(line ? { line } : {}) };
}

/** What merging a returned copy came to, as the share panel's result has it. */
export function mergeToast(
	r:
		| { readonly kind: "merged"; readonly added: number }
		| { readonly kind: "other" }
		| {
				readonly kind: "failed";
				readonly issues: readonly { readonly message: string }[];
		  },
): ToastText {
	if (r.kind === "failed") return failed(TOAST_TITLES.notMerged, r.issues);
	if (r.kind === "other")
		return unsure(TOAST_TITLES.otherCopy, TOAST_LINES.keptOther);
	return r.added > 0
		? done(
				TOAST_TITLES.merged,
				`${r.added} new signature${r.added === 1 ? "" : "s"}.`,
			)
		: done(TOAST_TITLES.nothingNew);
}

/** Taking a treasury out of this browser's list, and putting it back. */
export const HIDE_COPY = {
	menuLabel: "More for this treasury",
	hide: "Hide from my list",
	show: "Show in my list again",
	hidden: "Hidden from your list",
	hiddenLine: "Your list in this browser changes, not your co-signers'.",
	shown: "Back in your list",
	undo: "Undo",
	/** Beside the treasury's name while it is hidden. */
	tag: "hidden in this browser",
	tagTitle:
		"Hidden from your list in this browser. It stays reachable by its address.",
} as const;

/** The "added to this tool by…" panel's close button. */
export const PROVENANCE_CLOSE = "Close this note";
