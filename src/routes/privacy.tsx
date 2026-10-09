import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createFileRoute("/privacy")({
	head: () => ({ meta: [{ title: "Privacy Policy — hl-tools" }] }),
	component: PrivacyPage,
});

const UPDATED = "2026-10-10";
const REPO = "https://github.com/ashwinarora/hl-tools";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-2.5">
			<h2 className="text-base font-semibold">{title}</h2>
			<div className="space-y-2.5 text-sm leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
				{children}
			</div>
		</section>
	);
}

/**
 * What hl-tools keeps, where, and who can read it. Written to be read: the
 * relay stores what signers share so they can see it, and whoever operates
 * the relay can read it too. This page says so plainly; no screen claims
 * otherwise.
 */
function PrivacyPage() {
	return (
		<main className="page-wrap pb-16 pt-6 sm:pt-8">
			<div className="max-w-3xl space-y-7">
				<header className="space-y-2 border-b border-border pb-5">
					<h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
						Privacy Policy
					</h1>
					<p className="text-sm text-muted-foreground">
						Last updated <time dateTime={UPDATED}>{UPDATED}</time>. hl-tools is
						an independent open-source project and is not affiliated with
						Hyperliquid.
					</p>
				</header>

				<Section title="The short version">
					<ul>
						<li>
							The diagnostic tools keep nothing about you on our side. They run
							in your browser and talk to Hyperliquid directly.
						</li>
						<li>
							The Multisig section works without an account. Proposals passed on
							as links or files stay in your browser until you hand them to
							someone.
						</li>
						<li>
							If you <b>sign in</b> to the Multisig section, what you share
							there is stored on the hl-tools relay so your co-signers can see
							it. <b>The operator of the relay can read it as well.</b>
						</li>
						<li>
							No analytics, no advertising, no trackers, no session recording.
						</li>
					</ul>
				</Section>

				<Section title="Without signing in">
					<p>
						Nothing you paste, decode or build in a diagnostic tool is sent to
						us. Requests go from your browser to Hyperliquid's public API and
						WebSocket, and to the HyperEVM RPC endpoint you choose; those
						services see your IP address and what you ask them, under their own
						policies.
					</p>
					<p>
						Your browser keeps a few things locally: the selected network and
						theme, recorded WebSocket sessions, the multi-sig proposals you made
						or opened, treasury nicknames, and, in the faucet miner, the wallets
						it generated. They never leave the browser unless you export or
						share them. Clearing the site's data removes them.
					</p>
					<p>
						Connecting a wallet uses the wallet's own software. If you pick a
						WalletConnect-based wallet, the connection is relayed by
						WalletConnect under its policy.
					</p>
				</Section>

				<Section title="When you sign in to Multisig">
					<p>
						Signing in means signing one message with your wallet. It proves you
						control the address and cannot move funds. From then on the relay
						stores:
					</p>
					<ul>
						<li>
							<b>Your wallet address</b>, and when you signed in.
						</li>
						<li>
							<b>Treasuries</b> that you or a co-signer added: the account
							address, the network, and its signer list and threshold as
							Hyperliquid reports them.
						</li>
						<li>
							<b>Proposals</b> shared for those treasuries, in full: the action
							with its destination and amount, the title and note, who proposed
							it and who finalises it.
						</li>
						<li>
							<b>Signatures</b> added to those proposals, and when one was taken
							back.
						</li>
						<li>
							<b>Outcomes</b>: that a proposal was withdrawn or declined, and
							what Hyperliquid answered when it was submitted.
						</li>
						<li>
							<b>A history</b> of the above: which address did what, and when.
						</li>
					</ul>
					<p>
						Your browser also keeps a session token so you stay signed in. The
						relay never receives a private key or a seed phrase, and nothing on
						this site asks for one.
					</p>
				</Section>

				<Section title="Who can read it">
					<ul>
						<li>
							<b>The current signers of a treasury</b>, according to
							Hyperliquid's signer list, can read everything stored for that
							treasury. A signer added later can read its earlier history; a
							removed signer loses access once the list is refreshed.
						</li>
						<li>
							<b>The operator of the relay</b> can read everything stored on it.
							Proposals are stored readable so signers can review them; they are
							protected in transit and at rest by the hosting provider, and are
							not hidden from the operator.
						</li>
						<li>
							<b>Nobody else.</b> We do not sell, rent or share this data, and
							we do not use it for anything other than showing it to those
							signers.
						</li>
					</ul>
					<p>
						Bear in mind that most of this becomes public anyway: once an action
						is submitted, Hyperliquid's ledger shows it to everyone. What the
						relay holds that the chain does not is the time before submission:
						what is being proposed, and who has signed so far.
					</p>
				</Section>

				<Section title="What the relay cannot do">
					<p>
						It cannot move funds, sign for you, or make a proposal executable.
						Every signature is checked in your browser against the proposal you
						are looking at, and Hyperliquid alone decides what executes. The
						relay can be slow or wrong about who has signed; it cannot forge a
						signature. If you would rather not use it, links and files do the
						same job without it.
					</p>
				</Section>

				<Section title="Where it is kept, and for how long">
					<p>
						The relay runs on Supabase (a database and sign-in service), which
						processes the data on our behalf and, like any host, sees the IP
						addresses that connect to it and keeps its own access logs for a
						limited time.
					</p>
					<p>
						Proposals and history are kept until they are deleted. You can
						export a proposal or a treasury's history as a file at any time. To
						have your data removed, open an issue at the address below from an
						account you can link to your wallet address, or ask a co-signer to;
						we will ask you to prove control of the address with a signature.
					</p>
				</Section>

				<Section title="Running your own">
					<p>
						The code is open. A team that wants to keep its proposals to itself
						can run its own relay, or use links and files only. See the{" "}
						<a
							href={REPO}
							target="_blank"
							rel="noopener noreferrer"
							className="text-foreground underline underline-offset-2"
						>
							repository
						</a>
						.
					</p>
				</Section>

				<Section title="Changes and contact">
					<p>
						If this policy changes, the date at the top changes with it, and a
						material change is announced on the sign-in screen before it takes
						effect. Questions and requests:{" "}
						<a
							href={`${REPO}/issues`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-foreground underline underline-offset-2"
						>
							{REPO.replace("https://", "")}/issues
						</a>
						.
					</p>
					<p>
						<Link
							to="/"
							className="text-foreground underline underline-offset-2"
						>
							Back to the tools
						</Link>
					</p>
				</Section>
			</div>
		</main>
	);
}
