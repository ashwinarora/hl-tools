import type { ReactNode } from "react";
import { ToolPage } from "#/components/hub/layout";
import { tool } from "#/lib/tools";
import { SignerCallout } from "./SignerCallout";
import { WalletBar } from "./WalletBar";

/**
 * Frame shared by the three signer screens: the tool header, the "this signs"
 * banner and the wallet button, then the screen.
 */
export function SignerPage({
	children,
	wallet,
}: {
	children: ReactNode;
	/** Shown next to the wallet button (the role pill on the proposal page). */
	wallet?: ReactNode;
}) {
	return (
		<ToolPage tool={tool("multisig-sign")}>
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<SignerCallout className="w-full lg:w-auto lg:max-w-2xl lg:flex-1" />
				<WalletBar>{wallet}</WalletBar>
			</div>
			{children}
		</ToolPage>
	);
}
