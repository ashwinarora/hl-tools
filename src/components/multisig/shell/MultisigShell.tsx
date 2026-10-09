import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Callout } from "#/components/hub/status";
import { tool, toolRuleSets, toolVerifiedAt } from "#/lib/tools";
import { useMultisigPrefs, usePrefsHydrated } from "#/store/multisigPrefsStore";
import { RELAY_COPY } from "../model/relay/copy";
import { relayConfig } from "../relay/config";
import { Btn } from "./kit";
import { Rail, RailLink } from "./Rail";
import { WalletBox } from "./WalletBox";

/**
 * The Multisig section's own frame inside the hub: the hub's top bar stays,
 * and below it a left panel (who you are, where you can go) next to the
 * screen. On a phone the panel becomes a bar above the screen. The same frame
 * serves every state: no relay, signed out, signed in.
 */
export function MultisigShell({ children }: { children: ReactNode }) {
	return (
		<div className="page-wrap">
			<div className="grid grid-cols-1 items-start gap-4 pb-12 pt-4 min-[861px]:grid-cols-[252px_minmax(0,1fr)] min-[861px]:gap-7 min-[861px]:pb-16 min-[861px]:pt-6">
				<aside
					aria-label="Multisig navigation"
					className="sticky top-20 hidden flex-col gap-[18px] min-[861px]:flex"
				>
					<Rail
						foot={
							<RailLink to="/multisig/open">Open or start a proposal</RailLink>
						}
					/>
				</aside>
				<main className="min-w-0">
					<MobileBar />
					<FirstUse />
					{children}
					<ShellFoot />
				</main>
			</div>
		</div>
	);
}

/** Below the rail's breakpoint the identity box sits above the screen, with the way to links and files. */
function MobileBar() {
	return (
		<div className="mb-4 flex flex-col gap-2 min-[861px]:hidden">
			<WalletBox />
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
