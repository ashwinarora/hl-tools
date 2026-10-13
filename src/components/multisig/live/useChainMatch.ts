/**
 * The "Proposal" cell of every ledger row: for rows that could be a known
 * proposal's, the transaction behind the row is read from Hyperliquid's
 * explorer and compared with the proposal's action.
 *
 * The explorer is asked for the account's newest transactions in one request
 * (`userDetails`), and about a single transaction (`txDetails`) only when
 * that list cannot have it: see `model/chain/accountTxs.ts` for the rule and
 * why. Every explorer request is paced, kept for the session, and never
 * repeated on focus.
 */
import {
	ExplorerAllowanceError,
	type ExplorerTx,
	explorerTxDetails,
	explorerUserDetails,
	type LedgerRow,
	type Network,
} from "@hl-tools/core";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type { AccountTarget } from "#/components/tools/multisig/model";
import {
	accountsOf,
	indexTxs,
	listedTx,
	listState,
	rereadDue,
	routeTx,
	type WantedTx,
} from "../model/chain/accountTxs";
import {
	hashesToLookUp,
	type Lookup,
	type MatchCandidate,
	type RowProposal,
	rowProposal,
} from "../model/chain/match";
import { Pacer, Rest } from "../model/chain/pace";

/**
 * One explorer request weighs 40 of the 1200 a network address may spend in a
 * minute, shared with everything else the page asks: five at once, then one
 * every three seconds (at most 800 a minute).
 */
const pacers = new Map<Network, Pacer>();
function pacer(network: Network): Pacer {
	let p = pacers.get(network);
	if (!p) {
		p = new Pacer({ burst: 5, everyMs: 3_000 });
		pacers.set(network, p);
	}
	return p;
}

/**
 * Once the explorer says a network address has used up its allowance for the
 * day, it says so to every look-up. Nothing more is asked for ten minutes.
 * Nothing asks again by itself after that either: what could not be checked
 * says so, and is asked once more when the reader presses "retry" beside it
 * or opens the page again. That one look-up finds out whether it is still so.
 */
const EXPLORER_REST_MS = 10 * 60_000;
const rests = new Map<Network, Rest>();
function rest(network: Network): Rest {
	let r = rests.get(network);
	if (!r) {
		r = new Rest(EXPLORER_REST_MS);
		rests.set(network, r);
	}
	return r;
}

/** The explorer answered, and does not know the hash (it can lag the ledger by a moment). */
class UnknownHash extends Error {}
/** Not asked: the explorer said a moment ago that the day's allowance is used up. */
class Resting extends Error {}

const ZERO_HASH = /^0x0+$/;
const key = (network: Network, hash: string) =>
	["explorer-tx", network, hash.toLowerCase()] as const;
const listKey = (network: Network, account: string) =>
	["explorer-account", network, account.toLowerCase()] as const;

/**
 * When each transaction was first wanted in this session, by this device's
 * clock (the clock a read is stamped with too). Kept for the session and not
 * per screen: a screen that opens again must not take every transaction for
 * newly wanted and read the list once more for it.
 */
const firstWanted = new Map<string, number>();
function wantedSince(network: Network, hash: string, now: number): number {
	const id = `${network}:${hash.toLowerCase()}`;
	const at = firstWanted.get(id);
	if (at !== undefined) return at;
	firstWanted.set(id, now);
	return now;
}

/** A row's look-up, as `rowProposal` takes it. */
export function lookupOf(
	lookups: ReadonlyMap<string, Lookup>,
	row: LedgerRow,
): Lookup | undefined {
	const hash = row.hash.toLowerCase();
	return ZERO_HASH.test(hash) ? { state: "unknown-hash" } : lookups.get(hash);
}

const SESSION = {
	// a transaction never changes; an answer is kept for the session
	staleTime: Number.POSITIVE_INFINITY,
	gcTime: 60 * 60_000,
	refetchOnWindowFocus: false,
	refetchOnReconnect: false,
} as const;

/**
 * The transactions a screen wants, from Hyperliquid's explorer: each
 * account's newest transactions in one request, and a request of its own
 * only for a transaction that list cannot have. Once per session, paced,
 * shared by every screen that asks. The answer is keyed by the hash as the
 * caller wrote it.
 */
export function useTxLookups(
	network: Network,
	wanted: readonly WantedTx[],
): ReadonlyMap<string, Lookup> {
	// each transaction once, with the moment it was first wanted
	const asked = useMemo(() => {
		const now = Date.now();
		const out = new Map<
			string,
			{ readonly account: string; readonly since: number }
		>();
		for (const w of wanted) {
			const id = w.hash.toLowerCase();
			if (!out.has(id))
				out.set(id, {
					account: w.account.toLowerCase(),
					since: wantedSince(network, id, now),
				});
		}
		return out;
	}, [network, wanted]);
	const ids = useMemo(() => [...asked.keys()], [asked]);
	const accounts = useMemo(() => accountsOf(wanted), [wanted]);

	// ---- one request per account: its newest transactions
	const lists = useQueries({
		queries: accounts.map((account) => ({
			queryKey: listKey(network, account),
			queryFn: async ({
				signal,
			}: {
				signal: AbortSignal;
			}): Promise<ReadonlyMap<string, ExplorerTx>> => {
				await pacer(network).turn();
				// the screen that asked may be gone by the time its turn comes
				signal.throwIfAborted();
				try {
					const r = await explorerUserDetails(network, account, { signal });
					return indexTxs(r.data.txs);
				} catch (e) {
					if (e instanceof ExplorerAllowanceError) rest(network).start();
					throw e;
				}
			},
			...SESSION,
			// a refusal for the day is not tried again: it would be refused again
			retry: (failures: number, error: Error) =>
				failures < 1 && !(error instanceof ExplorerAllowanceError),
			retryDelay: 2_000,
		})),
	});
	const listOf = useMemo(() => {
		const out = new Map<string, ReturnType<typeof listState>>();
		accounts.forEach((account, i) => {
			const q = lists[i];
			out.set(
				account.toLowerCase(),
				listState({
					txs: q?.data,
					reading: q?.isFetching ?? false,
					readAt: q?.dataUpdatedAt ?? 0,
					failedAt: q?.errorUpdatedAt ?? 0,
				}),
			);
		});
		return out;
	}, [accounts, lists]);
	const routeOf = useCallback(
		(id: string) => {
			const w = asked.get(id);
			const list = w ? listOf.get(w.account) : undefined;
			return w && list ? routeTx(id, w.since, list) : "wait";
		},
		[asked, listOf],
	);

	// ---- a request of its own, only where the list cannot have it
	const singles = useQueries({
		queries: ids.map((id) => ({
			queryKey: key(network, id),
			queryFn: async ({
				signal,
			}: {
				signal: AbortSignal;
			}): Promise<ExplorerTx> => {
				if (rest(network).resting) throw new Resting();
				await pacer(network).turn();
				// the screen that asked may be gone by the time its turn comes
				// (another treasury was opened): then nothing is asked at all
				signal.throwIfAborted();
				// the look-up ahead of this one may have been refused meanwhile
				if (rest(network).resting) throw new Resting();
				try {
					const r = await explorerTxDetails(network, id, { signal });
					if (!r.data.found) throw new UnknownHash(r.data.reason);
					return r.data.tx;
				} catch (e) {
					if (e instanceof ExplorerAllowanceError) rest(network).start();
					throw e;
				}
			},
			enabled: routeOf(id) === "single",
			...SESSION,
			// a refusal for the day is not tried again: it would be refused again
			retry: (failures: number, error: Error) =>
				failures < 2 &&
				!(error instanceof ExplorerAllowanceError || error instanceof Resting),
			retryDelay: 4_000,
		})),
	});

	// A transaction wanted after its account's list was read (a transfer that
	// landed while the page was open): the list is read once more for it.
	useEffect(() => {
		accounts.forEach((account, i) => {
			const list = listOf.get(account.toLowerCase());
			if (!list) return;
			const missing = ids.flatMap((id, n) => {
				const w = asked.get(id);
				return w && w.account === account.toLowerCase() && !singles[n]?.data
					? [{ hash: id, since: w.since }]
					: [];
			});
			if (rereadDue(list, missing)) void lists[i]?.refetch();
		});
	}, [accounts, listOf, ids, asked, singles, lists]);

	return useMemo(() => {
		const byId = new Map<string, Lookup>();
		ids.forEach((id, n) => {
			const q = singles[n];
			const w = asked.get(id);
			const list = w ? listOf.get(w.account) : undefined;
			const listed = list ? listedTx(list, id) : null;
			byId.set(
				id,
				q?.data
					? { state: "found", tx: q.data }
					: listed
						? { state: "found", tx: listed }
						: routeOf(id) === "single" && q?.isError
							? {
									state:
										q.error instanceof UnknownHash ? "unknown-hash" : "failed",
								}
							: { state: "pending" },
			);
		});
		// keyed as each caller wrote the hash
		const out = new Map<string, Lookup>();
		for (const w of wanted) {
			const l = byId.get(w.hash.toLowerCase());
			if (l) out.set(w.hash, l);
		}
		return out;
	}, [ids, singles, asked, listOf, routeOf, wanted]);
}

export interface ChainMatch {
	/** What the row's "Proposal" cell says. */
	of(row: LedgerRow): RowProposal;
	/** Look a row's transaction up again after "could not check". */
	retry(row: LedgerRow): void;
}

export function useChainMatch(
	target: AccountTarget | null,
	ledger: readonly LedgerRow[] | null,
	proposals: readonly MatchCandidate[],
	/** False while the proposals on record are not known: nothing is looked up, nothing is "none". */
	ready: boolean,
): ChainMatch {
	const network = target?.network ?? "mainnet";
	const account = target?.address ?? "";
	const queries = useQueryClient();
	const wanted = useMemo<readonly WantedTx[]>(
		() =>
			ready && ledger && account
				? hashesToLookUp(ledger, proposals).map((hash) => ({ account, hash }))
				: [],
		[ready, ledger, proposals, account],
	);
	const lookups = useTxLookups(network, wanted);
	const of = useCallback(
		(row: LedgerRow): RowProposal => {
			if (!ready) {
				// who knows what is on record? Not yet us.
				return row.direction === "out" || row.direction === "within"
					? { kind: "checking" }
					: { kind: "not-applicable" };
			}
			return rowProposal(row, account, proposals, lookupOf(lookups, row));
		},
		[ready, account, proposals, lookups],
	);
	const retry = useCallback(
		(row: LedgerRow) =>
			void queries.refetchQueries({ queryKey: key(network, row.hash) }),
		[queries, network],
	);
	return useMemo(() => ({ of, retry }), [of, retry]);
}
