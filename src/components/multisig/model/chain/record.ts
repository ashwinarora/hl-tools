/**
 * Whether Hyperliquid's own record holds the transaction of a proposal that
 * reads as accepted.
 *
 * "Accepted" is what the finaliser's browser filed: Hyperliquid's answer to
 * the submission, as that browser got it. A copy of a proposal can carry any
 * answer (that part is not signed), and the relay takes the finaliser's
 * report as filed. Hyperliquid's record is not open to either: the
 * account's transactions as the explorer lists them (`userDetails`, the
 * newest 300). So wherever a proposal reads as accepted, the page looks for
 * its transaction there, from the reader's own browser.
 *
 * A multi-sig's action is listed under the multi-sig account as the action
 * its signers signed, with one measured exception: a mode switch is listed
 * with the one-letter code Hyperliquid hashes (fixtures/multisig/
 * explorer-record.json). A numbered action carries its number inside it, so
 * an entry with the same action is that proposal's and no other's. A vault
 * action carries none: an entry like it is "likely" at most.
 *
 * Absence is said only where the list reaches back far enough: an action
 * lands at the earliest a day before its number (`LANDS_BEFORE_NONCE_MS`),
 * so a complete list, or one whose oldest entry is older than that, would
 * hold it. The explorer can lag a submission by a moment, so nothing is
 * concluded from a list read in the first minutes after one.
 *
 * Pure: the screen hands in the list as it stands and the time.
 */
import {
	ABSTRACTION_ENVELOPE_CODES,
	type ExplorerTx,
	type PlainObject,
	type Proposal,
} from "@hl-tools/core";
import type { AccountTxs } from "./accountTxs";
import { LANDS_BEFORE_NONCE_MS, sameAction } from "./match";

/** How long after a submission the explorer is given before a list without it means anything. */
export const RECORD_LAG_MS = 5 * 60_000;

/** A proposal, as the check needs it. */
export interface RecordQuestion {
	/** `payload.multiSigUser`. */
	readonly account: string;
	/** `payload.action`, as signed. */
	readonly action: PlainObject;
	/** `payload.nonce`. */
	readonly nonce: number;
	/** When the accepted submission was made, as its report says; null when unknown. */
	readonly sentAt: number | null;
}

/** The question for a proposal, with the time its report of acceptance gives. */
export function recordQuestion(
	p: Proposal,
	sentAt: number | null = p.receipt?.submittedAt ?? null,
): RecordQuestion {
	return {
		account: p.payload.multiSigUser,
		action: p.payload.action,
		nonce: p.payload.nonce,
		sentAt,
	};
}

/** How the read of the account's list stands. */
export type RecordList =
	| { readonly state: "reading" }
	| { readonly state: "failed" }
	| {
			readonly state: "read";
			readonly txs: AccountTxs;
			readonly readAt: number;
	  };

/**
 * found      Hyperliquid's record holds the transaction, carried out
 * refused    it holds the transaction, refused (`error`)
 * likely     a vault action: an entry like it was carried out, which cannot
 *            say whose it was
 * missing    the list reaches back far enough and holds nothing like it
 * too-old    the list is cut off after the time it could have landed
 * just-sent  sent a moment ago: the explorer may not list it yet
 * checking   the list is being read, or was read too soon to tell
 * unchecked  the list could not be read
 */
export type OnRecord =
	| { readonly kind: "found"; readonly hash: string; readonly time: number }
	| {
			readonly kind: "refused";
			readonly hash: string;
			readonly time: number;
			readonly error: string;
	  }
	| { readonly kind: "likely"; readonly hash: string; readonly time: number }
	| { readonly kind: "missing" }
	| { readonly kind: "too-old" }
	| { readonly kind: "just-sent" }
	| { readonly kind: "checking" }
	| { readonly kind: "unchecked" };

/** The action as the explorer lists it: a mode switch by its one-letter code. */
export function asListed(action: PlainObject): PlainObject {
	const mode = action.abstraction;
	if (
		action.type === "userSetAbstraction" &&
		typeof mode === "string" &&
		Object.hasOwn(ABSTRACTION_ENVELOPE_CODES, mode)
	)
		// spread first: the key keeps its place, and the comparison is by order
		return { ...action, abstraction: ABSTRACTION_ENVELOPE_CODES[mode] };
	return action;
}

/** An action that carries no number of its own: Hyperliquid's record cannot say whose it was. */
export function unnumbered(action: PlainObject): boolean {
	return action.type === "vaultTransfer";
}

export function onRecord(
	q: RecordQuestion,
	list: RecordList,
	now: number,
): OnRecord {
	if (list.state === "failed") return { kind: "unchecked" };
	if (list.state === "reading") return { kind: "checking" };
	const wanted = asListed(q.action);
	const account = q.account.toLowerCase();
	let done: ExplorerTx | null = null;
	let refused: ExplorerTx | null = null;
	for (const tx of list.txs.byHash.values()) {
		if (tx.user.toLowerCase() !== account || !sameAction(wanted, tx.action))
			continue;
		if (tx.error === null) {
			done = tx;
			break;
		}
		refused ??= tx;
	}
	const vault = unnumbered(q.action);
	if (done)
		return vault
			? { kind: "likely", hash: done.hash, time: done.time }
			: { kind: "found", hash: done.hash, time: done.time };
	// a vault entry like it that was refused could be anyone's attempt
	if (refused && !vault)
		return {
			kind: "refused",
			hash: refused.hash,
			time: refused.time,
			error: refused.error ?? "",
		};
	// a list read before the explorer could have listed it proves nothing yet
	if (q.sentAt !== null && list.readAt < q.sentAt + RECORD_LAG_MS)
		return now < q.sentAt + RECORD_LAG_MS
			? { kind: "just-sent" }
			: { kind: "checking" };
	const earliest = q.nonce - LANDS_BEFORE_NONCE_MS;
	const reaches =
		!list.txs.truncated ||
		(list.txs.oldest !== null && list.txs.oldest <= earliest);
	return reaches ? { kind: "missing" } : { kind: "too-old" };
}

/** Whether the list should be read again for this answer: it was read too soon to tell. */
export function recordRereadDue(
	q: RecordQuestion,
	list: RecordList,
	now: number,
	lastTry: number,
	everyMs = 60_000,
): boolean {
	if (list.state !== "read" || q.sentAt === null) return false;
	const verdict = onRecord(q, list, now);
	if (verdict.kind === "checking") return now - lastTry >= 0;
	return verdict.kind === "just-sent" && now - lastTry >= everyMs;
}
