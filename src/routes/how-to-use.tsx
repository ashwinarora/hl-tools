import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";

export const Route = createFileRoute("/how-to-use")({ component: HowToUse });

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">{title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
				{children}
			</CardContent>
		</Card>
	);
}

function Step({
	n,
	title,
	children,
}: {
	n: number;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex gap-3">
			<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
				{n}
			</span>
			<div>
				<p className="font-medium text-foreground">{title}</p>
				<p className="mt-0.5">{children}</p>
			</div>
		</div>
	);
}

function MathRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between border-b border-dashed border-border py-1.5 last:border-0">
			<span>{label}</span>
			<span className="font-semibold tabular-nums text-foreground">
				{value}
			</span>
		</div>
	);
}

function HowToUse() {
	return (
		<main className="page-wrap px-4 py-8 space-y-6">
			<div className="flex items-center gap-3">
				<Link
					to="/"
					className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<ArrowLeft className="h-4 w-4" />
					Back
				</Link>
				<h1 className="text-2xl font-bold tracking-tight">How to Use</h1>
			</div>

			{/* Overview */}
			<Section title="What is hl-tools?">
				<p>
					hl-tools lets you mine Hyperliquid <strong>testnet USDC</strong> by
					using the testnet faucet. Each faucet claim gives a generated wallet{" "}
					<strong>~$1,000 testnet USDC</strong>, but each wallet needs{" "}
					<strong>$2 real mainnet USDC</strong> to activate it on Hyperliquid.
				</p>
				<p>
					There are two modes: <strong>Auto</strong> (recommended &mdash; the
					app runs the entire chain for you) and <strong>Manual</strong> (you
					control each step).
				</p>
			</Section>

			{/* Prerequisites */}
			<Section title="Prerequisites">
				<Step n={1} title="A Web3 wallet (e.g. MetaMask, Rabby, WalletConnect)">
					You need a wallet with some mainnet USDC deposited on Hyperliquid.
				</Step>
				<Step n={2} title="Mainnet USDC on Hyperliquid">
					Manual mode needs <strong>$2 per wallet</strong> you want to activate.
					Auto mode needs <strong>N + 1 USDC</strong> (where N is the number of
					wallets). The extra $1 is a gas buffer that gets returned.
				</Step>
				<Step n={3} title="Connect your wallet">
					Click the wallet button in the top-right corner of the page to
					connect. Once connected, your mainnet and testnet account stats will
					appear on the home page.
				</Step>
			</Section>

			{/* Auto Mode */}
			<Section title="Auto Mode — Step by Step (Default)">
				<p className="font-medium text-foreground">
					Auto mode chains multiple wallets together in a single automated run.
					You specify how many wallets to use, and the app handles everything.
				</p>

				<Step n={1} title="Enter the number of wallets (1–50)">
					This is the number of wallets the chain will create and process. Each
					wallet claims the faucet once, so more wallets = more testnet USDC.
				</Step>

				<Step n={2} title='Review the preview, then click "Start Chain"'>
					The preview shows you exactly how much mainnet USDC will be sent and
					how much testnet USDC you'll receive. Confirm and start.
				</Step>

				<Step n={3} title="Seeding phase">
					The app sends <strong>N + 1 USDC</strong> from your wallet to the
					first generated wallet. The extra $1 is a gas buffer to cover
					transaction fees across the chain.
				</Step>

				<Step n={4} title="Chain loop (automated for each wallet)">
					For each wallet in the chain, the app automatically does three things:
				</Step>

				<div className="ml-9 space-y-2 rounded-lg border border-border bg-muted/50 p-3">
					<div className="flex gap-2">
						<span className="text-xs font-bold text-primary">4a.</span>
						<p>
							<strong>Claim faucet</strong> — Gets ~$1,000 testnet USDC from the
							Hyperliquid testnet faucet.
						</p>
					</div>
					<div className="flex gap-2">
						<span className="text-xs font-bold text-primary">4b.</span>
						<p>
							<strong>Drain testnet</strong> — Sends all testnet USDC (minus
							$0.01 fee) back to your wallet.
						</p>
					</div>
					<div className="flex gap-2">
						<span className="text-xs font-bold text-primary">4c.</span>
						<p>
							<strong>Forward mainnet</strong> — Sends remaining mainnet USDC to
							the next wallet in the chain (or back to you if it's the last
							wallet).
						</p>
					</div>
				</div>

				<Step n={5} title="Completion">
					Once all wallets are processed, all mainnet USDC is returned to your
					wallet and all testnet USDC has been collected. The chain is complete.
				</Step>

				<div className="rounded-lg border border-border bg-muted/50 p-4 space-y-1">
					<p className="font-medium text-foreground text-xs uppercase tracking-wide">
						Auto Mode Math (example: N = 5 wallets)
					</p>
					<MathRow label="Initial send to Wallet #1" value="$6.00 (5 + 1)" />
					<MathRow label="Wallets generated" value="5" />
					<MathRow label="Faucet claims" value="5 × $1,000" />
					<MathRow label="Testnet USDC received" value="$5,000" />
					<MathRow
						label="Mainnet returned to you"
						value="~$5.00 (minus fees)"
					/>
					<MathRow label="Net mainnet cost" value="~$0.10 (gas fees)" />
					<MathRow label="Effective ratio" value="~$0.10 → $5,000 testnet" />
				</div>

				<div className="rounded-lg border border-border bg-muted/50 p-4 space-y-1">
					<p className="font-medium text-foreground text-xs uppercase tracking-wide">
						General Formula
					</p>
					<MathRow label="You send" value="N + 1 USDC" />
					<MathRow label="You get back (mainnet)" value="~N + 1 − (N × 0.02)" />
					<MathRow label="You get (testnet)" value="N × 1,000 USDC" />
					<MathRow label="Net mainnet cost" value="~N × $0.02 (fees)" />
					<MathRow label="Per-wallet cost" value="~$0.02" />
				</div>
			</Section>

			{/* USDC Flow Diagram */}
			<Section title="How USDC Flows in Auto Mode">
				<div className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 font-mono text-xs leading-relaxed">
					<pre className="text-foreground">{`Your Wallet
    │
    ├─ sends (N+1) USDC ──▶ Wallet #1
    │                          │
    │   ┌──────────────────────┘
    │   │
    │   ├─ claim faucet ──▶ +$1,000 testnet
    │   ├─ drain testnet ──▶ $1,000 → Your Wallet (testnet)
    │   └─ forward mainnet ──▶ Wallet #2
    │                             │
    │   ┌─────────────────────────┘
    │   │
    │   ├─ claim faucet ──▶ +$1,000 testnet
    │   ├─ drain testnet ──▶ $1,000 → Your Wallet (testnet)
    │   └─ forward mainnet ──▶ Wallet #3
    │                             │
    │           ... continues for all N wallets ...
    │                             │
    │   ┌─────────────────────────┘
    │   │
    │   ├─ claim faucet ──▶ +$1,000 testnet
    │   ├─ drain testnet ──▶ $1,000 → Your Wallet (testnet)
    │   └─ forward mainnet ──▶ Your Wallet (returned!)
    │
    ▼
Result: You spent ~$0.02×N in fees, got N×$1,000 testnet USDC`}</pre>
				</div>
			</Section>

			{/* Manual Mode */}
			<Section title="Manual Mode — Step by Step">
				<p className="font-medium text-foreground">
					Manual mode gives you full control. You create wallets one by one and
					trigger each action yourself.
				</p>

				<Step n={1} title='Click "Add Wallet"'>
					This generates a random Ethereum wallet (private key + address) stored
					in your browser&apos;s localStorage. You can add as many as you like.
				</Step>

				<Step n={2} title='Activate — Click "Receive $2"'>
					This sends <strong>$2 mainnet USDC</strong> from your connected wallet
					to the generated wallet. This activates the wallet on Hyperliquid
					mainnet so it can send transactions.
				</Step>

				<Step n={3} title='Claim Faucet — Click "Claim"'>
					Calls the Hyperliquid testnet faucet API for that wallet. The wallet
					receives <strong>~$1,000 testnet USDC</strong>. This is the core
					mining action.
				</Step>

				<Step n={4} title='Drain Testnet — Click "Send"'>
					Sends all testnet USDC (minus a $0.01 gas buffer) from the generated
					wallet back to your connected wallet.
				</Step>

				<Step n={5} title='Drain Mainnet — Click "Send"'>
					Sends all mainnet USDC (minus $0.01 gas buffer) from the generated
					wallet back to your connected wallet. This recovers most of the $2 you
					sent.
				</Step>

				<Step n={6} title="Repeat">
					Create more wallets and repeat steps 2–5 for each one. Each wallet
					mines ~$1,000 testnet USDC.
				</Step>

				<div className="rounded-lg border border-border bg-muted/50 p-4 space-y-1">
					<p className="font-medium text-foreground text-xs uppercase tracking-wide">
						Manual Mode Math (per wallet)
					</p>
					<MathRow label="You send (activation)" value="$2.00" />
					<MathRow label="You recover (drain mainnet)" value="~$1.99" />
					<MathRow label="Net mainnet cost" value="~$0.01" />
					<MathRow label="Testnet USDC mined" value="~$1,000" />
					<MathRow label="Effective ratio" value="~$0.01 → $1,000 testnet" />
				</div>
			</Section>

			{/* Tips */}
			<Section title="Tips & Notes">
				<ul className="list-disc space-y-2 pl-5">
					<li>
						<strong>Auto mode is the default and recommended</strong> for most
						users. It's faster and handles all the wallet-to-wallet forwarding
						for you.
					</li>
					<li>
						<strong>Manual mode is available</strong> for testing, exploring, or
						when you want full control over individual wallet actions.
					</li>
					<li>
						<strong>Wallets are stored in localStorage.</strong> They persist
						across page refreshes but will be lost if you clear browser data.
					</li>
					<li>
						<strong>You can abort an auto chain</strong> mid-run by clicking the
						Abort button. Any mainnet USDC still in the chain wallets will need
						to be recovered manually.
					</li>
					<li>
						<strong>The $0.01 gas buffer</strong> per transaction ensures that
						the send operation has enough room to complete. This is why the net
						cost per wallet is ~$0.02 (two sends: drain + forward).
					</li>
					<li>
						<strong>Faucet limits:</strong> The Hyperliquid testnet faucet may
						rate-limit claims. If a claim fails, the auto chain will report an
						error for that wallet.
					</li>
				</ul>
			</Section>
		</main>
	);
}
