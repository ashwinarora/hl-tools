import { ConnectButton } from "@rainbow-me/rainbowkit";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, MousePointerClick, Zap } from "lucide-react";
import {
	AnimatePresence,
	motion,
	useAnimate,
	useMotionValue,
	useMotionValueEvent,
	useSpring,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import AutoMode from "#/components/AutoMode";
import DisclaimerGate from "#/components/DisclaimerGate";
import { ToolPage } from "#/components/hub/layout";
import { Callout } from "#/components/hub/status";
import LandingHero from "#/components/LandingHero";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import WalletTable from "#/components/WalletTable";
import { useAutoChain } from "#/hooks/useAutoChain";
import { useWebData, type WebDataSnapshot } from "#/hooks/useWebData";
import { type AbstractionMode, isUnifiedLike } from "#/lib/hlActions";
import { tool } from "#/lib/tools";
import { cn } from "#/lib/utils";

const ABSTRACTION_LABEL: Record<AbstractionMode, string> = {
	unifiedAccount: "Unified",
	portfolioMargin: "Portfolio margin",
	disabled: "Standard",
};

export const Route = createFileRoute("/faucet-miner/")({ component: App });

function fmt(value: string | number): string {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ── Animated number row for mining mode ── */
function AnimatedRow({ label, value }: { label: string; value: number }) {
	const mv = useMotionValue(value);
	const spring = useSpring(mv, { stiffness: 40, damping: 15 });
	const [display, setDisplay] = useState(value);
	const [scope, animateZoom] = useAnimate();
	const prevRef = useRef(value);

	useEffect(() => {
		mv.set(value);
		if (prevRef.current !== value) {
			animateZoom(
				scope.current,
				{ scale: [1, 1.08, 1] },
				{ duration: 0.4, ease: "easeOut" },
			);
			prevRef.current = value;
		}
	}, [value, mv, animateZoom, scope]);

	useMotionValueEvent(spring, "change", (latest) => {
		setDisplay(latest);
	});

	return (
		<div className="flex items-center justify-between">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span ref={scope} className="text-sm font-semibold tabular-nums">
				{fmt(display)}
			</span>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="text-sm font-semibold tabular-nums">{value}</span>
		</div>
	);
}

function StatsColumn({
	title,
	data,
	isLoading,
	delay,
	isMining,
}: {
	title: string;
	data: WebDataSnapshot | null;
	isLoading: boolean;
	delay: number;
	isMining?: boolean;
}) {
	if (isLoading || !data) {
		return (
			<Card className="gap-2">
				<CardHeader className="pb-0">
					<div className="flex items-center justify-between">
						<CardTitle className="text-sm">{title}</CardTitle>
						{data && (
							<Badge variant="secondary" className="text-[10px]">
								{ABSTRACTION_LABEL[data.abstraction]}
							</Badge>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-2">
					{["a", "b", "c", "d"].map((id) => (
						<div key={id} className="flex items-center justify-between">
							<div className="h-3 w-24 animate-pulse rounded bg-muted" />
							<div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
						</div>
					))}
				</CardContent>
			</Card>
		);
	}

	const { marginSummary } = data.clearinghouseState;
	const withdrawable = Number.parseFloat(data.clearinghouseState.withdrawable);
	const accountValue = Number.parseFloat(marginSummary.accountValue);

	const usdc = data.spotState?.balances.find((b) => b.coin === "USDC");
	const spotTotal = usdc ? Number.parseFloat(usdc.total) : 0;
	const spotHold = usdc ? Number.parseFloat(usdc.hold) : 0;

	// In Unified / Portfolio Margin mode, perps and spot share a single balance
	// that Hyperliquid surfaces via spotClearinghouseState. The perps endpoint
	// returns $0 for `withdrawable` and `accountValue`, so showing those rows
	// makes it look like the account is empty when it isn't. Collapse to three
	// clean rows in that case; keep the four-row breakdown for Standard.
	const unified = isUnifiedLike(data.abstraction);
	const unifiedAvailable = spotTotal - spotHold;

	const rows: { label: string; value: number }[] = unified
		? [
				{ label: "Total Balance", value: spotTotal },
				{ label: "Available", value: unifiedAvailable },
				{ label: "On Hold", value: spotHold },
			]
		: [
				{ label: "Perps Withdrawable", value: withdrawable },
				{ label: "Account Value", value: accountValue },
				{ label: "Spot Balance", value: spotTotal },
				{ label: "Spot On Hold", value: spotHold },
			];

	const card = (
		<Card className="gap-2">
			<CardHeader className="pb-0">
				<div className="flex items-center justify-between">
					<CardTitle className="text-sm">{title}</CardTitle>
					<Badge variant="secondary" className="text-[10px]">
						{ABSTRACTION_LABEL[data.abstraction]}
					</Badge>
				</div>
				{unified && (
					<p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
						One balance funds both spot and perps trading.
					</p>
				)}
			</CardHeader>
			<CardContent className="space-y-1.5">
				{isMining
					? rows.map((r) => (
							<AnimatedRow key={r.label} label={r.label} value={r.value} />
						))
					: rows.map((r) => (
							<Row key={r.label} label={r.label} value={fmt(r.value)} />
						))}
			</CardContent>
		</Card>
	);

	if (isMining) {
		return (
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.3, ease: "easeOut", delay }}
			>
				<div className="mining-glow-wrapper rounded-xl p-[2px]">{card}</div>
			</motion.div>
		);
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.3, ease: "easeOut", delay }}
		>
			{card}
		</motion.div>
	);
}

type Mode = "auto" | "manual";

const triggerBase =
	"flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-6 py-5 transition-all";
const triggerActive = "border-primary bg-card shadow-md";
const triggerInactive =
	"border-border bg-transparent hover:border-muted-foreground/30 hover:shadow-sm";

function App() {
	// Only connection state here; balances subscribe inside <Connected /> so
	// the WebSocket subscriptions exist once and only while connected.
	const { isConnected } = useAccount();

	return (
		<ToolPage tool={tool("faucet")}>
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<Callout
					tone="warning"
					title="This tool signs and sends real transactions"
					className="w-full lg:w-auto lg:max-w-2xl lg:flex-1"
				>
					Unlike the rest of the hub, the faucet miner moves mainnet USDC from
					your connected wallet through generated wallets. Everything runs in
					your browser; no keys leave it.
				</Callout>
				<div className="flex items-center gap-2">
					<Link
						to="/faucet-miner/how-to-use"
						className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-surface px-3 text-sm hover:bg-surface-2"
					>
						<BookOpen className="size-4" aria-hidden />
						How it works
					</Link>
					{/* Disconnected visitors connect from the hero's call to action. */}
					{isConnected && (
						<ConnectButton
							showBalance={false}
							chainStatus={{ smallScreen: "icon", largeScreen: "full" }}
							accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
						/>
					)}
				</div>
			</div>
			{!isConnected ? <LandingHero /> : <Connected />}
		</ToolPage>
	);
}

function Connected() {
	const mainnet = useWebData("mainnet");
	const testnet = useWebData("testnet");
	const [mode, setMode] = useState<Mode>("auto");
	const chain = useAutoChain();
	const isMining =
		chain.state.status === "seeding" || chain.state.status === "running";

	return (
		<div className="space-y-8">
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				<StatsColumn
					title="Mainnet"
					data={mainnet.data}
					isLoading={mainnet.isLoading}
					delay={0}
				/>
				<StatsColumn
					title="Testnet"
					data={testnet.data}
					isLoading={testnet.isLoading}
					delay={0.075}
					isMining={isMining}
				/>
			</div>

			<div className="space-y-6">
				{/* Mode selector */}
				<div className="grid grid-cols-2 gap-4">
					<motion.button
						type="button"
						onClick={() => setMode("auto")}
						whileTap={{ scale: 0.98 }}
						transition={{ duration: 0.1 }}
						className={cn(
							triggerBase,
							mode === "auto" ? triggerActive : triggerInactive,
						)}
					>
						<Zap className="h-6 w-6" />
						<div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-2">
							<span className="whitespace-nowrap text-base font-semibold sm:text-lg">
								Auto Mode
							</span>
							<Badge variant="secondary" className="text-[10px]">
								Recommended
							</Badge>
						</div>
						<span className="text-xs font-normal text-muted-foreground">
							Automated chain mining
						</span>
					</motion.button>
					<motion.button
						type="button"
						onClick={() => setMode("manual")}
						whileTap={{ scale: 0.98 }}
						transition={{ duration: 0.1 }}
						className={cn(
							triggerBase,
							mode === "manual" ? triggerActive : triggerInactive,
						)}
					>
						<MousePointerClick className="h-6 w-6" />
						<span className="whitespace-nowrap text-base font-semibold sm:text-lg">
							Manual Mode
						</span>
						<span className="text-xs font-normal text-muted-foreground">
							Step-by-step control
						</span>
					</motion.button>
				</div>

				{/* Content */}
				<DisclaimerGate>
					<AnimatePresence mode="wait">
						<motion.div
							key={mode}
							initial={{ opacity: 0, y: 6 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -6 }}
							transition={{ duration: 0.15, ease: "easeOut" }}
						>
							{mode === "auto" ? (
								<AutoMode
									state={chain.state}
									start={chain.start}
									abort={chain.abort}
									reset={chain.reset}
									computeWalletsAtRisk={chain.computeWalletsAtRisk}
									forceReset={chain.forceReset}
									onSwitchToManual={() => setMode("manual")}
								/>
							) : (
								<WalletTable />
							)}
						</motion.div>
					</AnimatePresence>
				</DisclaimerGate>
			</div>
		</div>
	);
}
