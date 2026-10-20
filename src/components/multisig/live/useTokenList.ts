import { infoClient, type Network } from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";

/**
 * The spot tokens of a network (names, ids, decimals): metadata, not money,
 * read once and kept five minutes. The propose form and a proposal page share
 * it, so an amount and a token are judged by the same list.
 */
export function useTokenList(network: Network, enabled: boolean) {
	return useQuery({
		queryKey: ["universe", network],
		queryFn: () => infoClient(network).universe(),
		staleTime: 5 * 60_000,
		retry: 1,
		enabled,
	});
}
