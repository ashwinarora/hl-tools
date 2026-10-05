import {
	type AssetUniverse,
	infoClient,
	type Network,
	type Observed,
} from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";

/** Normalised asset universe for one network (cached 5 min in the core client). */
export function useUniverse<N extends Network>(network: N) {
	return useQuery<AssetUniverse<N>>({
		queryKey: ["universe", network],
		queryFn: () => infoClient(network).universe(),
		staleTime: 5 * 60_000,
		retry: 1,
	});
}

/** allMids for the first dex (includes spot and outcome mids) or a HIP-3 dex. */
export function useMids<N extends Network>(
	network: N,
	dex = "",
	enabled = true,
) {
	return useQuery<Observed<Record<string, string>, N>>({
		queryKey: ["allMids", network, dex],
		queryFn: () => infoClient(network).allMids(dex || undefined),
		staleTime: 3_000,
		refetchInterval: 15_000,
		enabled,
		retry: 1,
	});
}

export function errorMessage(e: unknown): string {
	if (e instanceof Error) {
		if (e.message === "Failed to fetch" || e.message.includes("NetworkError")) {
			return "The request did not reach the API (network error, blocked request or CORS).";
		}
		return e.message;
	}
	return String(e);
}
