import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SECTION_TITLE } from "#/components/multisig/model/relay/inbox";
import { RelayProvider } from "#/components/multisig/relay/RelayProvider";
import { MultisigShell } from "#/components/multisig/shell/MultisigShell";
import { NotHere } from "#/components/multisig/shell/NotHere";
import WalletProviders from "#/integrations/wallet/WalletProviders";
import { NOINDEX } from "#/lib/pages";
import { signerConfig } from "#/lib/signerWagmiConfig";

export const Route = createFileRoute("/multisig")({
	// a treasury, a proposal or a form is one visitor's state: out of search,
	// unless the page is an entry page (`pageHead` undoes this)
	head: () => ({ meta: [{ title: SECTION_TITLE }, NOINDEX] }),
	component: MultisigLayout,
	// an unknown address under /multisig keeps the section's frame and says so
	notFoundComponent: NotHere,
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
