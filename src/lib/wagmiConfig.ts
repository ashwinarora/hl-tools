import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { arbitrum, mainnet } from "wagmi/chains";

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
