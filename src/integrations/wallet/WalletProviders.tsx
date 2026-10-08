import {
	darkTheme,
	lightTheme,
	RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import { type ReactNode, useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { config } from "#/lib/wagmiConfig";

import "@rainbow-me/rainbowkit/styles.css";

function useMountedTheme(): "light" | "dark" {
	// Start from a fixed value so SSR and the first client render agree, then
	// follow the <html> class the theme script set.
	const [theme, setTheme] = useState<"light" | "dark">("dark");
	useEffect(() => {
		const read = () =>
			setTheme(
				document.documentElement.classList.contains("dark") ? "dark" : "light",
			);
		read();
		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, []);
	return theme;
}

/** Wallet stack, mounted only by the routes that sign: the faucet miner and the multisig signer. */
export default function WalletProviders({ children }: { children: ReactNode }) {
	const theme = useMountedTheme();
	return (
		<WagmiProvider config={config}>
			<RainbowKitProvider
				theme={
					theme === "dark"
						? darkTheme({ borderRadius: "small" })
						: lightTheme({ borderRadius: "small" })
				}
			>
				{children}
			</RainbowKitProvider>
		</WagmiProvider>
	);
}
