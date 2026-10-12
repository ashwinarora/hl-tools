/**
 * Where the browser keeps relay sessions: one slot per wallet.
 *
 * A session belongs to exactly one wallet, and the slot it is kept in is
 * named after that wallet. Nothing here decides who is signed in: a slot only
 * says "a session for this wallet was stored here". Whether it still speaks
 * for that wallet is the relay's answer, asked before the slot is used
 * (`relay/session.ts`).
 *
 * No React and no Supabase here. `Slots` is the part of `localStorage` this
 * needs, so every rule can be tested against a plain map.
 */
import type { Address } from "@hl-tools/core";

/** The part of `Storage` the slots need. */
export interface Slots {
	readonly length: number;
	key(index: number): string | null;
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** A wallet's slot is this prefix followed by its address in lowercase. */
export const RELAY_SLOT_PREFIX = "hl-tools.relay.";
/** The single slot of the time when one session was kept; adopted once, see `adoptLegacy`. */
export const RELAY_LEGACY_KEY = "hl-tools.relay";
/** When each stored wallet was last in use here, to order the list and to choose who is dropped. */
export const RELAY_USED_KEY = "hl-tools.relay-used";

/**
 * How many wallets can stay signed in in one browser. Each slot holds a
 * renewal token, so the number kept at rest is bounded; a treasury has at
 * most ten signers and one person rarely holds more than a few of them.
 */
export const MAX_SIGNED_IN = 8;

const ADDRESS = /^0x[0-9a-f]{40}$/;

const asAddress = (v: unknown): Address | null =>
	typeof v === "string" && ADDRESS.test(v.toLowerCase())
		? (v.toLowerCase() as Address)
		: null;

export function slotKey(wallet: Address): string {
	return `${RELAY_SLOT_PREFIX}${wallet.toLowerCase()}`;
}

/** The wallet a storage key is the slot of; null for any other key. */
export function walletOfSlot(key: string | null): Address | null {
	if (!key?.startsWith(RELAY_SLOT_PREFIX)) return null;
	const rest = key.slice(RELAY_SLOT_PREFIX.length);
	// exactly an address in lowercase: nothing else is ever written under the prefix
	return ADDRESS.test(rest) ? (rest as Address) : null;
}

export function hasSlot(slots: Slots, wallet: Address): boolean {
	return slots.getItem(slotKey(wallet)) !== null;
}

/** When each wallet was last in use, as far as the stored note can be read. */
function readUsed(slots: Slots): Map<Address, number> {
	const out = new Map<Address, number>();
	let parsed: unknown;
	try {
		parsed = JSON.parse(slots.getItem(RELAY_USED_KEY) ?? "null");
	} catch {
		return out;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		return out;
	for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
		const wallet = asAddress(k);
		if (wallet && typeof v === "number" && Number.isFinite(v))
			out.set(wallet, v);
	}
	return out;
}

function writeUsed(slots: Slots, used: Map<Address, number>): void {
	if (used.size === 0) slots.removeItem(RELAY_USED_KEY);
	else slots.setItem(RELAY_USED_KEY, JSON.stringify(Object.fromEntries(used)));
}

/**
 * The wallets with a slot in this browser, most recently used first. A slot
 * with no "last used" note sorts last, by address, so the order is stable.
 */
export function storedWallets(slots: Slots): Address[] {
	const found: Address[] = [];
	for (let i = 0; i < slots.length; i++) {
		const wallet = walletOfSlot(slots.key(i));
		if (wallet && !found.includes(wallet)) found.push(wallet);
	}
	const used = readUsed(slots);
	return found.sort((a, b) => {
		const ua = used.get(a) ?? -1;
		const ub = used.get(b) ?? -1;
		return ub - ua || (a < b ? -1 : 1);
	});
}

/** Note that a wallet's session was in use now. Says nothing about a wallet with no slot. */
export function touchWallet(slots: Slots, wallet: Address, now: number): void {
	if (!hasSlot(slots, wallet)) return;
	const used = readUsed(slots);
	used.set(wallet, now);
	// notes about wallets whose slot is gone are dropped on the way
	for (const w of [...used.keys()]) if (!hasSlot(slots, w)) used.delete(w);
	writeUsed(slots, used);
}

/** Empty a wallet's slot. After this the browser holds nothing that speaks for it. */
export function forgetWallet(slots: Slots, wallet: Address): void {
	slots.removeItem(slotKey(wallet));
	const used = readUsed(slots);
	if (used.delete(wallet)) writeUsed(slots, used);
}

/**
 * The wallets to drop so that no more than `max` stay: the least recently
 * used first, and never `keep` (the one that has just signed in).
 */
export function overLimit(
	stored: readonly Address[],
	keep: Address,
	max: number = MAX_SIGNED_IN,
): Address[] {
	const others = stored.filter((w) => w !== keep);
	const room = Math.max(0, max - 1);
	// `stored` is most recently used first: what is past the room goes
	return others.slice(room);
}

/**
 * The wallet a session of the single-slot time was stored for, read from the
 * session itself. This is only a hint for where to put it: the session is not
 * used until the relay has said which wallet it speaks for.
 */
export function legacyWallet(raw: string | null): Address | null {
	if (raw === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const user = (parsed as { user?: unknown } | null)?.user as
		| {
				user_metadata?: { custom_claims?: { address?: unknown } };
				identities?: readonly {
					identity_data?: { custom_claims?: { address?: unknown } };
				}[];
		  }
		| undefined;
	return (
		asAddress(user?.user_metadata?.custom_claims?.address) ??
		asAddress(user?.identities?.[0]?.identity_data?.custom_claims?.address)
	);
}

/**
 * Move a session of the single-slot time into its wallet's slot, once. The
 * single slot is emptied whatever happens, so it is never read twice; a
 * session whose wallet cannot be told, or whose wallet already has a slot, is
 * dropped (that wallet signs in again). Returns the wallet it was moved to.
 */
export function adoptLegacy(slots: Slots, now: number): Address | null {
	const raw = slots.getItem(RELAY_LEGACY_KEY);
	if (raw === null) return null;
	slots.removeItem(RELAY_LEGACY_KEY);
	const wallet = legacyWallet(raw);
	if (!wallet || hasSlot(slots, wallet)) return null;
	slots.setItem(slotKey(wallet), raw);
	touchWallet(slots, wallet, now);
	return wallet;
}
