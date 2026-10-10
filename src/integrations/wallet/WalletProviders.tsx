import {
	darkTheme,
	lightTheme,
	RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import { type ReactNode, useEffect, useState } from "react";
import { type Config, WagmiProvider } from "wagmi";

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

/**
 * Wallet stack, mounted only by the routes that sign: the faucet miner and the
 * multisig signer. Each passes its own wagmi configuration, so neither section
 * creates the other's connectors.
 */
export default function WalletProviders({
	config,
	children,
}: {
	config: Config;
	children: ReactNode;
}) {
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
