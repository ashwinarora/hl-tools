import { isNetwork, type Network } from "@hl-tools/core";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface NetworkState {
	network: Network;
	setNetwork: (network: Network) => void;
}

export const NETWORK_STORAGE_KEY = "hl-tools:network";

/**
 * Global network selection, persisted in localStorage. Tools read it when
 * they *start* a request and stamp the network on the result; a result is
 * never re-interpreted when this changes (see `useStaleNetwork`).
 */
export const useNetworkStore = create<NetworkState>()(
	persist(
		(set) => ({
			network: "mainnet",
			setNetwork: (network) => set({ network }),
		}),
		{
			name: NETWORK_STORAGE_KEY,
			storage: createJSONStorage(() => localStorage),
			partialize: (s) => ({ network: s.network }),
			// Rehydrated in the root layout after mount so SSR and the first
			// client render agree (no hydration mismatch).
			skipHydration: true,
			merge: (persisted, current) => {
				const p = persisted as Partial<NetworkState> | undefined;
				return {
					...current,
					network: isNetwork(p?.network) ? p.network : current.network,
				};
			},
		},
	),
);

export function useNetwork(): Network {
	return useNetworkStore((s) => s.network);
}

/**
 * True once the persisted network has been restored. Child effects run
 * before the root's rehydration effect, so anything that *sets* the network
 * on mount (e.g. a sample tied to a network) must wait for this.
 */
export function useNetworkHydrated(): boolean {
	// On the server localStorage is unavailable, so zustand attaches no
	// `persist` API at all; treat that as "not hydrated yet".
	const [hydrated, setHydrated] = useState(
		() => useNetworkStore.persist?.hasHydrated() ?? false,
	);
	useEffect(() => {
		const api = useNetworkStore.persist;
		if (!api) return;
		if (api.hasHydrated()) setHydrated(true);
		return api.onFinishHydration(() => setHydrated(true));
	}, []);
	return hydrated;
}

/** Pre-hydration script: mirrors the stored network onto <html data-network>. */
export const NETWORK_INIT_SCRIPT = `(function(){try{var v=JSON.parse(localStorage.getItem('${NETWORK_STORAGE_KEY}')||'null');var n=v&&v.state&&v.state.network;document.documentElement.setAttribute('data-network',n==='testnet'?'testnet':'mainnet')}catch(e){document.documentElement.setAttribute('data-network','mainnet')}})();`;
