/**
 * The relay's data as queries. Everything is keyed under ["relay", wallet],
 * so one invalidation (a ping, a reconnect) re-reads whatever is on screen,
 * and signing out or switching wallets drops it all at once. A failed read
 * throws its issue: the last good data stays on screen next to the problem.
 */
import type { Address, Network } from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";
import type { Parsed, RequestRow, TreasuryRow } from "../model/relay/rows";
import { getRequest, listTreasuries, type Result } from "./api";
import { queryIssue, RelayQueryError, useRelay } from "./useRelay";

export function unwrap<T>(r: Result<T>): T {
	if (r.issue || r.data === null) {
		throw new RelayQueryError(
			r.issue ?? {
				code: "relay.error",
				severity: "error",
				message: "The relay returned nothing.",
			},
		);
	}
	return r.data;
}

const EMPTY: readonly TreasuryRow[] = [];

export function useTreasuries() {
	const relay = useRelay();
	const query = useQuery({
		queryKey: ["relay", relay.wallet, "treasuries"],
		enabled: !!relay.client,
		queryFn: async (): Promise<Parsed<TreasuryRow>> =>
			unwrap(
				await listTreasuries(relay.client as NonNullable<typeof relay.client>),
			),
		staleTime: 15_000,
		retry: 1,
	});
	return {
		rows: query.data?.rows ?? EMPTY,
		/** Rows the relay returned that did not have a treasury's shape. */
		dropped: query.data?.dropped ?? 0,
		loading: !!relay.client && query.isPending,
		issue: queryIssue(query.error),
		refetch: () => void query.refetch(),
	};
}

export function useTreasury(network: Network, address: Address | null) {
	const all = useTreasuries();
	return {
		...all,
		treasury:
			all.rows.find((t) => t.network === network && t.address === address) ??
			null,
	};
}

/** One lookup request, re-read every two seconds while the worker has not answered. */
export function useRequest(id: string | null) {
	const relay = useRelay();
	const query = useQuery({
		queryKey: ["relay", relay.wallet, "request", id],
		enabled: !!relay.client && !!id,
		queryFn: async (): Promise<RequestRow | null> =>
			unwrap(
				await getRequest(
					relay.client as NonNullable<typeof relay.client>,
					id as string,
				),
			),
		refetchInterval: (q) =>
			q.state.data?.status === "pending" ? 2_000 : false,
		retry: 1,
	});
	return { request: query.data ?? null, issue: queryIssue(query.error) };
}
