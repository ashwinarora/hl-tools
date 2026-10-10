/**
 * "Needs you": which open proposals wait for the signed-in wallet, and how.
 * Counted against the relay's stored signer copy (every signature still
 * recovered in the browser first); the proposal page itself judges against
 * the live chain.
 */
import type { Address, Hex, Network } from "@hl-tools/core";

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
}

/**
 * finish   you are the finaliser and can submit now (your own signature may be the last one missing)
 * sign     your signature is still wanted
 * waiting  nothing for you to do: you signed, or it is already ready and someone else finalises
 */
export type InboxGroup = "finish" | "sign" | "waiting";

export function inboxGroup(e: InboxEntry, me: Address): InboxGroup | null {
	// a frozen treasury's proposals stay listed on its own page, but ask nobody for anything
	if (!e.open || e.frozen) return null;
	const signed = e.counted.includes(me);
	const ready = e.counted.length >= e.threshold;
	const completes = !signed && e.counted.length === e.threshold - 1;
	if (e.finaliser === me && (ready || completes)) return "finish";
	if (!signed && !ready) return "sign";
	return "waiting";
}

export function needsMe(e: InboxEntry, me: Address): boolean {
	const g = inboxGroup(e, me);
	return g === "finish" || g === "sign";
}

export interface Inbox<T extends InboxEntry> {
	readonly finish: readonly T[];
	readonly sign: readonly T[];
	readonly waiting: readonly T[];
}

export function groupInbox<T extends InboxEntry>(
	entries: readonly T[],
	me: Address,
	network: Network,
): Inbox<T> {
	const out = { finish: [] as T[], sign: [] as T[], waiting: [] as T[] };
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

/** Open proposals of a treasury, whoever they wait for. */
export function countOpen(
	entries: readonly InboxEntry[],
	network: Network,
	treasury: Address,
): number {
	return entries.filter(
		(e) => e.network === network && e.treasury === treasury && e.open,
	).length;
}
