import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { fetchUsdcBalance } from "#/lib/hlActions";

export type WalletBalance = {
	mainnet: number | null;
	testnet: number | null;
};

export type WalletBalancesMap = Record<`0x${string}`, WalletBalance>;

async function fetchTotalUsdc(
	address: `0x${string}`,
	isTestnet: boolean,
): Promise<number> {
	const [perp, spot] = await Promise.all([
		fetchUsdcBalance(address, isTestnet, "perp"),
		fetchUsdcBalance(address, isTestnet, "spot"),
	]);
	return perp + spot;
}

/**
 * Poll USDC balances (perps + spot summed) for every wallet on both networks.
 * Refetches every 3 seconds while `active` is true; otherwise fetches only
 * on mount / invalidate.
 */
export function useWalletBalances(
	addresses: `0x${string}`[],
	active: boolean,
): {
	balances: WalletBalancesMap;
	refresh: () => Promise<void>;
	isFetching: boolean;
} {
	const queryClient = useQueryClient();

	const queries = useMemo(() => {
		const list: {
			queryKey: readonly unknown[];
			queryFn: () => Promise<number>;
			refetchInterval: number | false;
			staleTime: number;
		}[] = [];
		for (const addr of addresses) {
			for (const network of ["mainnet", "testnet"] as const) {
				list.push({
					queryKey: ["wallet-balance", addr, network] as const,
					queryFn: () => fetchTotalUsdc(addr, network === "testnet"),
					refetchInterval: active ? 3000 : false,
					staleTime: active ? 0 : 5000,
				});
			}
		}
		return list;
	}, [addresses, active]);

	const results = useQueries({ queries });

	const balances = useMemo<WalletBalancesMap>(() => {
		const out: WalletBalancesMap = {};
		for (let i = 0; i < addresses.length; i++) {
			const mainnet = results[i * 2]?.data ?? null;
			const testnet = results[i * 2 + 1]?.data ?? null;
			out[addresses[i]] = { mainnet, testnet };
		}
		return out;
	}, [addresses, results]);

	const refresh = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
	}, [queryClient]);

	const isFetching = results.some((r) => r.isFetching);

	return { balances, refresh, isFetching };
}
