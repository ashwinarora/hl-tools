import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrum, mainnet } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "hl-tools",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [mainnet, arbitrum],
  ssr: true,
});
