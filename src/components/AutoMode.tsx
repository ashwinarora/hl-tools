import { Check, CircleAlert, Loader2, Minus } from "lucide-react";
import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import {
	type ChainState,
	type SubStep,
	useAutoChain,
	type WalletStep,
} from "#/hooks/useAutoChain";

function fmt(value: number): string {
	return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function truncateAddress(address: string): string {
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const SUB_STEP_LABELS: Record<SubStep, string> = {
	"claim-faucet": "Claim faucet",
	"drain-testnet": "Drain testnet to you",
	"forward-mainnet": "Forward mainnet",
};

function SubStepRow({
	subStep,
	wallet,
	isLast,
}: {
	subStep: SubStep;
	wallet: WalletStep;
	isLast: boolean;
}) {
	const isCompleted = wallet.completedSubSteps.includes(subStep);
	const isActive = wallet.currentSubStep === subStep;
	const hasError = wallet.status === "error" && isActive;

	let label = SUB_STEP_LABELS[subStep];
	if (subStep === "forward-mainnet" && isLast) {
		label = "Return mainnet to you";
	}

	return (
		<div className="flex items-center gap-2 text-xs">
			{isCompleted ? (
				<Check className="size-3.5 text-green-500" />
			) : isActive && !hasError ? (
				<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
			) : hasError ? (
				<CircleAlert className="size-3.5 text-destructive" />
			) : (
				<Minus className="size-3.5 text-muted-foreground/40" />
			)}
			<span
				className={
					isCompleted
						? "text-muted-foreground"
						: hasError
							? "text-destructive"
							: ""
				}
			>
				{label}
			</span>
		</div>
	);
}

function WalletStepRow({
	wallet,
	total,
}: {
	wallet: WalletStep;
	total: number;
}) {
	const isLast = wallet.index === total - 1;
	const statusBadge = {
		pending: <Badge variant="secondary">Pending</Badge>,
		"in-progress": (
			<Badge variant="default">
				<Loader2 className="mr-1 size-3 animate-spin" />
				Active
			</Badge>
		),
		completed: <Badge variant="outline">Done</Badge>,
		error: <Badge variant="destructive">Error</Badge>,
	}[wallet.status];

	return (
		<div className="space-y-1.5 rounded-md border p-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium">
						Wallet {wallet.index + 1}/{total}
					</span>
					<span className="font-mono text-xs text-muted-foreground">
						{truncateAddress(wallet.address)}
					</span>
				</div>
				{statusBadge}
			</div>
			{wallet.status !== "pending" && (
				<div className="space-y-1 pl-1">
					<SubStepRow subStep="claim-faucet" wallet={wallet} isLast={isLast} />
					<SubStepRow subStep="drain-testnet" wallet={wallet} isLast={isLast} />
					<SubStepRow
						subStep="forward-mainnet"
						wallet={wallet}
						isLast={isLast}
					/>
					{wallet.error && (
						<p className="mt-1 text-xs text-destructive">{wallet.error}</p>
					)}
				</div>
			)}
		</div>
	);
}

function AutoModeForm({ onStart }: { onStart: (amount: number) => void }) {
	const [amount, setAmount] = useState("");
	const [confirming, setConfirming] = useState(false);
	const parsed = Number.parseInt(amount, 10);
	const isValid = !Number.isNaN(parsed) && parsed >= 1 && parsed <= 50;
	const needsConfirm = isValid && parsed > 10;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">Auto Miner</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<label
						className="text-xs text-muted-foreground"
						htmlFor="burn-amount"
					>
						Mainnet USDC to burn
					</label>
					<Input
						id="burn-amount"
						type="number"
						min={1}
						max={50}
						step={1}
						placeholder="e.g. 5"
						value={amount}
						onChange={(e) => {
							setAmount(e.target.value);
							setConfirming(false);
						}}
					/>
				</div>
				{isValid && (
					<div className="space-y-1 text-xs">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Wallets to generate</span>
							<span className="font-semibold tabular-nums">{parsed}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								Testnet USDC to receive
							</span>
							<span className="font-semibold tabular-nums">
								{fmt(parsed * 1000)}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								Initial send (returned at end)
							</span>
							<span className="font-semibold tabular-nums">
								{fmt(parsed + 1)}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Net mainnet cost</span>
							<span className="font-semibold tabular-nums">{fmt(parsed)}</span>
						</div>
					</div>
				)}
				{needsConfirm && !confirming ? (
					<Button
						onClick={() => setConfirming(true)}
						disabled={!isValid}
						className="w-full"
					>
						Start Chain
					</Button>
				) : needsConfirm && confirming ? (
					<div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
						<p className="text-xs text-muted-foreground">
							You're about to create{" "}
							<strong className="text-foreground">{parsed} wallets</strong> and
							send{" "}
							<strong className="text-foreground">{fmt(parsed + 1)}</strong>{" "}
							mainnet USDC. Are you sure?
						</p>
						<div className="flex gap-2">
							<Button
								onClick={() => onStart(parsed)}
								className="flex-1"
								size="sm"
							>
								Confirm &amp; Start
							</Button>
							<Button
								variant="outline"
								onClick={() => setConfirming(false)}
								size="sm"
							>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<Button
						onClick={() => onStart(parsed)}
						disabled={!isValid}
						className="w-full"
					>
						Start Chain
					</Button>
				)}
			</CardContent>
		</Card>
	);
}

function AutoModeProgress({
	state,
	onAbort,
	onReset,
}: {
	state: ChainState;
	onAbort: () => void;
	onReset: () => void;
}) {
	const isRunning = state.status === "running" || state.status === "seeding";
	const isDone = state.status === "completed";
	const isError = state.status === "error";

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="text-sm">
						{isDone
							? "Chain Complete"
							: isError
								? "Chain Error"
								: "Auto Chain Progress"}
					</CardTitle>
					<div className="flex gap-2">
						{isRunning && (
							<Button variant="destructive" size="xs" onClick={onAbort}>
								Abort
							</Button>
						)}
						{(isDone || isError) && (
							<Button variant="outline" size="xs" onClick={onReset}>
								{isDone ? "Run Again" : "Reset"}
							</Button>
						)}
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{/* Seed status */}
				<div className="flex items-center gap-2 text-xs">
					{state.status === "seeding" ? (
						<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
					) : (
						<Check className="size-3.5 text-green-500" />
					)}
					<span>Seed: Send {fmt(state.inputAmount + 1)} to Wallet #1</span>
				</div>

				{/* Wallet steps */}
				<div className="space-y-2">
					{state.wallets.map((wallet) => (
						<WalletStepRow
							key={wallet.address}
							wallet={wallet}
							total={state.inputAmount}
						/>
					))}
				</div>

				{/* Summary */}
				<div className="flex items-center justify-between border-t pt-3 text-sm">
					<span className="text-muted-foreground">Testnet collected</span>
					<span className="font-semibold tabular-nums">
						{fmt(state.totalTestnetCollected)} / {fmt(state.inputAmount * 1000)}
					</span>
				</div>
			</CardContent>
		</Card>
	);
}

export default function AutoMode() {
	const { state, start, abort, reset } = useAutoChain();

	if (state.status === "idle") {
		return <AutoModeForm onStart={start} />;
	}

	return <AutoModeProgress state={state} onAbort={abort} onReset={reset} />;
}
