import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { arbitrum, mainnet } from "wagmi/chains";

/**
 * The faucet miner's wallet configuration, mounted only under `/faucet-miner`.
 * The multisig signer has its own (`signerWagmiConfig.ts`): it needs other
 * chains and must not load RainbowKit's generic WalletConnect modal.
 */
export const config = getDefaultConfig({
	appName: "hl-tools",
	projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
	chains: [mainnet, arbitrum],
	transports: {
		[mainnet.id]: http("https://ethereum-rpc.publicnode.com"),
		[arbitrum.id]: http(),
	},
	ssr: true,
});
