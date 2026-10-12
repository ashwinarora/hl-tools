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
}

/**
 * finish   you are the finaliser and can submit now (your own signature may be the last one missing)
 * sign     your signature is still wanted
 * waiting  nothing for you to do: you signed, or it is already ready and someone else finalises
 * dead     it cannot be submitted any more: it waits to be withdrawn and proposed again
 */
export type InboxGroup = "finish" | "sign" | "waiting" | "dead";

export function inboxGroup(e: InboxEntry, me: Address): InboxGroup | null {
	// a frozen treasury's proposals stay listed on its own page, but ask nobody for anything
	if (!e.open || e.frozen) return null;
	// nobody's signature can finish it: it waits for its proposer to withdraw it
	if (e.stuck) return "dead";
	const signed = e.counted.includes(me);
	const ready = e.counted.length >= e.threshold;
	const completes = !signed && e.counted.length === e.threshold - 1;
	if (e.finaliser === me && (ready || completes)) return "finish";
	if (!signed && !ready) return "sign";
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
): "Submit" | "Sign and submit" {
	const signed = e.counted.includes(me);
	const ready = e.counted.length >= e.threshold;
	return signed || ready ? "Submit" : "Sign and submit";
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
