import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Link } from "@tanstack/react-router";
import { LogOut, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAccount, useConnectors, useDisconnect } from "wagmi";
import { short } from "#/components/tools/multisig/AddressLine";
import { Button } from "#/components/ui/button";
import { NO_WALLET, walletInBrowser } from "#/lib/signerWallets";
import { cn } from "#/lib/utils";
import { useNetwork, useNetworkHydrated } from "#/store/networkStore";
import { useWalletBusy } from "#/store/walletBusyStore";
import { useSelfTreasury } from "../live/useSelfTreasury";
import { chainLabel } from "../model/chains";
import { othersSummary, RELAY_COPY } from "../model/relay/copy";
import { connectedWallet } from "../model/relay/identity";
import { selfTag } from "../model/selfTreasury";
import { useRelay } from "../relay/useRelay";
import { Help } from "./Help";
import { Btn, Tag } from "./kit";
import { Slow } from "./Slow";

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

/**
 * False once the page has looked and found no wallet in this browser: nothing
 * injected, none announced (EIP-6963), and not inside a Safe app. The picker
 * offers no QR code to a phone wallet (that would reach WalletConnect's
 * relay, see `signerWallets.ts`), so such a visitor is told what to do.
 */
export function useWalletFound(): boolean {
	// wagmi lists each wallet that announced itself as a connector of its own,
	// and renders this again when one announces itself late
	const announced = useConnectors().filter(
		(c) => c.type === "injected" && c.id !== "injected",
	).length;
	const mounted = useMounted();
	return mounted ? walletInBrowser(announced) : true;
}

/** Under a "Connect" button, when there is nothing to connect to. */
export function NoWalletNote({ className }: { className?: string }) {
	const found = useWalletFound();
	if (found) return null;
	return (
		<output className={cn("block text-xs text-warning", className)}>
			{NO_WALLET}
		</output>
	);
}

/** The connected wallet as it appears in the rail and the mobile bar. */
export function useShellWallet() {
	const account = useAccount();
	const { chainId, connector } = account;
	const { disconnect } = useDisconnect();
	const { openConnectModal } = useConnectModal();
	const mounted = useMounted();
	// the same definition of "connected" as the relay's (`connectedWallet`)
	const address = mounted ? connectedWallet(account) : null;
	const connected = address !== null;
	// with nothing to connect to, the picker would open empty: say why instead
	const connect = openConnectModal
		? () => {
				if (walletInBrowser()) openConnectModal();
				else toast.warning(NO_WALLET);
			}
		: undefined;
	return {
		mounted,
		connected,
		address,
		chainId: connected ? (chainId ?? null) : null,
		connectorName: connector?.name ?? null,
		connect,
		disconnect,
	};
}

/** "By signing in you agree to the Privacy Policy." */
export function SmallPrint({ className }: { className?: string }) {
	return (
		<span className={cn("text-xs text-subtle-foreground", className)}>
			{RELAY_COPY.smallPrintBefore}
			<Link to="/privacy" className="text-brand underline underline-offset-2">
				{RELAY_COPY.smallPrintLink}
			</Link>
			.
		</span>
	);
}

/**
 * Said under the wallet when it is itself a treasury on the header's network:
 * its own key cannot act for it there. The tag leads to that treasury's page,
 * where the account can follow it. One read per wallet and network.
 */
function SelfTag({ address }: { address: string }) {
	const network = useNetwork();
	const hydrated = useNetworkHydrated();
	const self = useSelfTreasury(network, address, hydrated);
	if (!self.policy) return null;
	return (
		<span className="flex items-center gap-1">
			<Link
				to="/multisig/t/$network/$address"
				params={{ network, address: address.toLowerCase() }}
				className="rounded no-underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
			>
				<Tag>{selfTag(self.policy)}</Tag>
			</Link>
			<Help k="treasuryAccount" />
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
		<>
			<WalletLine address={address} sub={sub} title={title} action={action} />
			<SelfTag address={address} />
		</>
	);
}

function WalletLine({
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
						className="block whitespace-nowrap font-mono text-[13px]"
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
 * The phone bar's one line: who is connected and in what state, with the
 * full box one tap away (`MobileBar`). Says no more than the box does.
 */
export function WalletSummary() {
	const w = useShellWallet();
	const relay = useRelay();
	const state = !w.mounted
		? "…"
		: relay.mode === "on"
			? relay.channel === "joined"
				? "signed in · live"
				: relay.channel === "down"
					? "signed in · reconnecting…"
					: "signed in"
			: relay.mode === "restoring"
				? "checking your session…"
				: relay.mode === "unreachable"
					? "can't reach the sharing service"
					: relay.mode === "signed-out"
						? w.connected
							? "not signed in"
							: "no wallet connected"
						: w.chainId !== null
							? `on ${chainLabel(w.chainId)}`
							: w.connected
								? "connected"
								: "no wallet connected";
	return (
		<span className="flex min-w-0 items-center gap-2">
			<Avatar className="size-5" />
			<span className="min-w-0 truncate text-[13px]">
				{w.address && (
					<span className="font-mono" title={w.address}>
						{short(w.address)}
						{" · "}
					</span>
				)}
				<span
					className={
						relay.mode === "unreachable"
							? "text-warning"
							: "text-subtle-foreground"
					}
				>
					{state}
				</span>
			</span>
		</span>
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
	// the section's own mark: a thin line in the avatar's colours across the top
	const box =
		"relative flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-3 shadow-[var(--shadow-card)] before:pointer-events-none before:absolute before:inset-x-3 before:-top-px before:h-0.5 before:rounded-full before:bg-gradient-to-r before:from-brand before:to-info before:opacity-80";
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
						<NoWalletNote />
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
				<OtherWallets />
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
				<Slow small>
					<p className="text-[13px] text-muted-foreground" aria-busy="true">
						Checking your session…
					</p>
				</Slow>
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

	// Signed out: the connected wallet is not signed in here, or no wallet is
	// connected. Other wallets may be; they are listed, and never used meanwhile.
	const parked = relay.others.length > 0;
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
				<b className="text-sm font-semibold">
					{parked ? "No wallet connected" : "Not signed in"}
				</b>
			)}
			<span className="text-[13px] text-muted-foreground">
				{parked && !w.connected
					? RELAY_COPY.connectOneOf
					: RELAY_COPY.signedOutRail}
			</span>
			<Btn variant="brand" disabled={busy} onClick={relay.signIn}>
				{relay.signingIn ? "Waiting for your wallet…" : RELAY_COPY.signInButton}
			</Btn>
			{problem}
			{!w.connected && <NoWalletNote />}
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
			<OtherWallets />
		</div>
	);
}

/**
 * The other wallets signed in in this browser, each with its own way out.
 * They are only listed: while another wallet is connected (or none), nothing
 * is read, sent or renewed for them.
 */
function OtherWallets() {
	const relay = useRelay();
	const w = useShellWallet();
	const n = relay.others.length;
	if (n === 0) return null;
	return (
		<details className="border-t border-border pt-2 text-xs">
			<summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
				{othersSummary(n, w.connected)}
			</summary>
			<ul className="mt-1.5 flex flex-col gap-0.5">
				{relay.others.map((a) => (
					<li key={a} className="flex items-center justify-between gap-2">
						<span className="font-mono text-[12px]" title={a}>
							{short(a)}
						</span>
						<Btn
							size="sm"
							variant="ghost"
							onClick={() => relay.signOutWallet(a)}
							aria-label={`Sign out ${a}`}
						>
							Sign out
						</Btn>
					</li>
				))}
			</ul>
			<p className="mt-1.5 text-subtle-foreground">{RELAY_COPY.othersHow}</p>
			{(n > 1 || relay.mode === "on") && (
				<Btn
					size="sm"
					variant="ghost"
					className="mt-1"
					onClick={relay.signOutAll}
				>
					{RELAY_COPY.signOutAll}
				</Btn>
			)}
		</details>
	);
}
