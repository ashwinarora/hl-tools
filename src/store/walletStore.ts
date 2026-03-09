import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface GeneratedWallet {
	privateKey: `0x${string}`;
	address: `0x${string}`;
}

interface WalletStore {
	wallets: GeneratedWallet[];
	addWallet: () => void;
	removeWallet: (address: `0x${string}`) => void;
}

export const useWalletStore = create<WalletStore>()(
	persist(
		(set) => ({
			wallets: [],
			addWallet: () => {
				const privateKey = generatePrivateKey();
				const account = privateKeyToAccount(privateKey);
				set((state) => ({
					wallets: [...state.wallets, { privateKey, address: account.address }],
				}));
			},
			removeWallet: (address) => {
				set((state) => ({
					wallets: state.wallets.filter((w) => w.address !== address),
				}));
			},
		}),
		{ name: "hl-generated-wallets" },
	),
);
