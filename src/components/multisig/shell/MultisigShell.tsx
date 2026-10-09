import type { Address, Network } from "@hl-tools/core";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Callout } from "#/components/hub/status";
import { tool, toolRuleSets, toolVerifiedAt } from "#/lib/tools";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { useNetworkHint } from "#/store/networkHintStore";
import { useNetwork } from "#/store/networkStore";
import { RELAY_COPY } from "../model/relay/copy";
import { countNeeds, countOpen } from "../model/relay/inbox";
import { shortAddress } from "../model/stage";
import { relayConfig } from "../relay/config";
import { useOpenProposals } from "../relay/openProposals";
import { useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { useTreasuryNames } from "../treasuryName";
import { Btn, Count, Tag } from "./kit";
import { Rail, RailHeading, RailLink } from "./Rail";
import { WalletBox } from "./WalletBox";

/**
 * The Multisig section's own frame inside the hub: the hub's top bar stays,
 * and below it a left panel (who you are, where you can go) next to the
 * screen. On a phone the panel becomes a bar above the screen. The same frame
 * serves every state: no relay, signed out, signed in.
 */
export function MultisigShell({ children }: { children: ReactNode }) {
	const relay = useRelay();
	return (
		<div className="page-wrap">
			<div className="grid grid-cols-1 items-start gap-4 pb-12 pt-4 min-[861px]:grid-cols-[252px_minmax(0,1fr)] min-[861px]:gap-7 min-[861px]:pb-16 min-[861px]:pt-6">
				<aside
					aria-label="Multisig navigation"
					className="sticky top-20 hidden flex-col gap-[18px] min-[861px]:flex"
				>
					<Rail
						foot={
							<RailLink to="/multisig/open">
								{relay.mode === "on"
									? "Open a file or link"
									: "Open or start a proposal"}
							</RailLink>
						}
					>
						{relay.mode === "on" && <RailNav />}
					</Rail>
				</aside>
				<main className="min-w-0">
					{relay.mode === "on" && <NetworkHint />}
					<MobileBar />
					<FirstUse />
					{children}
					<ShellFoot />
				</main>
			</div>
		</div>
	);
}

/** What the signed-in navigation shows, shared by the rail and the phone's switcher. */
function useNav() {
	const network = useNetwork();
	const relay = useRelay();
	const me = relay.wallet;
	const { rows, loading, issue } = useTreasuries();
	const { items } = useOpenProposals();
	const nameOf = useTreasuryNames();
	const hydrated = usePrefsHydrated();
	const hidden = useMultisigPrefs((s) => s.hidden);
	const seen = useMultisigPrefs((s) => s.seen);
	const isHidden = (n: Network, a: Address) =>
		hydrated && hidden.includes(treasuryKey(n, a));
	const visible = items.filter((p) => !isHidden(p.network, p.treasury));
	const treasuries = rows
		.filter((t) => t.network === network && !isHidden(t.network, t.address))
		.map((t) => ({
			...t,
			name: nameOf(t.network, t.address),
			needs: me ? countNeeds(visible, me, t.network, t.address) : 0,
			open: countOpen(visible, t.network, t.address),
			// added by someone else and never opened here: say so
			fresh:
				hydrated &&
				t.addedBy !== me &&
				!seen.includes(treasuryKey(t.network, t.address)),
		}));
	const other: Network = network === "mainnet" ? "testnet" : "mainnet";
	return {
		network,
		treasuries,
		loading,
		issue,
		needs: me ? countNeeds(visible, me, network) : 0,
		/** Something needs the wallet on the network that is not selected. */
		elsewhere: me && countNeeds(visible, me, other) > 0 ? other : null,
	};
}

/** Signed in: the inbox, then the wallet's treasuries on the header's network. */
function RailNav() {
	const nav = useNav();
	return (
		<>
			<nav className="flex flex-col gap-0.5">
				<RailLink
					to="/multisig"
					exact
					trailing={
						<Count n={nav.needs} quiet={nav.needs === 0} label="need you" />
					}
				>
					Needs you
				</RailLink>
			</nav>
			<div>
				<RailHeading>My treasuries</RailHeading>
				<nav className="flex flex-col gap-0.5">
					{nav.treasuries.map((t) => (
						<RailLink
							key={`${t.network}:${t.address}`}
							to="/multisig/t/$network/$address"
							params={{ network: t.network, address: t.address }}
							sub={`${shortAddress(t.address)} · ${
								t.frozenAt === null
									? `${t.threshold} of ${t.signers.length}`
									: "no longer a multi-sig"
							}`}
							trailing={
								t.needs > 0 ? (
									<Count n={t.needs} label="need you" />
								) : t.fresh ? (
									<Tag tone="info">new</Tag>
								) : t.open > 0 ? (
									<Count n={t.open} quiet label="pending" />
								) : null
							}
						>
							{t.name}
						</RailLink>
					))}
					{nav.treasuries.length === 0 && (
						<span className="px-2.5 py-1.5 text-[13px] text-muted-foreground">
							{nav.loading
								? "Reading…"
								: nav.issue
									? nav.issue.message
									: `None on ${nav.network} yet.`}
						</span>
					)}
					<RailLink to="/multisig/add">+ Add a treasury</RailLink>
				</nav>
			</div>
		</>
	);
}

/** The phone's stand-in for the rail: one control to move between the inbox and the treasuries. */
function MobileSwitcher() {
	const nav = useNav();
	const navigate = useNavigate();
	const path = useRouterState({ select: (s) => s.location.pathname });
	const here =
		nav.treasuries.find((t) => path === `/multisig/t/${t.network}/${t.address}`)
			?.address ??
		(path === "/multisig/add"
			? "__add"
			: path === "/multisig"
				? ""
				: "__other");
	return (
		<select
			aria-label="Go to"
			value={here}
			onChange={(e) => {
				const v = e.target.value;
				if (v === "__add") void navigate({ to: "/multisig/add" });
				else if (v === "") void navigate({ to: "/multisig" });
				else if (v !== "__other")
					void navigate({
						to: "/multisig/t/$network/$address",
						params: { network: nav.network, address: v },
					});
			}}
			className="h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface px-2.5 text-sm"
		>
			{here === "__other" && <option value="__other">Go to…</option>}
			<option value="">Needs you ({nav.needs})</option>
			{nav.treasuries.map((t) => (
				<option key={t.address} value={t.address}>
					{t.name} ·{" "}
					{t.frozenAt === null
						? `${t.threshold} of ${t.signers.length}`
						: "no longer a multi-sig"}
					{t.needs > 0 ? ` · ${t.needs} need you` : ""}
				</option>
			))}
			<option value="__add">+ Add a treasury</option>
		</select>
	);
}

/** Tells the header's network switch when the other network has something for this wallet. */
function NetworkHint() {
	const nav = useNav();
	const setPendingOn = useNetworkHint((s) => s.setPendingOn);
	useEffect(() => {
		setPendingOn(nav.elsewhere);
		return () => setPendingOn(null);
	}, [nav.elsewhere, setPendingOn]);
	return null;
}

/** Below the rail's breakpoint the identity box sits above the screen, with the way to links and files. */
function MobileBar() {
	const relay = useRelay();
	return (
		<div className="mb-4 flex flex-col gap-2 min-[861px]:hidden">
			<WalletBox />
			{relay.mode === "on" && <MobileSwitcher />}
			<Link
				to="/multisig/open"
				className="self-end text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
			>
				Open or start a proposal
			</Link>
		</div>
	);
}

/**
 * The full "this signs and sends" warning, once. After that every page keeps
 * a small "Signs & sends" tag and the buttons that open the wallet say what
 * to check there.
 */
function FirstUse() {
	const hydrated = usePrefsHydrated();
	const seen = useMultisigPrefs((s) => s.warningSeen);
	const dismiss = useMultisigPrefs((s) => s.dismissWarning);
	if (!hydrated || seen) return null;
	return (
		<Callout
			tone="warning"
			title={RELAY_COPY.firstUseTitle}
			className="mb-4"
			action={
				<Btn size="sm" variant="outline" onClick={dismiss}>
					Got it
				</Btn>
			}
		>
			{relayConfig()
				? RELAY_COPY.firstUseBody
				: "Proposals are signed with your wallet and submitted to Hyperliquid from this browser. No server holds anything: a proposal travels as a link or a file, and every signature is verified locally before anything is sent. Rehearse on testnet first."}
		</Callout>
	);
}

/** What every tool page of the hub states: when its rules were last checked, and against what. */
function ShellFoot() {
	const t = tool("multisig-sign");
	const verified = toolVerifiedAt(t);
	const rules = toolRuleSets(t);
	return (
		<footer className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
			<span className="inline-flex items-center gap-1.5">
				<ShieldCheck className="size-3.5 text-success" aria-hidden />
				Rules last verified against protocol docs:{" "}
				<Link
					to="/changes"
					className="font-mono text-foreground hover:underline"
				>
					{verified ?? "—"}
				</Link>
			</span>
			<a
				href={t.primarySource.url}
				target="_blank"
				rel="noreferrer"
				className="inline-flex items-center gap-1 hover:text-foreground"
			>
				Source: {t.primarySource.label}
				<ArrowUpRight className="size-3" aria-hidden />
			</a>
			<span className="font-mono text-2xs text-subtle-foreground">
				rules: {rules.map((r) => `${r.id}@${r.version}`).join(" · ")}
			</span>
			{relayConfig() && (
				<Link to="/privacy" className="hover:text-foreground hover:underline">
					{RELAY_COPY.smallPrintLink}
				</Link>
			)}
		</footer>
	);
}
