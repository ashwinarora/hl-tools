import {
	type Delegation,
	infoClient,
	type Network,
	type StakingEvent,
	type StakingSummary,
	type Validator,
} from "@hl-tools/core";
import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { AccountTarget } from "#/components/tools/multisig/model";

/**
 * How often an open page asks about an account's staking. Hyperliquid pushes
 * balances, positions and orders over the WebSocket, but nothing about
 * staking is on any of its channels (not even in the combined snapshots), so
 * staking is asked for, like the signers and the API wallets: once a minute
 * while it is shown, and again when something says it has changed.
 */
export const STAKING_REFRESH_MS = 60_000;

const accountKey = (network: Network, user: string) =>
	["staking", network, user.toLowerCase()] as const;

/** The staking balance: one request, weight 20. */
export const stakingSummaryQueryOptions = (network: Network, user: string) =>
	queryOptions({
		queryKey: [...accountKey(network, user), "summary"],
		queryFn: ({ signal }) =>
			infoClient(network).delegatorSummary(user, { fresh: true, signal }),
		staleTime: 10_000,
		retry: 1,
	});

/** The stakes, one per validator, each with the end of its lockup. */
export const delegationsQueryOptions = (network: Network, user: string) =>
	queryOptions({
		queryKey: [...accountKey(network, user), "delegations"],
		queryFn: ({ signal }) =>
			infoClient(network).delegations(user, { fresh: true, signal }),
		staleTime: 10_000,
		retry: 1,
	});

/** Hyperliquid's list of the account's staking steps: it says when a return was started. */
export const stakingHistoryQueryOptions = (network: Network, user: string) =>
	queryOptions({
		queryKey: [...accountKey(network, user), "history"],
		queryFn: ({ signal }) =>
			infoClient(network).delegatorHistory(user, { fresh: true, signal }),
		staleTime: 10_000,
		retry: 1,
	});

/**
 * Every validator with its state. The request is not in Hyperliquid's API
 * documentation, so a caller copes with it failing or answering in a shape
 * that cannot be read (`validators` is then null).
 */
export const validatorsQueryOptions = (network: Network) =>
	queryOptions({
		queryKey: ["validators", network],
		queryFn: ({ signal }) =>
			infoClient(network).validatorSummaries({ fresh: true, signal }),
		staleTime: 30_000,
		retry: 1,
	});

/** Read an account's staking again now: after a staking step was accepted. */
export function refreshStaking(
	queries: QueryClient,
	network: Network,
	user: string,
): Promise<void> {
	return queries.invalidateQueries({ queryKey: accountKey(network, user) });
}

/** How much of an account's staking a screen shows; nothing more is asked for. */
export interface StakingWants {
	/** The stakes with their lockups. */
	readonly stakes?: boolean;
	/** The list of steps (needed for when a return lands). */
	readonly history?: boolean;
	/** The list of validators. */
	readonly validators?: boolean;
}

export interface Staking {
	/** Null while unread, and when Hyperliquid's answer could not be read. */
	readonly summary: StakingSummary | null;
	readonly delegations: readonly Delegation[] | null;
	readonly history: readonly StakingEvent[] | null;
	readonly validators: readonly Validator[] | null;
	/** The staking balance is being read for the first time. */
	readonly pending: boolean;
	/** When everything shown was last read (the oldest of the reads). */
	readonly checkedAt: number | null;
	readonly checking: boolean;
	/** The latest read of something shown failed. */
	readonly failed: boolean;
	refetch(): void;
}

/**
 * An account's staking, as far as the screen shows it: read when the screen
 * opens, again every minute while the tab is in front, when the tab comes
 * back, on demand, and whenever `changed` changes (the account's spot HYPE,
 * which moves when HYPE goes into staking or a return lands). Never while
 * the tab is hidden.
 */
export function useStaking(
	target: AccountTarget | null,
	wants: StakingWants = {},
	changed?: string | null,
): Staking {
	const network = target?.network ?? "mainnet";
	const address = target?.address ?? "";
	const shared = {
		refetchInterval: STAKING_REFRESH_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
	} as const;
	const summary = useQuery({
		...stakingSummaryQueryOptions(network, address),
		...shared,
		enabled: !!target,
	});
	const delegations = useQuery({
		...delegationsQueryOptions(network, address),
		...shared,
		enabled: !!target && !!wants.stakes,
	});
	const history = useQuery({
		...stakingHistoryQueryOptions(network, address),
		...shared,
		enabled: !!target && !!wants.history,
	});
	const validators = useQuery({
		...validatorsQueryOptions(network),
		...shared,
		enabled: !!target && !!wants.validators,
	});

	const used = [
		summary,
		...(wants.stakes ? [delegations] : []),
		...(wants.history ? [history] : []),
		...(wants.validators ? [validators] : []),
	];
	const refetchSummary = summary.refetch;
	const refetchDelegations = delegations.refetch;
	const refetchHistory = history.refetch;
	const refetchValidators = validators.refetch;
	const { stakes, history: wantsHistory, validators: wantsValidators } = wants;
	const refetch = useCallback(() => {
		void refetchSummary();
		if (stakes) void refetchDelegations();
		if (wantsHistory) void refetchHistory();
		if (wantsValidators) void refetchValidators();
	}, [
		refetchSummary,
		refetchDelegations,
		refetchHistory,
		refetchValidators,
		stakes,
		wantsHistory,
		wantsValidators,
	]);

	// spot HYPE moved: HYPE went into staking or came back. The first value is
	// where things stand, not a change.
	const seen = useRef(changed);
	useEffect(() => {
		if (seen.current === changed) return;
		const first = seen.current === undefined || seen.current === null;
		seen.current = changed;
		if (!first && target) refetch();
	}, [changed, target, refetch]);

	const read = used.map((q) => q.dataUpdatedAt).filter((t) => t > 0);
	return {
		summary: summary.data?.data ?? null,
		delegations: delegations.data?.data ?? null,
		history: history.data?.data ?? null,
		validators: validators.data?.data ?? null,
		pending: !!target && summary.data === undefined && summary.isPending,
		checkedAt: read.length === used.length ? Math.min(...read) : null,
		checking: used.some((q) => q.isFetching),
		failed: used.some((q) => q.isError),
		refetch,
	};
}
