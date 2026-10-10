import {
	type AgentInfo,
	describeFailure,
	type ExplorerHistory,
	explorerUserDetails,
	hexToBigInt,
	infoClient,
	infoRequestWeight,
	type Network,
	networkConfig,
	type Observed,
	type OpenOrder,
	type PerpState,
	type Policy,
	rpcCall,
	type SpotState,
	type UserRole,
} from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "#/hooks/useHyperliquid";
import type { AccountTarget } from "./model";

/** One info call's outcome: the observed answer or the reason it failed. */
export type Section<T> =
	| { readonly ok: true; readonly observed: Observed<T, Network> }
	| { readonly ok: false; readonly error: string };

export interface AccountData {
	readonly address: `0x${string}`;
	readonly network: Network;
	readonly observedAt: number;
	readonly policy: Section<Policy | null>;
	/** Fetched only when the address is not a multi-sig user (weight 60). */
	readonly role: Section<UserRole> | null;
	readonly agents: Section<readonly AgentInfo[]>;
	readonly perp: Section<PerpState>;
	readonly spot: Section<SpotState>;
	readonly openOrders: Section<readonly OpenOrder[]>;
	/** Request bodies sent, with their rate-limit weight, for the raw panel. */
	readonly requests: readonly { type: string; weight: number; ok: boolean }[];
}

async function section<T>(
	p: Promise<Observed<T, Network>>,
): Promise<Section<T>> {
	try {
		return { ok: true, observed: await p };
	} catch (e) {
		return { ok: false, error: errorMessage(e) };
	}
}

/**
 * Everything the account view shows, in one query so the page has one
 * observation time and one stale-network banner. Sections fail independently.
 */
export function useAccount(
	target: AccountTarget | null,
	opts: { refetchInterval?: number } = {},
) {
	return useQuery<AccountData>({
		queryKey: ["multisig-account", target?.network, target?.address],
		enabled: !!target,
		staleTime: 10_000,
		retry: 1,
		refetchInterval: opts.refetchInterval,
		queryFn: async () => {
			if (!target) throw new Error("no target");
			const { address, network } = target;
			const client = infoClient(network);
			const [policy, agents, perp, spot, openOrders] = await Promise.all([
				section(client.multiSigSigners(address)),
				section(client.extraAgents(address)),
				section(client.clearinghouseState(address)),
				section(client.spotClearinghouseState(address)),
				section(client.openOrders(address)),
			]);
			const isMultiSig = policy.ok && policy.observed.data !== null;
			const role = isMultiSig ? null : await section(client.userRole(address));
			const requests = [
				["userToMultiSigSigners", policy.ok],
				["extraAgents", agents.ok],
				["clearinghouseState", perp.ok],
				["spotClearinghouseState", spot.ok],
				["openOrders", openOrders.ok],
				...(role ? [["userRole", role.ok] as const] : []),
			].map(([type, ok]) => ({
				type: type as string,
				weight: infoRequestWeight(type as string).baseWeight,
				ok: ok as boolean,
			}));
			return {
				address,
				network,
				observedAt: Date.now(),
				policy,
				role,
				agents,
				perp,
				spot,
				openOrders,
				requests,
			};
		},
	});
}

/** Per-signer policies, to tell whether a signer is itself a multi-sig user. On demand. */
export function useSignerPolicies(
	target: AccountTarget | null,
	signers: readonly string[],
	enabled: boolean,
) {
	return useQuery<Observed<Record<string, Policy | null>, Network>>({
		queryKey: [
			"multisig-nesting",
			target?.network,
			target?.address,
			signers.join(","),
		],
		enabled: enabled && !!target && signers.length > 0,
		staleTime: 10_000,
		retry: 1,
		queryFn: async () => {
			if (!target) throw new Error("no target");
			const client = infoClient(target.network);
			const entries = await Promise.all(
				signers.map(
					async (s) => [s, (await client.multiSigSigners(s)).data] as const,
				),
			);
			return {
				network: target.network,
				observedAt: Date.now(),
				source: `${signers.length}× userToMultiSigSigners`,
				data: Object.fromEntries(entries),
			};
		},
	});
}

/** HyperEVM balance of the same address, on demand. */
export function useEvmBalance(target: AccountTarget | null, enabled: boolean) {
	return useQuery<Observed<bigint, Network>>({
		queryKey: ["multisig-evm", target?.network, target?.address],
		enabled: enabled && !!target,
		staleTime: 10_000,
		retry: 1,
		queryFn: async () => {
			if (!target) throw new Error("no target");
			const url = networkConfig(target.network).evmRpcUrl;
			const r = await rpcCall<string>(url, "eth_getBalance", [
				target.address,
				"latest",
			]);
			const wei = r.failure ? null : hexToBigInt(r.result);
			if (r.failure || wei === null) {
				throw new Error(
					r.failure
						? describeFailure(r.failure)
						: "eth_getBalance returned no balance",
				);
			}
			return {
				network: target.network,
				observedAt: Date.now(),
				source: `${url} eth_getBalance`,
				data: wei,
			};
		},
	});
}

/** Recent on-chain actions from the explorer API (weight 40), on demand. */
export function useHistory(target: AccountTarget | null, enabled: boolean) {
	return useQuery<Observed<ExplorerHistory, Network>>({
		queryKey: ["multisig-history", target?.network, target?.address],
		enabled: enabled && !!target,
		staleTime: 30_000,
		retry: 0,
		queryFn: async ({ signal }) => {
			if (!target) throw new Error("no target");
			return explorerUserDetails(target.network, target.address, { signal });
		},
	});
}
