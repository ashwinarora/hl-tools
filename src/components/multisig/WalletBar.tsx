import { useConnectModal } from "@rainbow-me/rainbowkit";
import { LogOut, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { short } from "#/components/tools/multisig/AddressLine";
import { Button } from "#/components/ui/button";
import { chainLabel } from "./model/chains";

/**
 * The signer's wallet control: connect, or the connected account, the chain
 * the wallet is on and a way out. Deliberately not RainbowKit's stock button:
 * that one resolves ENS names and balances over an Ethereum RPC on every
 * load, which nothing here needs. The wallet picker itself is still
 * RainbowKit's.
 */
export function WalletBar({ children }: { children?: ReactNode }) {
	const { address, chainId, isConnected, connector } = useAccount();
	const { disconnect } = useDisconnect();
	const { openConnectModal } = useConnectModal();
	// the server cannot know the wallet; agree with it on the first client render
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	if (!mounted || !isConnected || !address) {
		return (
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant="brand"
					disabled={!mounted || !openConnectModal}
					onClick={() => openConnectModal?.()}
				>
					<Wallet className="size-3.5" aria-hidden /> Connect wallet
				</Button>
			</div>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			{children}
			<span
				className="inline-flex h-8 items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 text-sm"
				title={`${address}${connector ? ` · ${connector.name}` : ""}`}
			>
				<Wallet className="size-3.5 text-muted-foreground" aria-hidden />
				<span className="font-mono text-[13px]">
					{short(address.toLowerCase())}
				</span>
				{chainId !== undefined && (
					<span className="text-xs text-muted-foreground">
						on {chainLabel(chainId)}
					</span>
				)}
			</span>
			<Button
				size="icon-sm"
				variant="ghost"
				onClick={() => disconnect()}
				aria-label="Disconnect the wallet"
				title="Disconnect"
			>
				<LogOut className="size-3.5" aria-hidden />
			</Button>
		</div>
	);
}
