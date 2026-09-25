import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Coins,
	Droplets,
	Github,
	Lock,
	Send,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";

const fadeIn = (delay: number) => ({
	initial: { opacity: 0, y: 8 },
	animate: { opacity: 1, y: 0 },
	transition: { duration: 0.3, ease: "easeOut" as const, delay },
});

function ConnectCta() {
	return (
		<ConnectButton.Custom>
			{({ openConnectModal, mounted }) => (
				<Button
					size="lg"
					onClick={openConnectModal}
					disabled={!mounted}
					className="h-11 px-6 text-base font-semibold"
				>
					Connect Wallet
					<ArrowRight className="h-4 w-4" />
				</Button>
			)}
		</ConnectButton.Custom>
	);
}

const steps = [
	{
		icon: Coins,
		title: "Activate",
		body: "Generate a fresh wallet. Hyperliquid charges a $1 fee on the first transfer in — that activates the account.",
	},
	{
		icon: Droplets,
		title: "Claim",
		body: "Claim the testnet faucet — ~$1,000 testnet USDC lands in the activated wallet.",
	},
	{
		icon: Send,
		title: "Drain",
		body: "Testnet USDC forwards to you. Remaining mainnet USDC forwards to the next fresh wallet in the chain.",
	},
];

const trustPoints = [
	{ icon: Lock, label: "Non-custodial" },
	{ icon: ShieldCheck, label: "Runs in your browser" },
	{ icon: Github, label: "Open source" },
];

export default function LandingHero() {
	return (
		<main className="page-wrap px-4 py-12 sm:py-16 space-y-16">
			{/* Hero */}
			<motion.section
				{...fadeIn(0)}
				className="flex flex-col items-center text-center space-y-5 pt-6 sm:pt-10"
			>
				<Badge variant="secondary" className="gap-1.5">
					<Sparkles className="h-3 w-3" />
					Hyperliquid testnet faucet miner
				</Badge>
				<h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight max-w-3xl">
					Mine testnet USDC on Hyperliquid.
				</h1>
				<p className="text-base sm:text-lg text-muted-foreground max-w-2xl">
					Chain generated wallets through the faucet.{" "}
					<span className="text-foreground font-medium">
						Pay ~$1, mine ~$1,000 testnet USDC
					</span>
					{" — per wallet. Chain 5, get $5,000."}
				</p>
				<div className="flex flex-wrap items-center justify-center gap-3 pt-2">
					<ConnectCta />
					<Button variant="ghost" size="lg" asChild className="h-11 text-base">
						<Link to="/how-to-use">
							How it works
							<ArrowRight className="h-4 w-4" />
						</Link>
					</Button>
				</div>
			</motion.section>

			{/* How it works */}
			<motion.section {...fadeIn(0.1)} className="space-y-4">
				<div className="flex items-baseline justify-between">
					<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
						How it works
					</h2>
				</div>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{steps.map((step, i) => (
						<Card key={step.title} className="gap-2">
							<CardContent className="space-y-3">
								<div className="flex items-center gap-2">
									<div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
										<step.icon className="h-4 w-4" />
									</div>
									<span className="text-xs font-mono text-muted-foreground">
										0{i + 1}
									</span>
								</div>
								<div className="space-y-1.5">
									<h3 className="text-base font-semibold">{step.title}</h3>
									<p className="text-sm text-muted-foreground leading-relaxed">
										{step.body}
									</p>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			</motion.section>

			{/* Worked example */}
			<motion.section {...fadeIn(0.15)} className="space-y-4">
				<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
					Example: 5 wallets
				</h2>
				<Card>
					<CardContent className="divide-y divide-border">
						<Row
							label="You send (mainnet USDC)"
							value="$5.00"
							hint="+ $1 activation fee = $6.00 debited"
						/>
						<Row
							label="Activation fees"
							value="~$5.00"
							hint="$1 per fresh wallet, 5 hops"
						/>
						<Row
							label="You get back (mainnet USDC)"
							value="~$1.00"
							hint="leftover after the chain drains"
						/>
						<Row label="You receive (testnet USDC)" value="~$5,000" emphasis />
						<Row label="Net cost" value="~$5.00" hint="≈ $1 per wallet" />
					</CardContent>
				</Card>
			</motion.section>

			{/* Trust strip */}
			<motion.section
				{...fadeIn(0.2)}
				className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-border pt-8"
			>
				{trustPoints.map((point) => (
					<div
						key={point.label}
						className="flex items-center gap-2 text-sm text-muted-foreground"
					>
						<point.icon className="h-4 w-4" />
						{point.label}
					</div>
				))}
				<a
					href="https://github.com/ashwinarora/hl-tools"
					target="_blank"
					rel="noopener noreferrer"
					className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
				>
					View source →
				</a>
			</motion.section>
		</main>
	);
}

function Row({
	label,
	value,
	hint,
	emphasis,
}: {
	label: string;
	value: string;
	hint?: string;
	emphasis?: boolean;
}) {
	return (
		<div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
			<div className="flex flex-col">
				<span className="text-sm text-muted-foreground">{label}</span>
				{hint && (
					<span className="text-xs text-muted-foreground/70">{hint}</span>
				)}
			</div>
			<span
				className={
					emphasis
						? "text-lg font-bold tabular-nums text-primary"
						: "text-base font-semibold tabular-nums"
				}
			>
				{value}
			</span>
		</div>
	);
}
