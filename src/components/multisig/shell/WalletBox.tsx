import { useConnectModal } from "@rainbow-me/rainbowkit";
import { LogOut, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { short } from "#/components/tools/multisig/AddressLine";
import { Button } from "#/components/ui/button";
import { chainLabel } from "../model/chains";
import { Btn } from "./kit";

/** True after the first client render: the server cannot know the wallet. */
export function useMounted(): boolean {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return mounted;
}

export function Avatar({ className = "size-7" }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={`${className} shrink-0 rounded-full bg-gradient-to-br from-brand to-info`}
		/>
	);
}

/** The connected wallet as it appears in the rail and the mobile bar. */
export function useShellWallet() {
	const { address, chainId, isConnected, connector } = useAccount();
	const { disconnect } = useDisconnect();
	const { openConnectModal } = useConnectModal();
	const mounted = useMounted();
	const connected = mounted && isConnected && !!address;
	return {
		mounted,
		connected,
		address: connected ? (address.toLowerCase() as `0x${string}`) : null,
		chainId: connected ? (chainId ?? null) : null,
		connectorName: connector?.name ?? null,
		connect: openConnectModal,
		disconnect,
	};
}

/**
 * The rail's identity box. Deliberately not RainbowKit's stock button: that
 * one resolves ENS names and balances over an Ethereum RPC on every load,
 * which nothing here needs. The wallet picker itself is still RainbowKit's.
 * `children` is what the relay adds below the wallet line (sign-in, session).
 */
export function WalletBox({ children }: { children?: ReactNode }) {
	const w = useShellWallet();
	return (
		<div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
			{!w.mounted ? (
				<div className="h-[52px]" aria-hidden />
			) : !w.connected || !w.address ? (
				<>
					<b className="text-sm font-semibold">No wallet connected</b>
					<Btn
						variant="brand"
						disabled={!w.connect}
						onClick={() => w.connect?.()}
					>
						<Wallet className="size-3.5" aria-hidden /> Connect wallet
					</Btn>
				</>
			) : (
				<div className="flex items-center justify-between gap-2">
					<span className="flex min-w-0 items-center gap-2.5">
						<Avatar />
						<span className="min-w-0">
							<span
								className="block font-mono text-[13px]"
								title={`${w.address}${w.connectorName ? ` · ${w.connectorName}` : ""}`}
							>
								{short(w.address)}
							</span>
							<span className="block truncate text-xs text-subtle-foreground">
								{w.chainId !== null
									? `on ${chainLabel(w.chainId)}`
									: "connected"}
							</span>
						</span>
					</span>
					<Button
						size="icon-sm"
						variant="ghost"
						onClick={() => w.disconnect()}
						aria-label="Disconnect the wallet"
						title="Disconnect the wallet"
					>
						<LogOut className="size-3.5" aria-hidden />
					</Button>
				</div>
			)}
			{w.mounted && children}
		</div>
	);
}
