/**
 * What the signer screens know about a treasury: its signer set, approved API
 * wallets and balances, observed from the info API and re-observed while a
 * screen stays open. The screens only read this shape, so a later phase can
 * swap polling for WebSocket subscriptions without touching them.
 */
import type { AgentInfo, PerpState, Policy, SpotState } from "@hl-tools/core";
import type { AccountTarget } from "#/components/tools/multisig/model";
import { useAccount } from "#/components/tools/multisig/useAccount";

/** One refresh costs weight 64 of the 1200 per minute, so not more often than this. */
export const REFRESH_MS = 30_000;

export interface TreasuryState {
	readonly target: AccountTarget | null;
	readonly loading: boolean;
	/** Why the signer set could not be read, if it could not. */
	readonly error: string | null;
	/** Null while unknown; false when the address is not a multi-sig on that network. */
	readonly isMultiSig: boolean | null;
	readonly policy: Policy | null;
	readonly agents: readonly AgentInfo[] | null;
	readonly perp: PerpState | null;
	readonly spot: SpotState | null;
	readonly observedAt: number | null;
	readonly requests: number;
	readonly weight: number;
	readonly live: boolean;
	refetch(): void;
}

export function useTreasuryState(
	target: AccountTarget | null,
	opts: { live?: boolean } = {},
): TreasuryState {
	const live = opts.live ?? false;
	const query = useAccount(target, {
		refetchInterval: live ? REFRESH_MS : undefined,
	});
	const d = query.data;
	const policy = d?.policy.ok ? d.policy.observed.data : null;
	return {
		target,
		loading: !!target && query.isPending,
		error: query.isError
			? String((query.error as Error).message)
			: d && !d.policy.ok
				? d.policy.error
				: null,
		isMultiSig: d?.policy.ok ? policy !== null : null,
		policy,
		agents: d?.agents.ok ? d.agents.observed.data : null,
		perp: d?.perp.ok ? d.perp.observed.data : null,
		spot: d?.spot.ok ? d.spot.observed.data : null,
		observedAt: d?.observedAt ?? null,
		requests: d?.requests.length ?? 0,
		weight: d?.requests.reduce((n, r) => n + r.weight, 0) ?? 0,
		live,
		refetch: () => void query.refetch(),
	};
}
