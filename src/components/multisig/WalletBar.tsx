import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";

/**
 * The wallet button (connect, account, current chain) with an optional note
 * beside it, e.g. the wallet's role for the proposal on screen.
 */
export function WalletBar({ children }: { children?: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			{children}
			<ConnectButton
				showBalance={false}
				chainStatus={{ smallScreen: "icon", largeScreen: "full" }}
				accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
			/>
		</div>
	);
}
