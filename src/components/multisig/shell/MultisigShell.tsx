import type { Address, Network } from "@hl-tools/core";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { MULTISIG_WRAP } from "#/components/Header";
import { Callout } from "#/components/hub/status";
import { tool, toolRuleSets, toolVerifiedAt } from "#/lib/tools";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { useNetworkHint } from "#/store/networkHintStore";
import { useNetwork } from "#/store/networkStore";
import { AwayKeeper } from "../away/AwayKeeper";
import { useAway } from "../away/useAway";
import { CREATE } from "../model/create";
import { GLOSSARY_TITLE } from "../model/guide";
import { RELAY_COPY } from "../model/relay/copy";
import {
	countNeeds,
	countOpen,
	SECTION_TITLE,
	tabTitle,
} from "../model/relay/inbox";
import { shortAddress } from "../model/stage";
import { relayConfig } from "../relay/config";
import { useOpenProposals } from "../relay/openProposals";
import { useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { useTreasuryNames } from "../treasuryName";
import { Btn, Count, Tag } from "./kit";
import { Rail, RailHeading, RailLink, SectionMark } from "./Rail";
import { BelowTitleProvider } from "./ShellPage";
import { useStickyTop } from "./useStickyTop";
import { WalletBox, WalletSummary } from "./WalletBox";

/**
 * The Multisig section's own frame inside the hub: the hub's top bar stays,
 * and below it a left panel (who you are, where you can go) next to the
 * screen. On a phone the panel becomes a bar above the screen. The same frame
 * serves every state: no relay, signed out, signed in.
 */
export function MultisigShell({ children }: { children: ReactNode }) {
	const relay = useRelay();
	// every way into the wizard names the network it is for
	const network = useNetwork();
	const rail = useStickyTop<HTMLElement>();
	return (
		<div className={MULTISIG_WRAP}>
			{/* Wider than the hub's pages: the rail stays slim, the screen takes the rest. */}
			<div className="grid grid-cols-1 items-start gap-4 pb-12 pt-4 min-[861px]:grid-cols-[248px_minmax(0,1fr)] min-[861px]:gap-7 min-[861px]:pb-16 min-[861px]:pt-6 xl:gap-8">
				{/* The rail stays in view under the site header while it fits the window; a longer one scrolls with the page. */}
				<aside
					ref={rail.ref}
					style={rail.style}
					aria-label="Multisig navigation"
					className="sticky hidden flex-col gap-4 min-[861px]:flex"
				>
					{/* The site's "Skip to content" lands in front of this panel. A keyboard
					    user then meets this first, and is past the panel in one more press. */}
					<a
						href="#multisig-main"
						className="sr-only focus:not-sr-only focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-brand"
					>
						Skip the Multisig navigation
					</a>
					<Rail
						foot={
							<>
								<RailLink to="/multisig/open">
									{relay.mode === "on"
										? "Open a file or link"
										: "Open or start a proposal"}
								</RailLink>
								{/* with a relay the wizard is reached from the signed-in list */}
								{relay.mode === "off" && (
									<RailLink to="/multisig/create" search={{ network }}>
										{CREATE.title}
									</RailLink>
								)}
							</>
						}
					>
						{relay.mode === "on" && <RailNav />}
					</Rail>
				</aside>
				<main id="multisig-main" tabIndex={-1} className="min-w-0 outline-none">
					<PhoneBar />
					{relay.mode === "on" && <NetworkHint />}
					{relay.mode === "on" && <AwayKeeper />}
					{relay.mode === "on" && <TitleCount />}
					<BelowTitleProvider
						value={
							<>
								<MobileBar />
								<FirstUse />
							</>
						}
					>
						{children}
					</BelowTitleProvider>
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
	const away = useAway("none");
	const unread = (n: Network, a: Address) =>
		away.groups.some((g) => g.network === n && g.treasury === a);
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
			// something finished or changed here since the signer's last "Got it"
			unread: unread(t.network, t.address),
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
		unread: away.groups.length > 0,
		/** Something needs the wallet on the network that is not selected. */
		elsewhere: me && countNeeds(visible, me, other) > 0 ? other : null,
		other,
		/** Treasuries on the network that is not selected: an empty list says where they are. */
		onOther: rows.filter(
			(t) => t.network === other && !isHidden(t.network, t.address),
		).length,
	};
}

/** The small mark next to a destination where something changed since the signer's last "Got it". */
function UnreadDot() {
	return (
		<span
			title={RELAY_COPY.awayDot}
			className="size-2 shrink-0 rounded-full bg-info"
		>
			<span className="sr-only">{RELAY_COPY.awayDot}</span>
		</span>
	);
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
						<>
							{nav.unread && <UnreadDot />}
							<Count n={nav.needs} quiet={nav.needs === 0} label="need you" />
						</>
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
							// the address and the threshold each whole: the second wraps rather than being cut
							sub={
								<>
									<span className="whitespace-nowrap">
										{shortAddress(t.address)} ·
									</span>{" "}
									<span className="whitespace-nowrap">
										{t.frozenAt === null
											? `${t.threshold} of ${t.signers.length}`
											: "no longer a multi-sig"}
									</span>
								</>
							}
							trailing={
								<>
									{t.unread && <UnreadDot />}
									{t.needs > 0 ? (
										<Count n={t.needs} label="need you" />
									) : t.fresh ? (
										<Tag tone="info">new</Tag>
									) : t.open > 0 ? (
										<Count n={t.open} quiet label="pending" />
									) : null}
								</>
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
									: nav.onOther > 0
										? `None on ${nav.network} yet. ${nav.onOther} on ${nav.other}.`
										: `None on ${nav.network} yet.`}
						</span>
					)}
					<RailLink to="/multisig/create" search={{ network: nav.network }}>
						+ {CREATE.title}
					</RailLink>
					<RailLink to="/multisig/add">+ {RELAY_COPY.addExisting}</RailLink>
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
			: path === "/multisig/create"
				? "__create"
				: path === "/multisig"
					? ""
					: "__other");
	return (
		<select
			name="multisig-go-to"
			aria-label="Go to"
			value={here}
			onChange={(e) => {
				const v = e.target.value;
				if (v === "__add") void navigate({ to: "/multisig/add" });
				else if (v === "__create")
					void navigate({
						to: "/multisig/create",
						search: { network: nav.network },
					});
				else if (v === "") void navigate({ to: "/multisig" });
				else if (v !== "__other")
					void navigate({
						to: "/multisig/t/$network/$address",
						params: { network: nav.network, address: v },
					});
			}}
			className="h-11 w-full min-w-0 rounded-md border border-border-strong bg-surface px-2.5 text-sm sm:h-9"
		>
			{here === "__other" && <option value="__other">Go to…</option>}
			<option value="">
				Needs you ({nav.needs}){nav.unread ? " · something changed" : ""}
			</option>
			{nav.treasuries.map((t) => (
				<option key={t.address} value={t.address}>
					{t.name} ·{" "}
					{t.frozenAt === null
						? `${t.threshold} of ${t.signers.length}`
						: "no longer a multi-sig"}
					{t.needs > 0 ? ` · ${t.needs} need you` : ""}
					{t.unread ? " · something changed" : ""}
				</option>
			))}
			<option value="__create">+ {CREATE.title}</option>
			<option value="__add">+ {RELAY_COPY.addExisting}</option>
		</select>
	);
}

/**
 * On a phone, above everything else in the section: its mark and name, so
 * the reader knows where they are, and what needs them, one tap away. The
 * wallet bar under the page's title has the rest of the rail.
 */
function PhoneBar() {
	const relay = useRelay();
	return (
		<div className="mb-3 flex min-h-11 items-center justify-between gap-3 border-b border-border min-[861px]:hidden">
			<SectionMark className="min-h-11 self-center" />
			{relay.mode === "on" && <PhoneNeedsYou />}
		</div>
	);
}

const phoneLink =
	"inline-flex min-h-11 items-center gap-2 rounded-md px-1.5 text-[13px] font-medium no-underline hover:text-foreground";

function PhoneNeedsYou() {
	const nav = useNav();
	return (
		<Link
			to="/multisig"
			activeOptions={{ exact: true }}
			className={phoneLink}
			activeProps={{ className: "text-foreground", "aria-current": "page" }}
			inactiveProps={{ className: "text-muted-foreground" }}
		>
			Needs you
			{nav.unread && <UnreadDot />}
			<Count n={nav.needs} quiet={nav.needs === 0} label="need you" />
		</Link>
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

/**
 * Puts what needs the signer into the browser tab's title, "(3) Multisig —
 * hl-tools", so a tab in the background says there is something to do. No
 * notification is sent anywhere. The plain title returns when the count is
 * zero, when the signer signs out, and (the router's doing) outside the section.
 */
function TitleCount() {
	const nav = useNav();
	const path = useRouterState({ select: (s) => s.location.pathname });
	// biome-ignore lint/correctness/useExhaustiveDependencies: `path` re-applies the title after the router rewrote it on navigation
	useEffect(() => {
		document.title = tabTitle(nav.needs);
	}, [nav.needs, path]);
	useEffect(
		() => () => {
			// still inside the section (signed out, wallet switched): back to the plain title
			if (window.location.pathname.startsWith("/multisig"))
				document.title = SECTION_TITLE;
		},
		[],
	);
	return null;
}

/**
 * Below the rail's breakpoint, one line under the page's title: who is
 * connected and in what state. The rail's contents (the wallet box, the way
 * to every treasury, links and files) are behind "Menu", which closes again
 * when the page changes.
 */
function MobileBar() {
	const relay = useRelay();
	const network = useNetwork();
	const path = useRouterState({ select: (s) => s.location.pathname });
	return (
		<details
			key={path}
			className="group mb-4 rounded-[10px] border border-border bg-surface min-[861px]:hidden"
		>
			<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 [&::-webkit-details-marker]:hidden">
				<WalletSummary />
				<span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-muted-foreground">
					Menu
					<ChevronDown
						className="size-4 transition-transform group-open:rotate-180"
						aria-hidden
					/>
				</span>
			</summary>
			<div className="flex flex-col gap-2 border-t border-border p-3">
				<WalletBox />
				{relay.mode === "on" && <MobileSwitcher />}
				<span className="flex flex-wrap gap-x-4 gap-y-1">
					{relay.mode === "off" && (
						<Link
							to="/multisig/create"
							search={{ network }}
							className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
						>
							{CREATE.title}
						</Link>
					)}
					<Link
						to="/multisig/open"
						className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
					>
						Open or start a proposal
					</Link>
				</span>
			</div>
		</details>
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
			// lines of about 90 characters, however wide the screen
			className="mb-4 max-w-[40rem]"
			action={
				<Btn size="sm" variant="outline" onClick={dismiss}>
					Got it
				</Btn>
			}
		>
			{relayConfig() ? RELAY_COPY.firstUseBody : RELAY_COPY.firstUseBodySolo}
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
			<Link
				to="/multisig/glossary"
				className="hover:text-foreground hover:underline"
			>
				{GLOSSARY_TITLE}
			</Link>
			{relayConfig() && (
				<Link to="/privacy" className="hover:text-foreground hover:underline">
					{RELAY_COPY.smallPrintLink}
				</Link>
			)}
		</footer>
	);
}
