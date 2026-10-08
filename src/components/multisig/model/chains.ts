/**
 * The EIP-712 chain a proposal's signers sign under. The chain never compares
 * `signatureChainId` with the network (lab script 18), but the id sits inside
 * the signed action, so it is fixed when the proposal is created and every
 * signer's wallet must be on that chain. HyperEVM is the default: a wallet
 * already there never switches.
 */
import type { Hex, Network } from "@hl-tools/core";
import type { Chain } from "viem";
import {
	arbitrum,
	arbitrumSepolia,
	hyperEvm,
	hyperliquidEvmTestnet,
} from "viem/chains";

export type InnerChain = "hyperevm" | "arbitrum";

export interface ChainChoice {
	readonly choice: InnerChain;
	readonly hex: Hex;
	readonly id: number;
	readonly label: string;
	readonly chain: Chain;
}

export const INNER_CHAINS: {
	readonly [N in Network]: { readonly [C in InnerChain]: ChainChoice };
} = {
	mainnet: {
		hyperevm: {
			choice: "hyperevm",
			hex: "0x3e7",
			id: 999,
			label: "HyperEVM",
			chain: hyperEvm,
		},
		arbitrum: {
			choice: "arbitrum",
			hex: "0xa4b1",
			id: 42161,
			label: "Arbitrum One",
			chain: arbitrum,
		},
	},
	testnet: {
		hyperevm: {
			choice: "hyperevm",
			hex: "0x3e6",
			id: 998,
			label: "HyperEVM testnet",
			chain: hyperliquidEvmTestnet,
		},
		arbitrum: {
			choice: "arbitrum",
			hex: "0x66eee",
			id: 421614,
			label: "Arbitrum Sepolia",
			chain: arbitrumSepolia,
		},
	},
};

/** Every chain a proposal made here can ask a wallet to sign under. */
export const SIGNER_CHAINS: readonly ChainChoice[] = [
	INNER_CHAINS.mainnet.hyperevm,
	INNER_CHAINS.testnet.hyperevm,
	INNER_CHAINS.mainnet.arbitrum,
	INNER_CHAINS.testnet.arbitrum,
];

export function innerChain(network: Network, choice: InnerChain): ChainChoice {
	return INNER_CHAINS[network][choice];
}

/** `"0x3e6"` → 998. Null when it is not a positive, safe hex integer. */
export function chainIdToNumber(hex: unknown): number | null {
	if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
	const n = Number.parseInt(hex.slice(2), 16);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The chain this page can ask a wallet to switch to, if the id is one of ours. */
export function knownChain(id: number): ChainChoice | null {
	return SIGNER_CHAINS.find((c) => c.id === id) ?? null;
}

export function chainLabel(id: number): string {
	const known = knownChain(id);
	return known ? `${known.label} (${id})` : `chain ${id}`;
}

/** Which of the two offered choices a stored chain id is, on that network. */
export function chainChoiceFor(
	hex: string,
	network: Network,
): InnerChain | null {
	const lower = hex.toLowerCase();
	const pair = INNER_CHAINS[network];
	if (pair.hyperevm.hex === lower) return "hyperevm";
	if (pair.arbitrum.hex === lower) return "arbitrum";
	return null;
}
