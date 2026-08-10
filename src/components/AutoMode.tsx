import { Check, CircleAlert, Loader2, Minus } from "lucide-react";
import {
	motion,
	useAnimate,
	useMotionValue,
	useMotionValueEvent,
	useSpring,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import type {
	ChainState,
	SubStep,
	WalletStep,
	WalletStepStatus,
} from "#/hooks/useAutoChain";
import {
	type AbstractionMode,
	decideChainKind,
	fetchUserProfile,
	type SendKind,
	type UserProfile,
} from "#/lib/hlActions";

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

/* ── Animation 3: Animated testnet counter ── */
function AnimatedAmount({ value }: { value: number }) {
	const mv = useMotionValue(value);
	const spring = useSpring(mv, { stiffness: 120, damping: 20 });
	const [display, setDisplay] = useState(value);

	useEffect(() => {
		mv.set(value);
	}, [value, mv]);

	useMotionValueEvent(spring, "change", (latest) => {
		setDisplay(latest);
	});

	return <>{fmt(display)}</>;
}

/* ── SubStepRow with checkmark micro-animation (Animation 4) ── */
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
				<motion.span
					initial={{ scale: 0 }}
					animate={{ scale: 1 }}
					transition={{ type: "spring", stiffness: 500, damping: 25 }}
					className="inline-flex"
				>
					<Check className="size-3.5 text-green-500" />
				</motion.span>
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

/* ── WalletStepRow with active highlight (2) + completion flash (5) ── */
function WalletStepRow({
	wallet,
	total,
}: {
	wallet: WalletStep;
	total: number;
}) {
	const isLast = wallet.index === total - 1;
	const [scope, animateFlash] = useAnimate();
	const prevStatusRef = useRef<WalletStepStatus>(wallet.status);

	useEffect(() => {
		if (
			prevStatusRef.current === "in-progress" &&
			wallet.status === "completed"
		) {
			animateFlash(
				scope.current,
				{
					backgroundColor: ["rgba(34,197,94,0.15)", "rgba(34,197,94,0)"],
				},
				{ duration: 0.3, ease: "easeOut" },
			);
		}
		prevStatusRef.current = wallet.status;
	}, [wallet.status, animateFlash, scope]);

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
		<div
			ref={scope}
			className="relative space-y-1.5 overflow-hidden rounded-md border p-3"
		>
			{/* Animation 2: pulsing left border on active wallet */}
			{wallet.status === "in-progress" && (
				<motion.div
					className="absolute inset-y-0 left-0 w-0.5 bg-primary"
					animate={{ opacity: [0.4, 1, 0.4] }}
					transition={{
						duration: 2,
						repeat: Number.POSITIVE_INFINITY,
						ease: "easeInOut",
					}}
				/>
			)}
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

const ABSTRACTION_LABEL: Record<AbstractionMode, string> = {
	unifiedAccount: "Unified account",
	portfolioMargin: "Portfolio margin",
	disabled: "Standard",
};

function pocketLabel(kind: SendKind): string {
	return kind === "spot" ? "spot" : "perps";
}

function availableInPocket(profile: UserProfile, kind: SendKind): number {
	return kind === "spot" ? profile.spotUsdc : profile.perpsWithdrawable;
}

function AutoModeForm({ onStart }: { onStart: (amount: number) => void }) {
	const { address: userAddress } = useAccount();
	const [amount, setAmount] = useState("");
	const [confirming, setConfirming] = useState(false);
	const [profile, setProfile] = useState<UserProfile | null>(null);
	const parsed = Number.parseInt(amount, 10);
	const isValid = !Number.isNaN(parsed) && parsed >= 1 && parsed <= 50;
	const needsConfirm = isValid && parsed > 10;

	useEffect(() => {
		if (!userAddress) {
			setProfile(null);
			return;
		}
		let cancelled = false;
		fetchUserProfile(userAddress, false)
			.then((p) => {
				if (!cancelled) setProfile(p);
			})
			.catch(() => {
				if (!cancelled) setProfile(null);
			});
		return () => {
			cancelled = true;
		};
	}, [userAddress]);

	const required = isValid ? parsed + 1 : 0;
	const kind = isValid && profile ? decideChainKind(profile, required) : null;
	const canStart = isValid && (!profile || kind !== null);
	const availableMax = profile
		? Math.max(profile.spotUsdc, profile.perpsWithdrawable)
		: 0;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="text-sm">Auto Miner</CardTitle>
					{profile && (
						<Badge variant="secondary" className="text-[10px]">
							{ABSTRACTION_LABEL[profile.abstraction]}
						</Badge>
					)}
				</div>
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
						{profile && kind && (
							<div className="flex justify-between border-t pt-1 text-muted-foreground">
								<span>Available</span>
								<span className="tabular-nums">
									{fmt(availableInPocket(profile, kind))} in {pocketLabel(kind)}
								</span>
							</div>
						)}
					</div>
				)}
				{isValid && profile && kind === null && (
					<div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
						Not enough USDC — need {fmt(parsed + 1)}
						{profile.abstraction === "unifiedAccount" ||
						profile.abstraction === "portfolioMargin"
							? " in your spot (unified) balance"
							: " in your spot or perps balance"}
						. You have {fmt(availableMax)}.
					</div>
				)}
				{needsConfirm && !confirming ? (
					<Button
						onClick={() => setConfirming(true)}
						disabled={!canStart}
						className="w-full hover:cursor-pointer"
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
								disabled={!canStart}
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
						disabled={!canStart}
						className="w-full hover:cursor-pointer"
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

	/* Animation 1: progress bar */
	const completedCount = state.wallets.filter(
		(w) => w.status === "completed",
	).length;
	const progressPct =
		state.inputAmount > 0 ? (completedCount / state.inputAmount) * 100 : 0;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					{/* Animation 6b: "Chain Complete" title fade-in */}
					<CardTitle className="text-sm">
						{isDone ? (
							<motion.span
								initial={{ opacity: 0, scale: 0.95 }}
								animate={{ opacity: 1, scale: 1 }}
								transition={{ duration: 0.25, ease: "easeOut" }}
							>
								Chain Complete
							</motion.span>
						) : isError ? (
							"Chain Error"
						) : (
							"Auto Chain Progress"
						)}
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
				{/* Animation 1: progress bar */}
				<div className="h-1 w-full overflow-hidden rounded-full bg-muted">
					<motion.div
						className={
							progressPct >= 100
								? "h-full rounded-full bg-green-500"
								: "h-full rounded-full bg-primary"
						}
						animate={{ width: `${progressPct}%` }}
						transition={{ duration: 0.4, ease: "easeOut" }}
					/>
				</div>

				{/* Seed status */}
				{(() => {
					const firstWallet = state.wallets[0];
					const seedFailed =
						state.status === "error" &&
						firstWallet?.status === "error" &&
						firstWallet.currentSubStep === null &&
						firstWallet.completedSubSteps.length === 0;
					return (
						<div className="flex items-center gap-2 text-xs">
							{state.status === "seeding" ? (
								<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
							) : seedFailed ? (
								<CircleAlert className="size-3.5 text-destructive" />
							) : (
								<Check className="size-3.5 text-green-500" />
							)}
							<span className={seedFailed ? "text-destructive" : undefined}>
								Seed: Send {fmt(state.inputAmount + 1)} to Wallet #1
							</span>
						</div>
					);
				})()}

				{/* Wallet steps */}
				<div className="space-y-2">
					{state.wallets.map((wallet, i) => (
						<motion.div
							key={wallet.address}
							initial={{ opacity: 0, y: 6 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{
								duration: 0.25,
								ease: "easeOut",
								delay: i * 0.05,
							}}
						>
							<WalletStepRow wallet={wallet} total={state.inputAmount} />
						</motion.div>
					))}
				</div>

				{/* Animation 6a: summary with scale pulse on completion */}
				<motion.div
					key={isDone ? "done" : "progress"}
					className="flex items-center justify-between border-t pt-3 text-sm"
					animate={isDone ? { scale: [1, 1.02, 1] } : undefined}
					transition={{ duration: 0.3, ease: "easeOut" }}
				>
					<span className="text-muted-foreground">Testnet collected</span>
					<span className="font-semibold tabular-nums">
						{/* Animation 3: animated counter */}
						<AnimatedAmount value={state.totalTestnetCollected} /> /{" "}
						{fmt(state.inputAmount * 1000)}
					</span>
				</motion.div>
			</CardContent>
		</Card>
	);
}

export default function AutoMode({
	state,
	start,
	abort,
	reset,
}: {
	state: ChainState;
	start: (n: number) => void;
	abort: () => void;
	reset: () => void;
}) {
	if (state.status === "idle") {
		return <AutoModeForm onStart={start} />;
	}

	return <AutoModeProgress state={state} onAbort={abort} onReset={reset} />;
}
