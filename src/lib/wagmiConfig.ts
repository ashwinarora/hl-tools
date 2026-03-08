import { createAppKit } from "@reown/appkit/react";
import { arbitrum, mainnet } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;

const networks: [typeof mainnet, typeof arbitrum] = [mainnet, arbitrum];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
});

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: "hl-tools",
    description: "hl-tools",
    url: typeof window !== "undefined" ? window.location.origin : "",
    icons: [],
  },
});
