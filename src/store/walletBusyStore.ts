import { create } from "zustand";

/**
 * One wallet prompt at a time, across the whole Multisig section. The sign-in
 * button in the rail and the sign button on the page are different
 * components; without a shared flag a second click would queue a second
 * popup behind the first.
 */
interface WalletBusyState {
	busy: boolean;
	/** Claims the wallet; false when a prompt is already open. */
	begin: () => boolean;
	end: () => void;
}

export const useWalletBusy = create<WalletBusyState>()((set, get) => ({
	busy: false,
	begin: () => {
		if (get().busy) return false;
		set({ busy: true });
		return true;
	},
	end: () => set({ busy: false }),
}));
