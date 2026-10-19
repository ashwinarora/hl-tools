import type { Address, Network } from "@hl-tools/core";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { shortAddress } from "./model/stage";
import { useTreasuryNicknames } from "./names/useNicknames";

/**
 * What a treasury is called on screen, in this order:
 *  1. its nickname, shared by its signers through the relay;
 *  2. a name this browser gave it before nicknames existed (it stays in this
 *     browser and is only offered as a starting value for the nickname);
 *  3. "Treasury 0x4f1c…a2d9".
 */
export function defaultTreasuryName(address: Address): string {
	return `Treasury ${shortAddress(address)}`;
}

/** For lists: names for many treasuries at once. */
export function useTreasuryNames(): (
	network: Network,
	address: Address,
) => string {
	const hydrated = usePrefsHydrated();
	const local = useMultisigPrefs((s) => s.names);
	const shared = useTreasuryNicknames();
	return (network, address) =>
		shared(network, address) ??
		((hydrated && local[treasuryKey(network, address)]) ||
			defaultTreasuryName(address));
}

/** One treasury's name, and the name this browser had for it (a suggestion for its nickname). */
export function useTreasuryName(network: Network, address: Address) {
	const hydrated = usePrefsHydrated();
	const local = useMultisigPrefs((s) => s.names[treasuryKey(network, address)]);
	const shared = useTreasuryNicknames()(network, address);
	return {
		name: shared ?? ((hydrated && local) || defaultTreasuryName(address)),
		/** The shared nickname, when the treasury has one. */
		nickname: shared,
		/** The name kept in this browser only; null when there is none. */
		local: hydrated ? (local ?? null) : null,
	};
}
