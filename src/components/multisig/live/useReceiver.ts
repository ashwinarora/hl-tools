import { infoClient, type Network } from "@hl-tools/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Receiver } from "../model/actions";
import { receiverOf } from "../model/send";

/**
 * What Hyperliquid knows about an address a send names: whether it was ever
 * used (the first send to a new one costs 1 USDC) and its account mode (which
 * of its balances the money lands in). Two info reads per address, kept for
 * half a minute: an address does not stop being in use.
 */
export const receiverQueryOptions = (network: Network, address: string) =>
	queryOptions({
		queryKey: ["multisig-receiver", network, address.toLowerCase()],
		queryFn: async ({ signal }): Promise<Receiver> => {
			const client = infoClient(network);
			const [role, mode] = await Promise.all([
				client.userRole(address, { fresh: true, signal }),
				// the mode only says where the money lands: the cost can be told without it
				client
					.userAbstraction(address, { fresh: true, signal })
					.catch(() => null),
			]);
			return receiverOf(role.data, mode?.data ?? null);
		},
		staleTime: 30_000,
		retry: 1,
	});

/** The value once it has stopped changing for `ms`: nobody is looked up letter by letter. */
function useSettled<T>(value: T, ms: number): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return settled;
}

export interface ReceiverLookup {
	/**
	 * idle     no whole address to look up
	 * loading  being read (or about to be)
	 * ready    `receiver` is what Hyperliquid said
	 * failed   it could not be read: nothing is claimed
	 */
	readonly state: "idle" | "loading" | "ready" | "failed";
	readonly receiver: Receiver | null;
}

export function useReceiver(
	network: Network,
	/** A whole, lowercased address, or null. */
	destination: string | null,
	options: { readonly settleMs?: number } = {},
): ReceiverLookup {
	const settled = useSettled(destination, options.settleMs ?? 400);
	const query = useQuery({
		...receiverQueryOptions(network, settled ?? ""),
		enabled: settled !== null,
	});
	if (destination === null) return { state: "idle", receiver: null };
	// typed a moment ago: not asked yet
	if (settled !== destination) return { state: "loading", receiver: null };
	if (query.data) return { state: "ready", receiver: query.data };
	return { state: query.isError ? "failed" : "loading", receiver: null };
}
