import type { Network } from "@hl-tools/core";
import { create } from "zustand";

/**
 * A quiet mark on the header's network switch: something is waiting on the
 * network that is not selected. The Multisig section sets it (signed in, a
 * proposal needs the wallet on the other network) and clears it when left.
 * It lives here, outside the section, so the header never imports relay code.
 */
interface NetworkHintState {
	pendingOn: Network | null;
	setPendingOn: (network: Network | null) => void;
}

export const useNetworkHint = create<NetworkHintState>()((set) => ({
	pendingOn: null,
	setPendingOn: (pendingOn) => set({ pendingOn }),
}));
