/**
 * The nicknames of the treasuries the signed-in wallet signs for. One read
 * covers them all (the relay returns only what the wallet may see); each
 * screen then takes the nicknames of its own treasury and nothing else, so a
 * name given in one treasury never shows up in another.
 */
import type { Address, Issue, Network } from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
	acceptNicknames,
	type Nickname,
	type NicknameRow,
} from "../model/relay/nicknames";
import { listNicknames, setNickname } from "../relay/api";
import { unwrap } from "../relay/queries";
import { useRelay } from "../relay/useRelay";

const NONE: readonly NicknameRow[] = [];
const EMPTY: ReadonlyMap<Address, Nickname> = new Map();

function useNicknameRows(): readonly NicknameRow[] {
	const relay = useRelay();
	const client = relay.client;
	const query = useQuery({
		// under ["relay", wallet]: a ping re-reads it, signing out drops it
		queryKey: ["relay", relay.wallet, "nicknames"],
		enabled: !!client && !!relay.wallet,
		queryFn: async () =>
			unwrap(await listNicknames(client as NonNullable<typeof client>)).rows,
		staleTime: 15_000,
		retry: 1,
	});
	return query.data ?? NONE;
}

/** The nicknames one treasury's screens may show. `signers` is the list the page trusts. */
export function useNicknames(
	network: Network | null,
	treasury: Address | null,
	signers: readonly Address[],
): ReadonlyMap<Address, Nickname> {
	const rows = useNicknameRows();
	return useMemo(
		() =>
			network && treasury
				? acceptNicknames(rows, { network, treasury, signers })
				: EMPTY,
		[rows, network, treasury, signers],
	);
}

/**
 * The shared nickname of each treasury (the nickname of its own address), for
 * lists that span treasuries. The treasury's address is never a signer of
 * itself, so no signer list is needed to accept it.
 */
export function useTreasuryNicknames(): (
	network: Network,
	treasury: Address,
) => string | null {
	const rows = useNicknameRows();
	const byTreasury = useMemo(() => {
		const out = new Map<string, string>();
		for (const r of rows) {
			if (r.address !== r.treasury) continue;
			const own = acceptNicknames([r], {
				network: r.network,
				treasury: r.treasury,
				signers: [],
			}).get(r.address);
			if (own) out.set(`${r.network}:${r.treasury}`, own.name);
		}
		return out;
	}, [rows]);
	return useCallback(
		(network, treasury) => byTreasury.get(`${network}:${treasury}`) ?? null,
		[byTreasury],
	);
}

/** Give or take away a nickname. Resolves with the relay's refusal, or null when it was done. */
export function useSetNickname(): (change: {
	readonly network: Network;
	readonly treasury: Address;
	readonly address: Address;
	readonly name: string | null;
}) => Promise<Issue | null> {
	const relay = useRelay();
	const queries = useQueryClient();
	const client = relay.client;
	const me = relay.wallet;
	return useCallback(
		async (change) => {
			if (!client || !me)
				return {
					code: "relay.signed_out",
					severity: "error",
					message: "Sign in to give a nickname.",
				};
			const r = await setNickname(client, me, change);
			if (r.issue) return r.issue;
			await queries.invalidateQueries({
				queryKey: ["relay", me, "nicknames"],
			});
			return null;
		},
		[client, me, queries],
	);
}
