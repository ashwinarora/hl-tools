/**
 * One explorer request for an account, instead of one per transaction.
 *
 * Tying a transfer to its proposal needs the transaction behind it: the
 * action as it was sent, with its number. The explorer answers that one
 * transaction at a time (`txDetails`), and it answers for an account's newest
 * transactions all at once (`userDetails`). The first is rationed by the day
 * (see the core's rule set "rate-limits"); the second is one request and was
 * not stopped by that ration when it was measured. So a screen reads the
 * account's list first and asks about a single transaction only when the
 * list cannot have it: it is older than what the list reaches back to, or
 * the list could not be read.
 *
 * What bounds the cost: a transaction gets one chance against a list read
 * after it was first wanted, then the request of its own. However the
 * explorer answers, nothing here asks in a loop.
 *
 * Pure: the screen hands in how each read stands and when each transaction
 * was first wanted, both by the same clock.
 */
import type { ExplorerTx } from "@hl-tools/core";

/** A transaction a screen wants to see, and the account it acted for. */
export interface WantedTx {
	readonly account: string;
	readonly hash: string;
}

/**
 * How the read of one account's list stands.
 *   unread   not asked for
 *   reading  on its way, for the first time or again
 *   failed   no list was ever read; the last try was at `at`
 *   read     a list is at hand; `at` is the last try, also one that failed
 */
export type ListState =
	| { readonly kind: "unread" }
	| { readonly kind: "reading" }
	| { readonly kind: "failed"; readonly at: number }
	| {
			readonly kind: "read";
			readonly at: number;
			readonly txs: ReadonlyMap<string, ExplorerTx>;
	  };

/**
 * A read as the screen's cache reports it, in the rule's terms. `readAt` and
 * `failedAt` are 0 when that never happened; a list that was read once stays
 * at hand when a later try fails, and `at` is then that later try.
 */
export function listState(i: {
	readonly txs: ReadonlyMap<string, ExplorerTx> | null | undefined;
	readonly reading: boolean;
	readonly readAt: number;
	readonly failedAt: number;
}): ListState {
	if (i.reading) return { kind: "reading" };
	const at = Math.max(i.readAt, i.failedAt);
	if (i.txs) return { kind: "read", at, txs: i.txs };
	return i.failedAt > 0 ? { kind: "failed", at } : { kind: "unread" };
}

/**
 * listed  the account's list holds it: nothing more to ask
 * wait    the list is being read, or is about to be read again
 * single  ask the explorer about this one transaction
 */
export type TxRoute = "listed" | "wait" | "single";

const idOf = (hash: string) => hash.toLowerCase();

/** An account's list by transaction id. An entry without one is left out. */
export function indexTxs(
	txs: readonly ExplorerTx[],
): ReadonlyMap<string, ExplorerTx> {
	const out = new Map<string, ExplorerTx>();
	for (const tx of txs)
		if (/^0x[0-9a-f]{64}$/i.test(tx.hash)) out.set(idOf(tx.hash), tx);
	return out;
}

/** The transaction with this id in a list that was read; null otherwise. */
export function listedTx(list: ListState, hash: string): ExplorerTx | null {
	return list.kind === "read" ? (list.txs.get(idOf(hash)) ?? null) : null;
}

/**
 * What to do about one wanted transaction. `since` is when it was first
 * wanted: a list tried before that moment has not had its chance at it yet.
 */
export function routeTx(hash: string, since: number, list: ListState): TxRoute {
	if (listedTx(list, hash)) return "listed";
	if (list.kind === "unread" || list.kind === "reading") return "wait";
	// tried since it was wanted, and it is not there (or there is no list)
	return list.at >= since ? "single" : "wait";
}

/**
 * Whether an account's list should be read again: something is wanted that
 * it does not hold, and the list was last tried before that was wanted. One
 * read answers for everything wanted by then, so this is true at most once
 * per batch of new transactions.
 */
export function rereadDue(
	list: ListState,
	wanted: readonly { readonly hash: string; readonly since: number }[],
): boolean {
	if (list.kind !== "read" && list.kind !== "failed") return false;
	return wanted.some((w) => !listedTx(list, w.hash) && w.since > list.at);
}

/** The accounts whose list a screen needs, each once, as it was first named. */
export function accountsOf(wanted: readonly WantedTx[]): string[] {
	const seen = new Map<string, string>();
	for (const w of wanted) {
		const key = w.account.toLowerCase();
		if (key && !seen.has(key)) seen.set(key, w.account);
	}
	return [...seen.values()];
}
