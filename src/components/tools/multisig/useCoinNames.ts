import type { DescribeContext, Network } from "@hl-tools/core";
import { useMemo } from "react";
import { useUniverse } from "#/hooks/useHyperliquid";

/** Perp asset index → coin name from the resolver universe (cached 5 min); unknown while loading. */
export function useCoinNames(network: Network): DescribeContext {
	const universe = useUniverse(network);
	return useMemo<DescribeContext>(() => {
		const u = universe.data;
		return {
			coin: (asset) => u?.byActionId.get(asset)?.coin,
		};
	}, [universe.data]);
}
