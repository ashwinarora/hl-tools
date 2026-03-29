import type { WebData2WsEvent } from "@nktkas/hyperliquid";
import { createFileRoute } from "@tanstack/react-router";
import { MousePointerClick, Zap } from "lucide-react";
import { useState } from "react";
import AutoMode from "#/components/AutoMode";
import DisclaimerGate from "#/components/DisclaimerGate";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import WalletTable from "#/components/WalletTable";
import { useWebData } from "#/hooks/useWebData";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/")({ component: App });

function fmt(value: string | number): string {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
}: {
	title: string;
	data: WebData2WsEvent | null;
	isLoading: boolean;
}) {
	if (isLoading || !data) {
		return (
			<Card className="gap-2">
				<CardHeader className="pb-0">
					<CardTitle className="text-sm">{title}</CardTitle>
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

	const spotBalances = data.spotState?.balances ?? [];
	const spotTotal = spotBalances.reduce(
		(sum, b) => sum + Number.parseFloat(b.total),
		0,
	);
	const spotHold = spotBalances.reduce(
		(sum, b) => sum + Number.parseFloat(b.hold),
		0,
	);

	return (
		<Card className="gap-2">
			<CardHeader className="pb-0">
				<CardTitle className="text-sm">{title}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-1.5">
				<Row label="Perps Withdrawable" value={fmt(withdrawable)} />
				<Row label="Account Value" value={fmt(accountValue)} />
				<Row label="Spot Balance" value={fmt(spotTotal)} />
				<Row label="Spot On Hold" value={fmt(spotHold)} />
			</CardContent>
		</Card>
	);
}

type Mode = "auto" | "manual";

const triggerBase =
	"flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border bg-card px-6 py-5 transition-all";
const triggerActive = "border-primary bg-primary/5 shadow-md";
const triggerInactive =
	"border-border hover:border-muted-foreground/30 hover:shadow-sm";

function App() {
	const mainnet = useWebData("mainnet");
	const testnet = useWebData("testnet");
	const [mode, setMode] = useState<Mode>("auto");

	if (!mainnet.isConnected) {
		return (
			<main className="page-wrap px-4 py-12">
				<p className="text-center text-muted-foreground">
					Connect your wallet to view your Hyperliquid stats.
				</p>
			</main>
		);
	}

	return (
		<main className="page-wrap px-4 py-8 space-y-8">
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				<StatsColumn
					title="Mainnet"
					data={mainnet.data}
					isLoading={mainnet.isLoading}
				/>
				<StatsColumn
					title="Testnet"
					data={testnet.data}
					isLoading={testnet.isLoading}
				/>
			</div>

			<div className="space-y-6">
				{/* Mode selector */}
				<div className="grid grid-cols-2 gap-4">
					<button
						type="button"
						onClick={() => setMode("auto")}
						className={cn(
							triggerBase,
							mode === "auto" ? triggerActive : triggerInactive,
						)}
					>
						<Zap className="h-6 w-6" />
						<div className="flex items-center gap-2">
							<span className="text-lg font-semibold">Auto Mode</span>
							<Badge variant="secondary" className="text-[10px]">
								Recommended
							</Badge>
						</div>
						<span className="text-xs font-normal text-muted-foreground">
							Automated chain mining
						</span>
					</button>
					<button
						type="button"
						onClick={() => setMode("manual")}
						className={cn(
							triggerBase,
							mode === "manual" ? triggerActive : triggerInactive,
						)}
					>
						<MousePointerClick className="h-6 w-6" />
						<span className="text-lg font-semibold">Manual Mode</span>
						<span className="text-xs font-normal text-muted-foreground">
							Step-by-step control
						</span>
					</button>
				</div>

				{/* Content */}
				<DisclaimerGate>
					{mode === "auto" ? <AutoMode /> : <WalletTable />}
				</DisclaimerGate>
			</div>
		</main>
	);
}
