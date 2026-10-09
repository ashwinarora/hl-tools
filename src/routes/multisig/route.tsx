import { createFileRoute, Outlet } from "@tanstack/react-router";
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
 * WalletConnect. Every screen of the section renders inside the shell.
 */
function MultisigLayout() {
	return (
		<WalletProviders config={signerConfig}>
			<MultisigShell>
				<Outlet />
			</MultisigShell>
		</WalletProviders>
	);
}
