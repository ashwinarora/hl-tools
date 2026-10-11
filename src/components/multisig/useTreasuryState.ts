/**
 * What the signer screens know about a treasury: who controls it and what it
 * holds. Two ways to get there, one shape for the screens:
 *
 *  - `useTreasuryState`      read once over HTTP (looking an address up before
 *                            adding it or proposing for it);
 *  - `useLiveTreasuryState`  for a page that stays open: holdings pushed over
 *                            the WebSocket, signers and API wallets asked for
 *                            once a minute.
 */
import type { AccountMode, AgentInfo, Policy } from "@hl-tools/core";
import type { AccountTarget } from "#/components/tools/multisig/model";
import { useAccount } from "#/components/tools/multisig/useAccount";
import { CONTROL_REFRESH_MS, useControl } from "./live/useControl";
import { type LiveWants, useLiveAccount } from "./live/useLiveAccount";
import type { LiveAccount, LiveStatus } from "./model/live/account";

export interface TreasuryState {
	readonly target: AccountTarget | null;
	readonly loading: boolean;
	/** Why the signer set could not be read, if it could not. */
	readonly error: string | null;
	/** Null while unknown; false when the address is not a multi-sig on that network. */
	readonly isMultiSig: boolean | null;
	readonly policy: Policy | null;
	readonly agents: readonly AgentInfo[] | null;
	/** Perps on the first dex: what the account is worth there and what can be moved now. */
	readonly perp: {
		readonly accountValue: string;
		readonly withdrawable: string;
	} | null;
	readonly spot:
		| readonly {
				readonly coin: string;
				/** The token's index, where the source gave one. */
				readonly token: number | null;
				readonly total: string;
				readonly hold: string;
		  }[]
		| null;
	/**
	 * How the account keeps its money (manual: perps and spot apart; unified:
	 * one balance). Null while not read: only a page that stays open reads it.
	 */
	readonly mode: AccountMode | null;
	/** The mode is on its way: the balances are not laid out before it is known. */
	readonly modePending: boolean;
	/** When the signer set and API wallets were read. */
	readonly observedAt: number | null;
	/** How this was observed, for the line under the figures. */
	readonly source: string;
	/** Holdings: read once with everything else, or arriving live (and how that connection is). */
	readonly money: "once" | LiveStatus;
	/** A read of signers and API wallets is under way. */
	readonly checking: boolean;
	refetch(): void;
}

export function useTreasuryState(target: AccountTarget | null): TreasuryState {
	const query = useAccount(target);
	const d = query.data;
	const policy = d?.policy.ok ? d.policy.observed.data : null;
	const perp = d?.perp.ok ? d.perp.observed.data : null;
	const requests = d?.requests.length ?? 0;
	const weight = d?.requests.reduce((n, r) => n + r.weight, 0) ?? 0;
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
		perp: perp
			? {
					accountValue: perp.marginSummary.accountValue,
					withdrawable: perp.withdrawable,
				}
			: null,
		spot: d?.spot.ok ? d.spot.observed.data.balances : null,
		mode: null,
		modePending: false,
		observedAt: d?.observedAt ?? null,
		source: `${requests} info requests · weight ${weight}`,
		money: "once",
		checking: query.isFetching,
		refetch: () => void query.refetch(),
	};
}

const MONEY: Record<LiveStatus, string> = {
	connecting: "balances connecting…",
	live: "balances live",
	reconnecting: "balances reconnecting…",
	down: "balances not updating: Hyperliquid cannot be reached",
	refused: "balances not updating: Hyperliquid refused live updates",
};

/** One line saying how a live treasury state is kept current. */
export function liveSource(money: LiveStatus): string {
	return `signers and API wallets checked every ${CONTROL_REFRESH_MS / 60_000 === 1 ? "minute" : `${CONTROL_REFRESH_MS / 60_000} minutes`} while open · ${MONEY[money]}`;
}

export interface LiveTreasuryState extends TreasuryState {
	readonly live: LiveAccount & { retry(): void };
	/** The latest read of signers or API wallets failed; what is shown is older. */
	readonly failed: boolean;
	readonly agentsError: string | null;
}

export function useLiveTreasuryState(
	target: AccountTarget | null,
	opts: LiveWants = {},
): LiveTreasuryState {
	const control = useControl(target);
	const live = useLiveAccount(target, opts);
	return {
		target,
		loading: control.loading,
		error: control.error,
		isMultiSig: control.isMultiSig,
		policy: control.policy,
		agents: control.agents,
		agentsError: control.agentsError,
		perp: live.perp,
		spot: live.spot,
		mode: control.mode,
		modePending: control.modePending,
		observedAt: control.checkedAt,
		source: liveSource(live.status),
		money: live.status,
		checking: control.checking,
		failed: control.failed,
		refetch: control.refetch,
		live,
	};
}
