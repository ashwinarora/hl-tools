import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Link } from "@tanstack/react-router";
import { LogOut, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { short } from "#/components/tools/multisig/AddressLine";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { useWalletBusy } from "#/store/walletBusyStore";
import { chainLabel } from "../model/chains";
import { RELAY_COPY } from "../model/relay/copy";
import { useRelay } from "../relay/useRelay";
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

/** "By signing in you agree to the Privacy Policy." */
export function SmallPrint({ className }: { className?: string }) {
	return (
		<span className={cn("text-[11px] text-subtle-foreground", className)}>
			{RELAY_COPY.smallPrintBefore}
			<Link to="/privacy" className="text-brand underline underline-offset-2">
				{RELAY_COPY.smallPrintLink}
			</Link>
			.
		</span>
	);
}

function WalletRow({
	address,
	sub,
	title,
	action,
}: {
	address: string;
	sub: ReactNode;
	title?: string;
	action: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="flex min-w-0 items-center gap-2.5">
				<Avatar />
				<span className="min-w-0">
					<span
						className="block font-mono text-[13px]"
						title={title ?? address}
					>
						{short(address)}
					</span>
					<span className="block truncate text-xs text-subtle-foreground">
						{sub}
					</span>
				</span>
			</span>
			{action}
		</div>
	);
}

/**
 * The rail's identity box: the connected wallet and, when this build has a
 * relay, whether that wallet is signed in. Deliberately not RainbowKit's
 * stock button: that one resolves ENS names and balances over an Ethereum
 * RPC on every load, which nothing here needs. The wallet picker itself is
 * still RainbowKit's.
 */
export function WalletBox() {
	const w = useShellWallet();
	const relay = useRelay();
	const busy = useWalletBusy((b) => b.busy);
	const box =
		"flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-3 shadow-[var(--shadow-card)]";
	if (!w.mounted) {
		return (
			<div className={box}>
				<div className="h-[52px]" aria-hidden />
			</div>
		);
	}

	const chain =
		w.chainId !== null ? `on ${chainLabel(w.chainId)}` : "connected";
	const title = w.address
		? `${w.address}${w.connectorName ? ` · ${w.connectorName}` : ""}`
		: undefined;
	const disconnect = (
		<Button
			size="icon-sm"
			variant="ghost"
			onClick={() => w.disconnect()}
			aria-label="Disconnect the wallet"
			title="Disconnect the wallet"
		>
			<LogOut className="size-3.5" aria-hidden />
		</Button>
	);
	const connect = (label: string, variant: "brand" | "outline" = "brand") => (
		<Btn variant={variant} disabled={!w.connect} onClick={() => w.connect?.()}>
			<Wallet className="size-3.5" aria-hidden /> {label}
		</Btn>
	);
	const problem = relay.issue && (
		<p
			role="alert"
			className={cn(
				"text-xs",
				relay.issue.severity === "error" ? "text-danger" : "text-warning",
			)}
		>
			{relay.issue.message}
			{relay.issue.fix ? ` ${relay.issue.fix}` : ""}
		</p>
	);

	if (relay.mode === "off") {
		return (
			<div className={box}>
				{w.connected && w.address ? (
					<WalletRow
						address={w.address}
						sub={chain}
						title={title}
						action={disconnect}
					/>
				) : (
					<>
						<b className="text-sm font-semibold">No wallet connected</b>
						{connect("Connect wallet")}
					</>
				)}
			</div>
		);
	}

	if (relay.mode === "on" && w.address) {
		return (
			<div className={box}>
				<WalletRow
					address={w.address}
					// "live": this wallet's channel is joined, so changes arrive by themselves
					sub={
						relay.channel === "joined"
							? "signed in · live"
							: relay.channel === "down"
								? "signed in · reconnecting…"
								: "signed in"
					}
					title={title}
					action={
						<Btn size="sm" variant="ghost" onClick={relay.signOut}>
							Sign out
						</Btn>
					}
				/>
			</div>
		);
	}

	if (relay.mode === "suspended" && relay.sessionWallet) {
		return (
			<div className={box}>
				{w.connected && w.address ? (
					<WalletRow
						address={w.address}
						sub={chain}
						title={title}
						action={disconnect}
					/>
				) : null}
				<p className="text-[13px] text-muted-foreground">
					Signed in as{" "}
					<span
						className="font-mono text-foreground"
						title={relay.sessionWallet}
					>
						{short(relay.sessionWallet)}
					</span>
					{w.connected && w.address
						? ", but that is not the connected wallet. Nothing is read from or sent to the relay."
						: ". Connect that wallet to continue."}
				</p>
				{w.connected && w.address ? (
					<Btn variant="brand" disabled={busy} onClick={relay.signIn}>
						{relay.signingIn
							? "Waiting for your wallet…"
							: `Sign in as ${short(w.address)}`}
					</Btn>
				) : (
					connect("Connect wallet")
				)}
				<Btn size="sm" variant="ghost" onClick={relay.signOut}>
					Sign out {short(relay.sessionWallet)}
				</Btn>
				{problem}
				{w.connected && <SmallPrint />}
			</div>
		);
	}

	if (relay.mode === "restoring") {
		return (
			<div className={box}>
				{w.connected && w.address ? (
					<WalletRow
						address={w.address}
						sub={chain}
						title={title}
						action={disconnect}
					/>
				) : null}
				<p className="text-[13px] text-muted-foreground" aria-busy="true">
					Checking your session…
				</p>
			</div>
		);
	}

	if (relay.mode === "unreachable") {
		return (
			<div className={box}>
				{w.connected && w.address ? (
					<WalletRow
						address={w.address}
						sub={chain}
						title={title}
						action={disconnect}
					/>
				) : null}
				<p className="text-[13px] text-warning">{RELAY_COPY.unreachable}</p>
				<Btn size="sm" variant="outline" onClick={relay.retry}>
					Try again
				</Btn>
			</div>
		);
	}

	// signed out
	return (
		<div className={box}>
			{w.connected && w.address ? (
				<WalletRow
					address={w.address}
					sub="not signed in"
					title={title}
					action={disconnect}
				/>
			) : (
				<b className="text-sm font-semibold">Not signed in</b>
			)}
			<span className="text-[13px] text-muted-foreground">
				{RELAY_COPY.signedOutRail}
			</span>
			<Btn variant="brand" disabled={busy} onClick={relay.signIn}>
				{relay.signingIn ? "Waiting for your wallet…" : RELAY_COPY.signInButton}
			</Btn>
			{problem}
			<SmallPrint />
			{!w.connected && (
				<Btn
					size="sm"
					variant="ghost"
					disabled={!w.connect}
					onClick={() => w.connect?.()}
				>
					Connect a wallet without signing in
				</Btn>
			)}
		</div>
	);
}
