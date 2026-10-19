import { infoClient, type Network } from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";
import type { OutcomeLists } from "../model/outcomes";

/** How long the two lists are kept: they change when a market is added, not with money. */
export const OUTCOME_LISTS_STALE_MS = 10 * 60_000;

/**
 * Hyperliquid's list of outcomes and the templates their names are written
 * with, to name the outcome shares a treasury holds (`splitHoldings`). Two
 * info reads, made only while `enabled` (the treasury holds a share) and
 * kept for ten minutes per network; neither is about money. Either may
 * fail: the share is then named by its number.
 */
export function useOutcomeLists(
	network: Network,
	enabled: boolean,
): OutcomeLists | null {
	const q = useQuery({
		queryKey: ["outcome-lists", network],
		queryFn: async ({ signal }): Promise<OutcomeLists> => {
			const client = infoClient(network);
			const [meta, templates] = await Promise.all([
				client.outcomeMeta().catch(() => null),
				client.outcomeTemplates().catch(() => null),
			]);
			if (signal.aborted) throw signal.reason;
			return { meta: meta?.data ?? null, templates: templates?.data ?? null };
		},
		enabled,
		staleTime: OUTCOME_LISTS_STALE_MS,
		gcTime: 3 * OUTCOME_LISTS_STALE_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});
	return q.data ?? null;
}
