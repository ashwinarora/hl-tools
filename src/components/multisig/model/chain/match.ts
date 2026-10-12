/**
 * Which proposal caused a row of Hyperliquid's ledger, if any did.
 *
 * The ledger says what the account did, never who proposed or signed it, and
 * it does not name a proposal. What ties the two together is the transaction:
 * the explorer returns, for the row's hash, the action exactly as it was
 * signed, and for a multi-sig that is the proposal's own action (measured on
 * testnet for every kind the tool proposes).
 *
 * So the work is split in two, and only the second half costs a request:
 *   1. `candidatesFor`  from what the row itself shows (its time, kind,
 *      amount, destination), which proposals could it be? Mostly none.
 *   2. `judgeTx`        with the explorer's answer for the hash: the proposal
 *      whose action is that action, exactly.
 * A row is never called "none on record" on the strength of a request that
 * did not answer.
 */
import {
	Decimal,
	type ExplorerTx,
	type Hex,
	type LedgerRow,
	type PlainObject,
} from "@hl-tools/core";

const DAY = 86_400_000;

/**
 * Hyperliquid takes a nonce from two days before the block's time to one day
 * after it. Seen from the nonce: the action can only have landed between one
 * day before it and two days after it.
 */
export const LANDS_BEFORE_NONCE_MS = DAY;
export const LANDS_AFTER_NONCE_MS = 2 * DAY;

/** A proposal, as far as matching needs it. */
export interface MatchCandidate {
	readonly digest: Hex;
	/** `payload.action`, as signed. */
	readonly action: PlainObject;
	readonly nonce: number;
	/** `payload.outerSigner`: two proposals may differ in nothing else. */
	readonly finaliser: string;
}

/** The action a kind of ledger entry comes from, where that is known. */
const CAUSE: Readonly<Record<string, string>> = {
	internalTransfer: "usdSend",
	spotTransfer: "spotSend",
	accountClassTransfer: "usdClassTransfer",
	send: "sendAsset",
	withdraw: "withdraw3",
};

/**
 * not-applicable  the account did not do this (money arrived, a liquidation):
 *                 no proposal could be behind it
 * none            the account did it, and no proposal on record could be it
 * candidates      these proposals agree with everything the row shows; the
 *                 transaction has to be looked up to know
 */
export type RowCandidates =
	| { readonly kind: "not-applicable" }
	| { readonly kind: "none" }
	| { readonly kind: "candidates"; readonly digests: readonly Hex[] };

const sameAmount = (a: unknown, b: unknown): boolean => {
	const x = typeof a === "string" ? Decimal.tryParse(a) : null;
	const y = typeof b === "string" ? Decimal.tryParse(b) : null;
	return !!x && !!y && x.eq(y);
};
const sameAddress = (a: unknown, b: unknown): boolean =>
	typeof a === "string" &&
	typeof b === "string" &&
	a.toLowerCase() === b.toLowerCase();
/** A spot token is "NAME:0x…" in an action and "NAME" in the ledger. */
const tokenName = (v: unknown): string | null =>
	typeof v === "string" ? (v.split(":")[0] ?? null) : null;

/** Whether an action could have produced the row, judged by the fields both show. */
function agrees(row: LedgerRow, action: PlainObject): boolean {
	const d = row.delta;
	switch (action.type) {
		case "usdSend":
			return (
				sameAmount(action.amount, d.usdc) &&
				sameAddress(action.destination, d.destination)
			);
		case "spotSend":
			return (
				sameAmount(action.amount, d.amount) &&
				sameAddress(action.destination, d.destination) &&
				tokenName(action.token) === tokenName(d.token)
			);
		case "usdClassTransfer":
			return sameAmount(action.amount, d.usdc) && action.toPerp === d.toPerp;
		case "sendAsset":
			return (
				sameAmount(action.amount, d.amount) &&
				sameAddress(action.destination, d.destination) &&
				tokenName(action.token) === tokenName(d.token)
			);
		case "withdraw3":
			// the ledger shows what left the account; the action names what arrives (less the fee)
			return true;
		default:
			return true;
	}
}

/**
 * A bridge withdrawal lands in the ledger minutes after the action, under a
 * hash of its own (the bridge's, which the explorer cannot tie to the
 * action), but its row carries the action's number: `nonce` is the
 * `withdraw3`'s `time` times 1000 (seen on mainnet and testnet). So such a
 * row is tied to its proposal by that number, with certainty and without a
 * look-up. Null when the row is no withdrawal or shows no number.
 */
export function withdrawalNumber(row: LedgerRow): number | null {
	if (row.type !== "withdraw") return null;
	const raw = row.delta.nonce;
	const n =
		typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
	if (!Number.isSafeInteger(n) || n <= 0) return null;
	// the action's time lies shortly before the row's: that tells the two units apart
	const near = (t: number) =>
		t <= row.time + LANDS_BEFORE_NONCE_MS &&
		t >= row.time - LANDS_AFTER_NONCE_MS;
	if (n % 1000 === 0 && near(n / 1000)) return n / 1000;
	// should Hyperliquid ever report it in the action's own unit
	return near(n) ? n : null;
}

/** The proposals whose withdrawal has exactly that number. */
function withdrawalsNumbered(
	time: number,
	proposals: readonly MatchCandidate[],
): Hex[] {
	return [
		...new Set(
			proposals
				.filter(
					(p) =>
						p.action.type === "withdraw3" && Number(p.action.time) === time,
				)
				.map((p) => p.digest),
		),
	];
}

/** Step 1: which proposals a ledger row could belong to, without asking anyone. */
export function candidatesFor(
	row: LedgerRow,
	proposals: readonly MatchCandidate[],
): RowCandidates {
	if (row.direction !== "out" && row.direction !== "within")
		return { kind: "not-applicable" };
	const cause = CAUSE[row.type];
	const digests = proposals
		.filter(
			(p) =>
				row.time >= p.nonce - LANDS_BEFORE_NONCE_MS &&
				row.time <= p.nonce + LANDS_AFTER_NONCE_MS &&
				// a kind whose cause is not known is left to the transaction to decide
				(cause === undefined || p.action.type === cause) &&
				agrees(row, p.action),
		)
		.map((p) => p.digest);
	return digests.length === 0
		? { kind: "none" }
		: { kind: "candidates", digests: [...new Set(digests)] };
}

const ZERO_HASH = /^0x0+$/;

/**
 * The transactions worth looking up: those of rows that could be a known
 * proposal's, once each, the newest first. Look-ups are paced, and the row
 * somebody is waiting for is the one that has just landed.
 */
export function hashesToLookUp(
	ledger: readonly LedgerRow[],
	proposals: readonly MatchCandidate[],
): string[] {
	const out = new Set<string>();
	for (const row of [...ledger].sort((a, b) => b.time - a.time))
		if (
			// a withdrawal that shows its number needs no look-up (and its hash would not answer)
			withdrawalNumber(row) === null &&
			candidatesFor(row, proposals).kind === "candidates" &&
			!ZERO_HASH.test(row.hash)
		)
			out.add(row.hash.toLowerCase());
	return [...out];
}

/**
 * Exactly the same action: the same keys in the same order with the same
 * values. An integer may arrive as a number on one side and a bigint on the
 * other; a number too large to be exact is equal to nothing.
 */
export function sameAction(a: unknown, b: unknown): boolean {
	if (typeof a === "bigint" || typeof b === "bigint") {
		const exact = (v: unknown): bigint | null =>
			typeof v === "bigint"
				? v
				: typeof v === "number" && Number.isSafeInteger(v)
					? BigInt(v)
					: null;
		const x = exact(a);
		const y = exact(b);
		return x !== null && y !== null && x === y;
	}
	if (typeof a === "number" || typeof b === "number")
		return (
			typeof a === "number" &&
			typeof b === "number" &&
			a === b &&
			(!Number.isInteger(a) || Number.isSafeInteger(a))
		);
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) {
		const bb = b as unknown[];
		return a.length === bb.length && a.every((v, i) => sameAction(v, bb[i]));
	}
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	return (
		ka.length === kb.length &&
		ka.every(
			(k, i) =>
				k === kb[i] &&
				sameAction(
					(a as Record<string, unknown>)[k],
					(b as Record<string, unknown>)[k],
				),
		)
	);
}

/**
 * matched    one proposal's action is the transaction's action
 * ambiguous  several are (the same action and number with different
 *            finalisers, or an action that carries no number of its own):
 *            Hyperliquid's record cannot tell them apart
 * none       the transaction is something else, or another account's
 * failed     the hash is a rejected attempt; nothing happened on chain
 */
export type TxVerdict =
	| { readonly kind: "matched"; readonly digest: Hex }
	| { readonly kind: "ambiguous"; readonly digests: readonly Hex[] }
	| { readonly kind: "none" }
	| { readonly kind: "failed"; readonly error: string };

/** Step 2: with the transaction behind a row, the proposal it carried out. */
export function judgeTx(
	tx: ExplorerTx,
	account: string,
	candidates: readonly MatchCandidate[],
): TxVerdict {
	if (tx.user.toLowerCase() !== account.toLowerCase()) return { kind: "none" };
	if (tx.error !== null) return { kind: "failed", error: tx.error };
	const digests = [
		...new Set(
			candidates
				.filter((p) => sameAction(p.action, tx.action))
				.map((p) => p.digest),
		),
	];
	if (digests.length === 0) return { kind: "none" };
	if (digests.length === 1)
		return { kind: "matched", digest: digests[0] as Hex };
	return { kind: "ambiguous", digests };
}

/** What the "Proposal" cell of one ledger row says. */
export type RowProposal =
	| { readonly kind: "not-applicable" }
	| { readonly kind: "none" }
	| { readonly kind: "checking" }
	/** The explorer did not answer, or does not know the hash: nothing is claimed. */
	| { readonly kind: "unchecked" }
	| { readonly kind: "matched"; readonly digest: Hex }
	| { readonly kind: "ambiguous"; readonly digests: readonly Hex[] };

/** How a look-up of a row's transaction stands. */
export type Lookup =
	| { readonly state: "pending" }
	| { readonly state: "failed" }
	| { readonly state: "unknown-hash" }
	| { readonly state: "found"; readonly tx: ExplorerTx };

/** The cell for one row, from its candidates and how the look-up stands. */
export function rowProposal(
	row: LedgerRow,
	account: string,
	proposals: readonly MatchCandidate[],
	lookup: Lookup | undefined,
): RowProposal {
	const number = withdrawalNumber(row);
	if (number !== null) {
		const digests = withdrawalsNumbered(number, proposals);
		if (digests.length === 0) return { kind: "none" };
		return digests.length === 1
			? { kind: "matched", digest: digests[0] as Hex }
			: // the same withdrawal proposed twice with different finalisers
				{ kind: "ambiguous", digests };
	}
	const c = candidatesFor(row, proposals);
	if (c.kind !== "candidates") return c;
	if (!lookup || lookup.state === "pending") return { kind: "checking" };
	if (lookup.state !== "found") return { kind: "unchecked" };
	const wanted = new Set(c.digests);
	const verdict = judgeTx(
		lookup.tx,
		account,
		proposals.filter((p) => wanted.has(p.digest)),
	);
	// a rejected attempt leaves no ledger row; if the hash is one, the row is not this transaction
	return verdict.kind === "failed" ? { kind: "none" } : verdict;
}

/** A proposal that was carried out, as far as explaining an API wallet needs it. */
export interface DoneProposal {
	readonly digest: Hex;
	readonly action: PlainObject;
	readonly nonce: number;
	/** Hyperliquid accepted it (the finaliser's receipt says so). */
	readonly accepted: boolean;
}

/**
 * The proposal on record that approved an API wallet: the newest accepted
 * `approveAgent` naming that address. Null when the wallet was approved
 * some other way, or before this tool was in use.
 */
export function approvalOf(
	agent: string,
	proposals: readonly DoneProposal[],
): Hex | null {
	const hit = proposals
		.filter(
			(p) =>
				p.accepted &&
				p.action.type === "approveAgent" &&
				sameAddress(p.action.agentAddress, agent),
		)
		.sort((a, b) => b.nonce - a.nonce)[0];
	return hit?.digest ?? null;
}
