import type { Config } from "wagmi";

/** One per id, the first kept: it may be the one connected. */
export function uniqueById<T extends { readonly id: string }>(
	items: readonly T[],
): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}

const kept = new WeakSet<Config>();

/**
 * wagmi adds the wallets this browser announces (EIP-6963) again each time
 * its provider mounts, and recognises one it already holds only by an `rdns`
 * that its own connectors for those wallets do not carry (wagmi 2.19). The
 * signer and the faucet miner mount the provider whenever their section is
 * entered, so every return added another copy of every wallet to the picker.
 * Here a config keeps one connector per id, as wagmi's own first discovery
 * does. Idempotent: subscribes once per config.
 */
export function keepConnectorsUnique(config: Config): void {
	if (kept.has(config)) return;
	kept.add(config);
	const store = config._internal.connectors;
	store.subscribe((connectors) => {
		const unique = uniqueById(connectors);
		if (unique.length !== connectors.length) store.setState(unique);
	});
}
