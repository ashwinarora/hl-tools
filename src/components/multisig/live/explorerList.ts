/**
 * Reading an account's newest transactions from Hyperliquid's explorer
 * (`userDetails`), shared by every screen that needs them: the "Proposal"
 * cell of a ledger row (`useChainMatch`) and the check of an accepted
 * proposal against Hyperliquid's record (`useRecord`). One cache entry per
 * account and network, read once per session unless a screen asks again;
 * every explorer request is paced and never repeated on focus.
 */
import {
	ExplorerAllowanceError,
	explorerUserDetails,
	type Network,
} from "@hl-tools/core";
import { type AccountTxs, accountTxs } from "../model/chain/accountTxs";
import { Pacer, Rest } from "../model/chain/pace";

/**
 * One explorer request weighs 40 of the 1200 a network address may spend in a
 * minute, shared with everything else the page asks: five at once, then one
 * every three seconds (at most 800 a minute).
 */
const pacers = new Map<Network, Pacer>();
export function pacer(network: Network): Pacer {
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
 * says so, and is asked once more when the reader presses "Check again" beside it
 * or opens the page again. That one look-up finds out whether it is still so.
 */
const EXPLORER_REST_MS = 10 * 60_000;
const rests = new Map<Network, Rest>();
export function rest(network: Network): Rest {
	let r = rests.get(network);
	if (!r) {
		r = new Rest(EXPLORER_REST_MS);
		rests.set(network, r);
	}
	return r;
}

export const SESSION = {
	// a transaction never changes; an answer is kept for the session
	staleTime: Number.POSITIVE_INFINITY,
	gcTime: 60 * 60_000,
	refetchOnWindowFocus: false,
	refetchOnReconnect: false,
} as const;

export const listKey = (network: Network, account: string) =>
	["explorer-account", network, account.toLowerCase()] as const;

/** The query of one account's list, as every screen asks it. */
export function listQuery(network: Network, account: string) {
	return {
		queryKey: listKey(network, account),
		queryFn: async ({
			signal,
		}: {
			signal: AbortSignal;
		}): Promise<AccountTxs> => {
			await pacer(network).turn();
			// the screen that asked may be gone by the time its turn comes
			signal.throwIfAborted();
			try {
				const r = await explorerUserDetails(network, account, { signal });
				return accountTxs(r.data);
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
	};
}
