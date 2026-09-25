import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WalletOrigin = "manual" | "auto";

export interface GeneratedWallet {
	privateKey: `0x${string}`;
	address: `0x${string}`;
	origin: WalletOrigin;
	createdAt: number;
}

interface WalletStore {
	wallets: GeneratedWallet[];
	addWallet: () => void;
	addAutoWallet: (privateKey: `0x${string}`, address: `0x${string}`) => void;
	removeWallet: (address: `0x${string}`) => void;
	removeIfEmpty: (
		address: `0x${string}`,
		balances: {
			mainnet: number | null;
			testnet: number | null;
		},
	) => void;
}

const EMPTY_THRESHOLD = 0.005;

export const useWalletStore = create<WalletStore>()(
	persist(
		(set) => ({
			wallets: [],
			addWallet: () => {
				const privateKey = generatePrivateKey();
				const account = privateKeyToAccount(privateKey);
				set((state) => ({
					wallets: [
						...state.wallets,
						{
							privateKey,
							address: account.address,
							origin: "manual",
							createdAt: Date.now(),
						},
					],
				}));
			},
			addAutoWallet: (privateKey, address) => {
				set((state) => {
					if (state.wallets.some((w) => w.address === address)) return state;
					return {
						wallets: [
							...state.wallets,
							{
								privateKey,
								address,
								origin: "auto",
								createdAt: Date.now(),
							},
						],
					};
				});
			},
			removeWallet: (address) => {
				set((state) => ({
					wallets: state.wallets.filter((w) => w.address !== address),
				}));
			},
			removeIfEmpty: (address, balances) => {
				const m = balances.mainnet;
				const t = balances.testnet;
				if (m == null || t == null) return;
				if (m >= EMPTY_THRESHOLD || t >= EMPTY_THRESHOLD) return;
				set((state) => ({
					wallets: state.wallets.filter((w) => w.address !== address),
				}));
			},
		}),
		{
			name: "hl-generated-wallets",
			version: 2,
			migrate: (persisted, version) => {
				if (!persisted || typeof persisted !== "object") return persisted;
				if (version >= 2) return persisted;
				const legacy = persisted as {
					wallets?: Array<{
						privateKey: `0x${string}`;
						address: `0x${string}`;
					}>;
				};
				return {
					...legacy,
					wallets: (legacy.wallets ?? []).map((w) => ({
						...w,
						origin: "manual" as const,
						createdAt: 0,
					})),
				};
			},
		},
	),
);
