import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import {
	arbitrum,
	arbitrumSepolia,
	hyperEvm,
	hyperliquidEvmTestnet,
	mainnet,
} from "wagmi/chains";

/**
 * One wallet configuration for the two sections that connect a wallet (the
 * faucet miner and the multisig signer); mounted only under their routes.
 *
 * HyperEVM (999 / 998) and Arbitrum Sepolia are here for the multisig signer:
 * a proposal names the EIP-712 chain its signers sign under, and a wallet can
 * only be asked to switch to a chain this config knows. The HyperEVM RPC URLs
 * are the ones `@hl-tools/core` uses (`networkConfig(n).evmRpcUrl`).
 */
export const config = getDefaultConfig({
	appName: "hl-tools",
	projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
	chains: [mainnet, arbitrum, hyperEvm, hyperliquidEvmTestnet, arbitrumSepolia],
	transports: {
		[mainnet.id]: http("https://ethereum-rpc.publicnode.com"),
		[arbitrum.id]: http(),
		[hyperEvm.id]: http("https://rpc.hyperliquid.xyz/evm"),
		[hyperliquidEvmTestnet.id]: http("https://rpc.hyperliquid-testnet.xyz/evm"),
		[arbitrumSepolia.id]: http(),
	},
	ssr: true,
});
