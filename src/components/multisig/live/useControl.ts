import {
	type AccountMode,
	type AgentInfo,
	accountMode,
	type Policy,
} from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AccountTarget } from "#/components/tools/multisig/model";
import {
	agentsQueryOptions,
	modeQueryOptions,
	policyQueryOptions,
} from "#/components/tools/multisig/policyQuery";
import { errorMessage } from "#/hooks/useHyperliquid";

/**
 * How often an open page asks who controls the account. Hyperliquid pushes
 * money over the WebSocket, but has no channel for the signer set, the API
 * wallets or the account mode, so those three are asked for: three requests
 * (weight 20 each) a minute.
 */
export const CONTROL_REFRESH_MS = 60_000;

export interface Control {
	/** The signer set has not been read yet. */
	readonly loading: boolean;
	/** Why the signer set could not be read, when nothing is known about it. */
	readonly error: string | null;
	/** Null while unknown; false when the address is not a multi-sig on that network. */
	readonly isMultiSig: boolean | null;
	readonly policy: Policy | null;
	/** Null while unknown or unreadable. */
	readonly agents: readonly AgentInfo[] | null;
	readonly agentsError: string | null;
	/** How the account keeps its money; null while unknown or unreadable. */
	readonly mode: AccountMode | null;
	/** The mode is being read for the first time: nothing is known of it yet. */
	readonly modePending: boolean;
	/** When both lists were last read from Hyperliquid (the older of the two). */
	readonly checkedAt: number | null;
	/** A read is under way. */
	readonly checking: boolean;
	/** The latest read failed; what is shown is from `checkedAt`. */
	readonly failed: boolean;
	refetch(): void;
}

/**
 * Who controls an account: read when the page opens, again every minute while
 * the tab is in front, again when the tab comes back, and on demand. Never
 * while the tab is hidden.
 */
export function useControl(target: AccountTarget | null): Control {
	const network = target?.network ?? "mainnet";
	const address = target?.address ?? "";
	const shared = {
		enabled: !!target,
		refetchInterval: CONTROL_REFRESH_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
	} as const;
	const policy = useQuery({
		...policyQueryOptions(network, address),
		...shared,
	});
	const agents = useQuery({
		...agentsQueryOptions(network, address),
		...shared,
	});
	const mode = useQuery({
		...modeQueryOptions(network, address),
		...shared,
	});
	const refetchPolicy = policy.refetch;
	const refetchAgents = agents.refetch;
	const refetchMode = mode.refetch;
	const refetch = useCallback(() => {
		void refetchPolicy();
		void refetchAgents();
		void refetchMode();
	}, [refetchPolicy, refetchAgents, refetchMode]);
	const modeRaw = mode.data?.data;
	const modeRead = useMemo(
		() => (modeRaw === undefined ? null : accountMode(modeRaw)),
		[modeRaw],
	);
	const known = policy.data !== undefined;
	const read = [policy.dataUpdatedAt, agents.dataUpdatedAt].filter(
		(t) => t > 0,
	);
	return {
		loading: !!target && !known && policy.isPending,
		error: !known && policy.isError ? errorMessage(policy.error) : null,
		isMultiSig: known ? policy.data.data !== null : null,
		policy: policy.data?.data ?? null,
		agents: agents.data?.data ?? null,
		agentsError:
			agents.data === undefined && agents.isError
				? errorMessage(agents.error)
				: null,
		mode: modeRead,
		modePending: !!target && modeRaw === undefined && mode.isPending,
		checkedAt: read.length === 2 ? Math.min(...read) : null,
		checking: policy.isFetching || agents.isFetching || mode.isFetching,
		failed: policy.isError || agents.isError,
		refetch,
	};
}
