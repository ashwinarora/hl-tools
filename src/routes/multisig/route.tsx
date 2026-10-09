import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RelayProvider } from "#/components/multisig/relay/RelayProvider";
import { MultisigShell } from "#/components/multisig/shell/MultisigShell";
import WalletProviders from "#/integrations/wallet/WalletProviders";
import { signerConfig } from "#/lib/signerWagmiConfig";

export const Route = createFileRoute("/multisig")({
	head: () => ({ meta: [{ title: "Multisig — hl-tools" }] }),
	component: MultisigLayout,
});

/**
 * The wallet stack is mounted here and nowhere above, so the read-only tools
 * (the Multisig Inspector included) never load wagmi, RainbowKit or
 * WalletConnect. The relay session lives here too, and ends its background
 * work when the section is left. Every screen renders inside the shell.
 */
function MultisigLayout() {
	return (
		<WalletProviders config={signerConfig}>
			<RelayProvider>
				<MultisigShell>
					<Outlet />
				</MultisigShell>
			</RelayProvider>
		</WalletProviders>
	);
}
