import type { Address, Network } from "@hl-tools/core";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { shortAddress } from "./model/stage";

/**
 * What a treasury is called on screen: the nickname this browser gave it, or
 * "Treasury 0x4f1c…a2d9". Nicknames are the reader's own and stay in this
 * browser; nobody else sees or sets them.
 */
export function defaultTreasuryName(address: Address): string {
	return `Treasury ${shortAddress(address)}`;
}

export function useTreasuryName(network: Network, address: Address) {
	const hydrated = usePrefsHydrated();
	const nickname = useMultisigPrefs(
		(s) => s.names[treasuryKey(network, address)],
	);
	const rename = useMultisigPrefs((s) => s.rename);
	return {
		name: (hydrated && nickname) || defaultTreasuryName(address),
		nickname: hydrated ? (nickname ?? null) : null,
		rename: (name: string) => rename(network, address, name),
	};
}

/** For lists: names for many treasuries at once. */
export function useTreasuryNames(): (
	network: Network,
	address: Address,
) => string {
	const hydrated = usePrefsHydrated();
	const names = useMultisigPrefs((s) => s.names);
	return (network, address) =>
		(hydrated && names[treasuryKey(network, address)]) ||
		defaultTreasuryName(address);
}
