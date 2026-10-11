/**
 * The "Proposal" cell of every ledger row: for rows that could be a known
 * proposal's, the transaction is looked up on Hyperliquid's explorer (once
 * per hash, paced, a few at a time) and compared with the proposal's action.
 */
import {
	type ExplorerTx,
	explorerTxDetails,
	type LedgerRow,
	type Network,
} from "@hl-tools/core";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AccountTarget } from "#/components/tools/multisig/model";
import {
	candidatesFor,
	type Lookup,
	type MatchCandidate,
	type RowProposal,
	rowProposal,
} from "../model/chain/match";
import { Pacer } from "../model/chain/pace";

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

/** The explorer answered, and does not know the hash (it can lag the ledger by a moment). */
class UnknownHash extends Error {}

const ZERO_HASH = /^0x0+$/;
const key = (network: Network, hash: string) =>
	["explorer-tx", network, hash.toLowerCase()] as const;

/** The hashes worth a look-up: rows that could be a known proposal's. */
export function hashesToLookUp(
	ledger: readonly LedgerRow[],
	proposals: readonly MatchCandidate[],
): string[] {
	const out = new Set<string>();
	for (const row of ledger)
		if (
			candidatesFor(row, proposals).kind === "candidates" &&
			!ZERO_HASH.test(row.hash)
		)
			out.add(row.hash.toLowerCase());
	return [...out];
}

/** A row's look-up, as `rowProposal` takes it. */
export function lookupOf(
	lookups: ReadonlyMap<string, Lookup>,
	row: LedgerRow,
): Lookup | undefined {
	const hash = row.hash.toLowerCase();
	return ZERO_HASH.test(hash) ? { state: "unknown-hash" } : lookups.get(hash);
}

/**
 * The transactions behind some hashes, from Hyperliquid's explorer: once per
 * hash for the session, paced, shared by every screen that asks.
 */
export function useTxLookups(
	network: Network,
	hashes: readonly string[],
): ReadonlyMap<string, Lookup> {
	const results = useQueries({
		queries: hashes.map((hash) => ({
			queryKey: key(network, hash),
			queryFn: async ({
				signal,
			}: {
				signal: AbortSignal;
			}): Promise<ExplorerTx> => {
				await pacer(network).turn();
				// the screen that asked may be gone by the time its turn comes
				// (another treasury was opened): then nothing is asked at all
				signal.throwIfAborted();
				const r = await explorerTxDetails(network, hash, { signal });
				if (!r.data.found) throw new UnknownHash(r.data.reason);
				return r.data.tx;
			},
			// a transaction never changes; an answer is kept for the session
			staleTime: Number.POSITIVE_INFINITY,
			gcTime: 60 * 60_000,
			retry: 2,
			retryDelay: 4_000,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		})),
	});
	return useMemo(() => {
		const m = new Map<string, Lookup>();
		hashes.forEach((hash, i) => {
			const q = results[i];
			m.set(
				hash,
				q?.data
					? { state: "found", tx: q.data }
					: q?.isError
						? {
								state:
									q.error instanceof UnknownHash ? "unknown-hash" : "failed",
							}
						: { state: "pending" },
			);
		});
		return m;
	}, [hashes, results]);
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
	const hashes = useMemo(
		() => (ready && ledger ? hashesToLookUp(ledger, proposals) : []),
		[ready, ledger, proposals],
	);
	const lookups = useTxLookups(network, hashes);
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
