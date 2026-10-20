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
	InfoRequestError,
	type Network,
} from "@hl-tools/core";
import { type AccountTxs, accountTxs } from "../model/chain/accountTxs";
import type { LookupFailure } from "../model/chain/match";
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

/** Not asked: the explorer said a moment ago that the day's allowance is used up. */
export class Resting extends Error {}

/**
 * How long one explorer request may take. One that has not answered by then
 * is given up, so no row says "checking…" for ever (audit F-071).
 */
export const EXPLORER_TIMEOUT_MS = 30_000;

/** The caller's signal, ended also by the time limit. */
export function timeLimited(
	signal: AbortSignal,
	ms = EXPLORER_TIMEOUT_MS,
): AbortSignal {
	const limit = AbortSignal.timeout(ms);
	if (typeof AbortSignal.any === "function")
		return AbortSignal.any([signal, limit]);
	const both = new AbortController();
	for (const s of [signal, limit]) {
		if (s.aborted) {
			both.abort(s.reason);
			break;
		}
		s.addEventListener("abort", () => both.abort(s.reason), { once: true });
	}
	return both.signal;
}

/** The request ran out of its time limit: the explorer held it, and would hold the next. */
function timedOut(error: Error): boolean {
	const cause = (error as { readonly cause?: unknown }).cause;
	return cause instanceof Error && cause.name === "TimeoutError";
}

/**
 * Whether a failed explorer request is worth asking again by itself: never a
 * refusal for the day, a rest or a rate limit (audit F-065), and never one
 * that ran out of time, which would only keep its row at "checking…" for
 * another half minute.
 */
export function askAgain(error: Error): boolean {
	return !(
		error instanceof ExplorerAllowanceError ||
		error instanceof Resting ||
		(error instanceof InfoRequestError && error.status === 429) ||
		timedOut(error)
	);
}

/** Why a failed explorer request failed, as a row's cell says it. */
export function failureOf(error: unknown): LookupFailure {
	if (error instanceof ExplorerAllowanceError || error instanceof Resting)
		return "today";
	if (error instanceof InfoRequestError && error.status === 429)
		return "limited";
	return "no-answer";
}

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
			// resting after the day's refusal: nothing is asked (audit F-055)
			if (rest(network).resting) throw new Resting();
			await pacer(network).turn();
			// the screen that asked may be gone by the time its turn comes
			signal.throwIfAborted();
			if (rest(network).resting) throw new Resting();
			try {
				const r = await explorerUserDetails(network, account, {
					signal: timeLimited(signal),
				});
				return accountTxs(r.data);
			} catch (e) {
				if (e instanceof ExplorerAllowanceError) rest(network).start();
				throw e;
			}
		},
		...SESSION,
		// a refusal for the day is not tried again: it would be refused again
		retry: (failures: number, error: Error) => failures < 1 && askAgain(error),
		retryDelay: 2_000,
	};
}
