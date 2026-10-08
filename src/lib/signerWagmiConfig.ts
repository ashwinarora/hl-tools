import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createStorage, custom, http, noopStorage } from "wagmi";
import {
	arbitrum,
	arbitrumSepolia,
	hyperEvm,
	hyperliquidEvmTestnet,
	mainnet,
} from "wagmi/chains";
import { SIGNER_WALLET_GROUPS } from "./signerWallets";

/**
 * The multisig signer never reads Ethereum. RainbowKit still resolves an ENS
 * name for the connected account on chain 1 whenever that chain is configured,
 * which would send every signer's address to a third-party RPC. Chain 1 stays
 * configured (so connecting does not move a wallet that is on Ethereum), with
 * a transport that answers locally instead of calling out.
 */
const noEthereumRpc = custom(
	{
		async request() {
			throw new Error("The multisig signer makes no Ethereum RPC calls.");
		},
	},
	{ retryCount: 0 },
);

/**
 * The multisig signer's wallet configuration, mounted only under `/multisig`.
 *
 * Chains: the ones a proposal can name as the EIP-712 chain its signers sign
 * under (HyperEVM 999 / 998, Arbitrum One / Sepolia; a wallet can only be
 * asked to switch to a chain this config knows), plus Ethereum.
 *
 * Wallets: `SIGNER_WALLET_GROUPS`, RainbowKit's default list without the
 * generic "WalletConnect" entry, whose modal reports the page URL to a third
 * party (see `signerWallets.ts`). Installed wallets are still detected.
 *
 * Storage: its own key, so the two sections that connect a wallet keep
 * separate connection state.
 */
export const signerConfig = getDefaultConfig({
	appName: "hl-tools",
	projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
	wallets: SIGNER_WALLET_GROUPS,
	chains: [mainnet, arbitrum, hyperEvm, hyperliquidEvmTestnet, arbitrumSepolia],
	transports: {
		[mainnet.id]: noEthereumRpc,
		[arbitrum.id]: http(),
		[hyperEvm.id]: http("https://rpc.hyperliquid.xyz/evm"),
		[hyperliquidEvmTestnet.id]: http("https://rpc.hyperliquid-testnet.xyz/evm"),
		[arbitrumSepolia.id]: http(),
	},
	storage: createStorage({
		key: "hl-tools.multisig",
		storage:
			typeof window !== "undefined" && window.localStorage
				? window.localStorage
				: noopStorage,
	}),
	ssr: true,
});
