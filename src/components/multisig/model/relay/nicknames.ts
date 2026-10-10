/**
 * Nicknames, as the browser sees them: the same rules the relay applies when
 * one is given, applied again to whatever the relay returns. The relay is a
 * database this page does not control; a name it serves is shown only if this
 * page would have accepted it too.
 *
 * A nickname belongs to one treasury. It is a label on a screen, never part
 * of what is signed: the address is always shown next to it.
 */
import type { Address, Network } from "@hl-tools/core";

export const NICKNAME_MAX = 40;

/** Control characters, zero-width characters and direction overrides: they hide or reorder text. */
const HIDDEN = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;
/** Anything that reads like the start of an address, anywhere in the name. */
const ADDRESS_LIKE = /0x[0-9a-f]/i;
/** What the screens call the reader and the unknown. */
const RESERVED: ReadonlySet<string> = new Set(["you", "someone"]);

/** A nickname as it is stored: compatibility forms folded, runs of white space made one space, none at the ends. */
export function nicknameText(raw: string): string {
	return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** What two nicknames are compared by: capitals do not tell them apart. */
export function nicknameKey(name: string): string {
	return nicknameText(name).toLowerCase();
}

/** Why a nickname (in stored form) cannot be used; null when it can. The relay's own sentences. */
export function nicknameProblem(text: string): string | null {
	if (text.length === 0) return "A nickname cannot be empty.";
	if (HIDDEN.test(text))
		return "A nickname cannot contain invisible or direction-changing characters.";
	if (ADDRESS_LIKE.test(text)) return "A nickname cannot look like an address.";
	if ([...text].length > NICKNAME_MAX)
		return `A nickname can be at most ${NICKNAME_MAX} characters.`;
	if (RESERVED.has(text.toLowerCase()))
		return "That word is used by the screens themselves.";
	return null;
}

/** One row of the relay's nicknames. */
export interface NicknameRow {
	readonly network: Network;
	readonly treasury: Address;
	readonly address: Address;
	readonly name: string;
	readonly setBy: Address;
	readonly setAt: number;
}

export interface Nickname {
	readonly name: string;
	/** Who gave it. For a signer's own address, always that signer. */
	readonly setBy: Address;
	readonly setAt: number;
}

/**
 * The nicknames of one treasury that this page shows. Left out:
 *  - rows of another treasury or network (a nickname is never shown elsewhere);
 *  - a name this page would not have accepted (untidy, address-like, reserved, too long);
 *  - a signer's address named by anybody but that signer;
 *  - a second address under a name already taken (the earlier one keeps it).
 * `signers` is the signer list the page trusts (the chain's when it is known).
 */
export function acceptNicknames(
	rows: readonly NicknameRow[],
	of: {
		readonly network: Network;
		readonly treasury: Address;
		readonly signers: readonly Address[];
	},
): ReadonlyMap<Address, Nickname> {
	const out = new Map<Address, Nickname>();
	const taken = new Set<string>();
	const mine = rows
		.filter((r) => r.network === of.network && r.treasury === of.treasury)
		.sort((a, b) => a.setAt - b.setAt || (a.address < b.address ? -1 : 1));
	for (const r of mine) {
		if (nicknameText(r.name) !== r.name || nicknameProblem(r.name) !== null)
			continue;
		if (of.signers.includes(r.address) && r.setBy !== r.address) continue;
		const key = nicknameKey(r.name);
		if (taken.has(key) || out.has(r.address)) continue;
		taken.add(key);
		out.set(r.address, { name: r.name, setBy: r.setBy, setAt: r.setAt });
	}
	return out;
}

/**
 * Whether `me` may give (or take away) the nickname of `address` in a
 * treasury with these signers: a signer names their own address and any
 * address that is not another signer's.
 */
export function canNickname(
	me: Address | null,
	address: Address,
	signers: readonly Address[],
): boolean {
	if (!me || !signers.includes(me)) return false;
	return address === me || !signers.includes(address);
}

/** Why a new nickname for `address` would be refused, before asking the relay; null when it looks fine. */
export function nicknameRefusal(i: {
	readonly raw: string;
	readonly address: Address;
	readonly current: ReadonlyMap<Address, Nickname>;
}): string | null {
	const text = nicknameText(i.raw);
	const problem = nicknameProblem(text);
	if (problem) return problem;
	const key = nicknameKey(text);
	for (const [address, n] of i.current)
		if (address !== i.address && nicknameKey(n.name) === key)
			return "Another address in this treasury already has that nickname.";
	return null;
}
