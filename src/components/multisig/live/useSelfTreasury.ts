import type { Network, Policy } from "@hl-tools/core";
import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import { policyQueryOptions } from "#/components/tools/multisig/policyQuery";
import { SELF_STALE_MS } from "../model/selfTreasury";

/**
 * Is this wallet itself a multi-sig on this network? The same read as a
 * treasury page's signer set, so the two share an answer, but kept for five
 * minutes and not repeated on a timer: a wallet does not become a treasury
 * behind the reader's back, and the one moment it does (a conversion made on
 * this page) is written in directly with `rememberSelfTreasury`.
 */
export const selfTreasuryQueryOptions = (network: Network, wallet: string) =>
	queryOptions({
		...policyQueryOptions(network, wallet),
		staleTime: SELF_STALE_MS,
		refetchOnWindowFocus: false,
		refetchInterval: false,
	});

export interface SelfTreasury {
	/** The wallet's own signer set; null when it has none, or while that is not known. */
	readonly policy: Policy | null;
	/** Hyperliquid has answered: `policy === null` then means "a normal account". */
	readonly known: boolean;
}

export function useSelfTreasury(
	network: Network,
	/** The connected wallet, or null: nothing is asked without one. */
	wallet: string | null,
	enabled = true,
): SelfTreasury {
	const query = useQuery({
		...selfTreasuryQueryOptions(network, wallet ?? ""),
		enabled: enabled && wallet !== null,
	});
	if (wallet === null || query.data === undefined)
		return { policy: null, known: false };
	return { policy: query.data.data, known: true };
}

/** What a conversion made here just changed: no need to ask Hyperliquid again. */
export function rememberSelfTreasury(
	queries: QueryClient,
	network: Network,
	wallet: string,
	policy: Policy | null,
	observedAt = Date.now(),
): void {
	queries.setQueryData(policyQueryOptions(network, wallet).queryKey, {
		network,
		observedAt,
		source:
			"userToMultiSigSigners, read back after a conversion made on this page",
		data: policy,
	});
}
