/**
 * The reads that say who controls an account and how it keeps its money: its
 * signer set, its API wallets and its account mode. One definition for the
 * inspector and the Multisig section, so both share an answer when they ask
 * about the same account.
 *
 * Each read goes to Hyperliquid (not to the client's own short cache): the
 * query's `staleTime` is what spaces them out, and a refresh pressed by a
 * person must show what the chain says now.
 */
import { infoClient, type Network } from "@hl-tools/core";
import { queryOptions } from "@tanstack/react-query";

export const policyQueryOptions = (network: Network, user: string) =>
	queryOptions({
		queryKey: ["multisig-policy", network, user.toLowerCase()],
		queryFn: ({ signal }) =>
			infoClient(network).multiSigSigners(user, { fresh: true, signal }),
		staleTime: 10_000,
		retry: 1,
	});

export const agentsQueryOptions = (network: Network, user: string) =>
	queryOptions({
		queryKey: ["multisig-agents", network, user.toLowerCase()],
		queryFn: ({ signal }) =>
			infoClient(network).extraAgents(user, { fresh: true, signal }),
		staleTime: 10_000,
		retry: 1,
	});

/** The account's mode (manual, unified…): it decides which ways of sending work. */
export const modeQueryOptions = (network: Network, user: string) =>
	queryOptions({
		queryKey: ["multisig-mode", network, user.toLowerCase()],
		queryFn: ({ signal }) =>
			infoClient(network).userAbstraction(user, { fresh: true, signal }),
		staleTime: 10_000,
		retry: 1,
	});
