import {
	infoClient,
	type Network,
	type VaultDeposit,
	type VaultLookup,
} from "@hl-tools/core";
import {
	type QueryClient,
	queryOptions,
	useQueries,
	useQuery,
} from "@tanstack/react-query";
import type { AccountTarget } from "#/components/tools/multisig/model";

/**
 * How often an open page asks about an account's vault deposits. As with
 * staking, nothing about vaults is on any of Hyperliquid's channels, so it is
 * asked for: once a minute while it is shown, and again when something says
 * it has changed. A vault's own details (its name, leader and terms) are read
 * once when they are first shown and kept for ten minutes.
 */
export const VAULTS_REFRESH_MS = 60_000;
const DETAILS_FRESH_MS = 10 * 60_000;

const depositsKey = (network: Network, user: string) =>
	["vault-deposits", network, user.toLowerCase()] as const;

/** Every vault the account has money in: one request. */
export const vaultDepositsQueryOptions = (network: Network, user: string) =>
	queryOptions({
		queryKey: depositsKey(network, user),
		queryFn: ({ signal }) =>
			infoClient(network).vaultDeposits(user, { fresh: true, signal }),
		staleTime: 10_000,
		retry: 1,
	});

/**
 * What Hyperliquid reports about one vault, with the account's own deposit
 * in it when `user` is given (about 50 KB for a large vault, so asked
 * sparingly).
 */
export const vaultQueryOptions = (
	network: Network,
	vault: string,
	user: string | null,
) =>
	queryOptions({
		queryKey: [
			"vault",
			network,
			vault.toLowerCase(),
			user?.toLowerCase() ?? null,
		],
		queryFn: ({ signal }) =>
			infoClient(network).vault(vault, user ?? undefined, {
				fresh: true,
				signal,
			}),
		staleTime: DETAILS_FRESH_MS,
		retry: 1,
	});

/** Read an account's vault deposits again now: after a vault step was accepted. */
export function refreshVaults(
	queries: QueryClient,
	network: Network,
	user: string,
): Promise<void> {
	return Promise.all([
		queries.invalidateQueries({ queryKey: depositsKey(network, user) }),
		// each vault's details carry the account's deposit too
		queries.invalidateQueries({
			predicate: (q) =>
				q.queryKey[0] === "vault" &&
				q.queryKey[1] === network &&
				q.queryKey[3] === user.toLowerCase(),
		}),
	]).then(() => undefined);
}

export interface Vaults {
	/** Null while unread, and when Hyperliquid's answer could not be read. */
	readonly deposits: readonly VaultDeposit[] | null;
	/** The deposits are being read for the first time. */
	readonly pending: boolean;
	readonly checkedAt: number | null;
	readonly checking: boolean;
	/** The latest read failed. */
	readonly failed: boolean;
	refetch(): void;
}

/**
 * An account's vault deposits: read when the screen opens, again every
 * minute while the tab is in front, when the tab comes back, and on demand.
 * Never while the tab is hidden; nothing is asked while `target` is null.
 */
export function useVaults(target: AccountTarget | null): Vaults {
	const network = target?.network ?? "mainnet";
	const address = target?.address ?? "";
	const q = useQuery({
		...vaultDepositsQueryOptions(network, address),
		refetchInterval: VAULTS_REFRESH_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		enabled: !!target,
	});
	return {
		deposits: q.data?.data ?? null,
		pending: !!target && q.data === undefined && q.isPending,
		checkedAt: q.dataUpdatedAt > 0 ? q.dataUpdatedAt : null,
		checking: q.isFetching,
		failed: q.isError,
		refetch: () => void q.refetch(),
	};
}

/**
 * One vault as Hyperliquid reports it. Null while it is being read, or when
 * the read failed (`failed`); nothing is asked while `vault` is null.
 */
export function useVault(
	network: Network,
	vault: string | null,
	user: string | null,
): {
	readonly lookup: VaultLookup | null;
	readonly loading: boolean;
	readonly failed: boolean;
} {
	const q = useQuery({
		...vaultQueryOptions(network, vault ?? "", user),
		enabled: !!vault,
		refetchOnWindowFocus: false,
	});
	return {
		lookup: vault ? (q.data?.data ?? null) : null,
		loading: !!vault && q.isFetching && q.data === undefined,
		failed: !!vault && q.isError,
	};
}

/**
 * Several vaults at once (the Vaults tab names each one the account has
 * money in), keyed by address. A vault that is not read yet is absent.
 */
export function useVaultDetails(
	network: Network,
	vaults: readonly string[],
	user: string | null,
): ReadonlyMap<string, VaultLookup> {
	const results = useQueries({
		queries: vaults.map((v) => ({
			...vaultQueryOptions(network, v, user),
			refetchOnWindowFocus: false,
		})),
	});
	const out = new Map<string, VaultLookup>();
	vaults.forEach((v, i) => {
		const data = results[i]?.data?.data;
		if (data) out.set(v.toLowerCase(), data);
	});
	return out;
}
