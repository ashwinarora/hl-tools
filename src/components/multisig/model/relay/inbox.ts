/**
 * "Needs you": which open proposals wait for the signed-in wallet, and how.
 * Counted against the relay's stored signer copy (every signature still
 * recovered in the browser first); the proposal page itself judges against
 * the live chain.
 */
import {
	type Address,
	type Hex,
	type Network,
	orderMark,
} from "@hl-tools/core";
import type { Blocked } from "./positions";

export interface InboxEntry {
	readonly network: Network;
	readonly treasury: Address;
	readonly digest: Hex;
	readonly createdBy: Address;
	readonly finaliser: Address;
	/** Distinct stored signers whose signature verifies. */
	readonly counted: readonly Address[];
	readonly threshold: number;
	/** Still collecting: not ended, not accepted, not expired. */
	readonly open: boolean;
	/** Its treasury stopped being a multi-sig: nothing can be signed or submitted for it. */
	readonly frozen: boolean;
	/**
	 * It cannot be submitted, whoever signs: its finaliser is no longer a signer,
	 * it is a USDC send and a newer send of the treasury has been carried out,
	 * or Hyperliquid refused it once, which used up its number.
	 */
	readonly stuck: boolean;
	/** Which of the three makes it `stuck`, for the list to say. */
	readonly stuckBy?: StuckReason | null;
	/** The current signers who said no (a no is an objection, not an ending). */
	readonly objected: readonly Address[];
	/**
	 * It cannot go ahead as things stand: too many said no for its number to be
	 * reached, or its finaliser said no. A change of mind makes it live again.
	 */
	readonly blocked: Blocked | null;
}

/**
 * refused         Hyperliquid refused it once, which used up its number
 * finaliser-left  its finaliser is no longer a signer
 * overtaken       a USDC send, and a newer send of the treasury went first
 */
export type StuckReason = "refused" | "finaliser-left" | "overtaken";

/** The reason a list row gives, after "cannot be finished: ". */
export const STUCK_WORDS: Record<StuckReason, string> = {
	refused: "refused",
	"finaliser-left": "its finaliser left",
	overtaken: "a later send went first",
};

/** The first reason that holds, in the order a reader can act on. */
export function stuckReason(i: {
	readonly refused: boolean;
	readonly finaliserLeft: boolean;
	readonly overtaken: boolean;
}): StuckReason | null {
	if (i.refused) return "refused";
	if (i.finaliserLeft) return "finaliser-left";
	if (i.overtaken) return "overtaken";
	return null;
}

/**
 * The two steps of a move as one entry (model/move.ts). It asks of a signer
 * what both steps ask: it counts as signed by those who signed both, it is
 * open while both are, and what holds up either step holds up the move. The
 * rest (who proposed, who finalises, the treasury) is the same for both, or
 * they would not be a move.
 */
export function moveEntry(
	first: InboxEntry,
	second: InboxEntry,
): Pick<
	InboxEntry,
	"counted" | "open" | "frozen" | "stuck" | "stuckBy" | "objected" | "blocked"
> {
	return {
		counted: first.counted.filter((a) => second.counted.includes(a)),
		open: first.open && second.open,
		frozen: first.frozen || second.frozen,
		stuck: first.stuck || second.stuck,
		stuckBy: first.stuckBy ?? second.stuckBy ?? null,
		objected: [...new Set([...first.objected, ...second.objected])],
		blocked: first.blocked ?? second.blocked,
	};
}

/**
 * finish   you are the finaliser and can submit now (your own signature may be the last one missing)
 * sign     your signature is still wanted
 * waiting  nothing for you to do: you signed, or it is already ready and someone else finalises
 * dead     it cannot be submitted any more, or cannot go ahead as things stand (enough
 *          signers, or its finaliser, said no): it waits to be withdrawn, for a change
 *          of mind, or for its signing window to close
 */
export type InboxGroup = "finish" | "sign" | "waiting" | "dead";

export function inboxGroup(e: InboxEntry, me: Address): InboxGroup | null {
	// a frozen treasury's proposals stay listed on its own page, but ask nobody for anything
	if (!e.open || e.frozen) return null;
	// nobody's signature can finish it: it waits for its proposer to withdraw it
	if (e.stuck) return "dead";
	// nor as things stand, while those who said no stand by it
	if (e.blocked) return "dead";
	const signed = e.counted.includes(me);
	const ready = e.counted.length >= e.threshold;
	const completes = !signed && e.counted.length === e.threshold - 1;
	// somebody who said no is not asked again: their position is known
	const against = e.objected.includes(me);
	if (e.finaliser === me && (ready || completes) && !against) return "finish";
	if (!signed && !ready && !against) return "sign";
	return "waiting";
}

/**
 * What the finaliser's row offers. Their own signature is asked for only
 * when it is still needed: once the others have reached the number that must
 * sign, submitting is one wallet prompt (audit F-018).
 */
export function finishLabel(
	e: InboxEntry,
	me: Address,
): "Send" | "Sign and send" {
	const signed = e.counted.includes(me);
	const ready = e.counted.length >= e.threshold;
	return signed || ready ? "Send" : "Sign and send";
}

/**
 * Whether the order in which a list of waiting actions is carried out matters:
 * at least two of them are of a kind Hyperliquid takes only in the order of
 * their numbers (a `usdSend`, a bridge withdrawal). The guided sends are not
 * (audit F-014).
 */
export function orderMatters(actions: readonly unknown[]): boolean {
	return actions.filter((a) => orderMark(a) !== null).length > 1;
}

export function needsMe(e: InboxEntry, me: Address): boolean {
	const g = inboxGroup(e, me);
	return g === "finish" || g === "sign";
}

export interface Inbox<T extends InboxEntry> {
	readonly finish: readonly T[];
	readonly sign: readonly T[];
	readonly waiting: readonly T[];
	readonly dead: readonly T[];
}

export function groupInbox<T extends InboxEntry>(
	entries: readonly T[],
	me: Address,
	network: Network,
): Inbox<T> {
	const out = {
		finish: [] as T[],
		sign: [] as T[],
		waiting: [] as T[],
		dead: [] as T[],
	};
	for (const e of entries) {
		if (e.network !== network) continue;
		const g = inboxGroup(e, me);
		if (g) out[g].push(e);
	}
	return out;
}

/** How many proposals need the wallet on a network, optionally for one treasury. */
export function countNeeds(
	entries: readonly InboxEntry[],
	me: Address,
	network: Network,
	treasury?: Address,
): number {
	return entries.filter(
		(e) =>
			e.network === network &&
			(!treasury || e.treasury === treasury) &&
			needsMe(e, me),
	).length;
}

/**
 * A treasury's proposals that can still go somewhere, whoever they wait for.
 * Those of an account that stopped being a multi-sig are not counted: nobody
 * can sign or submit them (audit F-023).
 */
export function countOpen(
	entries: readonly InboxEntry[],
	network: Network,
	treasury: Address,
): number {
	return entries.filter(
		(e) =>
			e.network === network && e.treasury === treasury && e.open && !e.frozen,
	).length;
}

/** The section's title in the browser tab. */
export const SECTION_TITLE = "Multisig — hl-tools";

/**
 * The tab's title with what needs the signer in front, the way a mail client
 * counts unread mail: "(3) Multisig — hl-tools". A tab in the background then
 * says there is something to do without any notification being sent.
 */
export function tabTitle(needs: number): string {
	if (!(needs >= 1)) return SECTION_TITLE;
	return `(${needs > 99 ? "99+" : Math.floor(needs)}) ${SECTION_TITLE}`;
}
