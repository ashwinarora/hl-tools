/**
 * The short lines a toast says. A toast repeats what the page shows (the
 * page keeps its own line, announced through `Heard` where there is one):
 * it is for the reader whose eyes are elsewhere when a result arrives. It
 * closes by itself, success or not. Every sentence here is checked against
 * the forbidden claims and the jargon list (`toasts.test.ts`).
 */

/** How long a toast stays, in milliseconds. */
export const TOAST_MS = { done: 4_000, failed: 8_000, undo: 6_000 } as const;

/** Taking a treasury out of this browser's list, and putting it back. */
export const HIDE_COPY = {
	menuLabel: "More for this treasury",
	hide: "Hide from my list",
	show: "Show in my list again",
	hidden: "Hidden from your list",
	hiddenLine: "In this browser only. Your co-signers still see it.",
	shown: "Back in your list",
	undo: "Undo",
	/** Beside the treasury's name while it is hidden. */
	tag: "hidden in this browser",
	tagTitle:
		"Hidden from your list in this browser. It stays reachable by its address.",
} as const;

/** The "added to this tool by…" panel's close button. */
export const PROVENANCE_CLOSE = "Close this note";
