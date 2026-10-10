import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AccountTarget } from "#/components/tools/multisig/model";
import { LIVE_INITIAL, type LiveAccount } from "../model/live/account";
import { liveAccountStore } from "./hub";

const never = () => () => {};
const initial = () => LIVE_INITIAL;

/**
 * What an account holds, pushed by Hyperliquid over one WebSocket for as long
 * as the calling screen is mounted. `history` adds the ledger, fills, order
 * history and funding. The target comes from the page's address, not from the
 * relay, so the figures stay live when the relay is unreachable.
 */
export function useLiveAccount(
	target: AccountTarget | null,
	opts: { history?: boolean } = {},
): LiveAccount & { retry(): void } {
	const network = target?.network ?? null;
	const address = target?.address ?? null;
	const history = opts.history ?? false;
	const store = useMemo(
		() => (network && address ? liveAccountStore(network, address) : null),
		[network, address],
	);
	useEffect(() => store?.acquire("holdings"), [store]);
	useEffect(
		() => (history ? store?.acquire("history") : undefined),
		[store, history],
	);
	const snapshot = useSyncExternalStore(
		store?.subscribe ?? never,
		store?.getSnapshot ?? initial,
		initial,
	);
	return useMemo(
		() => ({ ...snapshot, retry: () => store?.retry() }),
		[snapshot, store],
	);
}
