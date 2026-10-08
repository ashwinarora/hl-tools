import { createFileRoute, Outlet } from "@tanstack/react-router";
import WalletProviders from "#/integrations/wallet/WalletProviders";
import { signerConfig } from "#/lib/signerWagmiConfig";

export const Route = createFileRoute("/multisig")({
	head: () => ({ meta: [{ title: "Multisig Signer — hl-tools" }] }),
	component: SignerLayout,
});

/**
 * The wallet stack is mounted here and nowhere above, so the read-only tools
 * (the Multisig Inspector included) never load wagmi, RainbowKit or
 * WalletConnect.
 */
function SignerLayout() {
	return (
		<WalletProviders config={signerConfig}>
			<Outlet />
		</WalletProviders>
	);
}
