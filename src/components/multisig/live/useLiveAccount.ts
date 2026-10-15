import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AccountTarget } from "#/components/tools/multisig/model";
import { LIVE_INITIAL, type LiveAccount } from "../model/live/account";
import { liveAccountStore } from "./hub";

/** What a screen follows besides the holdings. */
export interface LiveWants {
	/** Deposits, withdrawals and transfers. */
	readonly ledger?: boolean;
	/** The ledger and the fills, order history and funding. */
	readonly history?: boolean;
}

const never = () => () => {};
const initial = () => LIVE_INITIAL;

/**
 * What an account holds, pushed by Hyperliquid over one WebSocket for as long
 * as the calling screen is mounted. `ledger` adds deposits, withdrawals and
 * transfers; `history` adds those and the fills, order history and funding.
 * A screen asks for no more than it shows. The target comes from the page's
 * address, not from the relay, so the figures stay live when the relay is
 * unreachable.
 */
export function useLiveAccount(
	target: AccountTarget | null,
	opts: LiveWants = {},
): LiveAccount & { retry(): void } {
	const network = target?.network ?? null;
	const address = target?.address ?? null;
	const history = opts.history ?? false;
	const ledger = history || (opts.ledger ?? false);
	const store = useMemo(
		() => (network && address ? liveAccountStore(network, address) : null),
		[network, address],
	);
	useEffect(() => store?.acquire("holdings"), [store]);
	useEffect(
		() => (ledger ? store?.acquire("ledger") : undefined),
		[store, ledger],
	);
	useEffect(
		() => (history ? store?.acquire("trades") : undefined),
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
