import { Check, CircleAlert, Loader2, Minus } from "lucide-react";
import {
	motion,
	useAnimate,
	useMotionValue,
	useMotionValueEvent,
	useSpring,
} from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import RecoveryBanner from "#/components/RecoveryBanner";
import ResetConfirmDialog, {
	type WalletAtRisk,
} from "#/components/ResetConfirmDialog";
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
import { useWalletBalances } from "#/hooks/useWalletBalances";
import {
	type AbstractionMode,
	decideChainKind,
	drainGeneratedWallet,
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
	balance,
}: {
	wallet: WalletStep;
	total: number;
	balance: { mainnet: number | null; testnet: number | null };
}) {
	const { address: userAddress } = useAccount();
	const isLast = wallet.index === total - 1;
	const [scope, animateFlash] = useAnimate();
	const prevStatusRef = useRef<WalletStepStatus>(wallet.status);
	const [draining, setDraining] = useState<"mainnet" | "testnet" | null>(null);
	// Synchronous mutex — protects against double-click that could open two
	// Rabby popups or fire two send calls before React state settles.
	const drainingRef = useRef(false);

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

	// Drain buttons are only enabled when the chain isn't actively using this
	// wallet, and there's a positive balance to drain.
	const canDrain = wallet.status !== "in-progress" && !!userAddress;
	const mainnetBal = balance.mainnet ?? 0;
	const testnetBal = balance.testnet ?? 0;
	const hasMainnet = mainnetBal > 0.005;
	const hasTestnet = testnetBal > 0.005;
	const isErrored = wallet.status === "error";
	const strandedNote = isErrored && (hasMainnet || hasTestnet);

	async function doDrain(kind: "mainnet" | "testnet") {
		if (!userAddress) return;
		if (drainingRef.current) return;
		drainingRef.current = true;
		setDraining(kind);
		const toastId = toast.loading(`Draining ${kind}`, {
			description: `${truncateAddress(wallet.address)}…`,
		});
		try {
			const sent = await drainGeneratedWallet(
				wallet.privateKey,
				userAddress,
				kind === "testnet",
			);
			if (sent) {
				toast.success(`Drained ${kind}`, {
					id: toastId,
					description: `${truncateAddress(wallet.address)} → your wallet.`,
				});
			} else {
				toast.info("Nothing to drain", {
					id: toastId,
					description: `${truncateAddress(wallet.address)} holds $0.00 on ${kind}.`,
				});
			}
		} catch (e) {
			console.error(`Drain ${kind} failed:`, e);
			toast.error(`Drain ${kind} failed`, {
				id: toastId,
				description: e instanceof Error ? e.message : String(e),
			});
		} finally {
			setDraining(null);
			drainingRef.current = false;
		}
	}

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
			<div className="flex items-center justify-between gap-2">
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
			<div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
				<div className="flex items-center gap-1.5">
					<span className="text-muted-foreground">Mainnet</span>
					<span
						className={`tabular-nums ${
							hasMainnet && isErrored ? "font-semibold text-destructive" : ""
						}`}
					>
						{balance.mainnet == null ? "—" : fmt(mainnetBal)}
					</span>
					<Button
						size="xs"
						variant="outline"
						disabled={!canDrain || !hasMainnet || draining !== null}
						onClick={() => doDrain("mainnet")}
					>
						{draining === "mainnet" ? "..." : "Drain"}
					</Button>
				</div>
				<div className="flex items-center gap-1.5">
					<span className="text-muted-foreground">Testnet</span>
					<span
						className={`tabular-nums ${
							hasTestnet && isErrored ? "font-semibold text-destructive" : ""
						}`}
					>
						{balance.testnet == null ? "—" : fmt(testnetBal)}
					</span>
					<Button
						size="xs"
						variant="outline"
						disabled={!canDrain || !hasTestnet || draining !== null}
						onClick={() => doDrain("testnet")}
					>
						{draining === "testnet" ? "..." : "Drain"}
					</Button>
				</div>
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
					{strandedNote && (
						<p className="text-[11px] text-destructive">
							Funds are still in this wallet — use the Drain buttons above to
							recover.
						</p>
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
								Wallet signs (Rabby popup)
							</span>
							<span className="font-semibold tabular-nums">{fmt(parsed)}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								Wallet debits ($1 activation fee on top)
							</span>
							<span className="font-semibold tabular-nums">
								{fmt(parsed + 1)}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Returned at end</span>
							<span className="font-semibold tabular-nums">{fmt(1)}</span>
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
							send <strong className="text-foreground">{fmt(parsed)}</strong>{" "}
							mainnet USDC (your wallet will debit{" "}
							<strong className="text-foreground">{fmt(parsed + 1)}</strong>{" "}
							including the $1 activation fee). Are you sure?
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
	const isAborted = state.status === "aborted";

	/* Animation 1: progress bar */
	const completedCount = state.wallets.filter(
		(w) => w.status === "completed",
	).length;
	const progressPct =
		state.inputAmount > 0 ? (completedCount / state.inputAmount) * 100 : 0;

	// Poll balances for every wallet in the chain. Active polling while the
	// chain is running, errored, or aborted (user needs live balances to drain).
	const addresses = useMemo(
		() => state.wallets.map((w) => w.address),
		[state.wallets],
	);
	const { balances } = useWalletBalances(
		addresses,
		isRunning || isError || isAborted,
	);

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle
						className={`text-sm ${isAborted ? "text-destructive" : ""}`}
					>
						{isDone ? (
							<motion.span
								initial={{ opacity: 0, scale: 0.95 }}
								animate={{ opacity: 1, scale: 1 }}
								transition={{ duration: 0.25, ease: "easeOut" }}
							>
								Chain Complete
							</motion.span>
						) : isAborted ? (
							"Chain Aborted"
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
						{(isDone || isError || isAborted) && (
							<Button variant="outline" size="xs" onClick={onReset}>
								{isDone ? "Run Again" : "Reset"}
							</Button>
						)}
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{isAborted && (
					<div className="rounded-md border border-red-500/70 bg-red-500/15 p-3 text-xs text-red-200">
						⚠ Chain aborted. Any wallets below with a balance still hold your
						funds. Drain them before clicking Reset — Reset will delete the
						private keys forever.
					</div>
				)}
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
								Seed: Send {fmt(state.inputAmount)} to Wallet #1{" "}
								<span className="text-muted-foreground">
									(+ $1 activation fee = {fmt(state.inputAmount + 1)} debited)
								</span>
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
							<WalletStepRow
								wallet={wallet}
								total={state.inputAmount}
								balance={
									balances[wallet.address] ?? {
										mainnet: null,
										testnet: null,
									}
								}
							/>
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
	computeWalletsAtRisk,
	forceReset,
	onSwitchToManual,
}: {
	state: ChainState;
	start: (n: number) => void;
	abort: () => void;
	reset: () => Promise<void> | void;
	computeWalletsAtRisk: () => Promise<WalletAtRisk[]>;
	forceReset: () => void;
	onSwitchToManual: () => void;
}) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [walletsAtRisk, setWalletsAtRisk] = useState<WalletAtRisk[]>([]);
	// Persistent id for the chain-level lifecycle toast. Spawned on Start,
	// updated to success/error/aborted by the state.status effect below.
	const chainToastRef = useRef<string | number | null>(null);
	const prevStatusRef = useRef(state.status);

	// Watch chain status transitions and update the persistent toast.
	useEffect(() => {
		const prev = prevStatusRef.current;
		const next = state.status;
		if (prev !== next && chainToastRef.current !== null) {
			if (next === "completed") {
				toast.success("Chain complete", {
					id: chainToastRef.current,
					description: `Mined ${state.inputAmount}×$1,000 testnet USDC. Net cost ~$${state.inputAmount}.`,
				});
				chainToastRef.current = null;
			} else if (next === "aborted") {
				toast.warning("Chain aborted", {
					id: chainToastRef.current,
					description:
						"Wallets with residual balances are listed below. Drain before Reset.",
				});
				chainToastRef.current = null;
			} else if (next === "error") {
				toast.error("Chain error", {
					id: chainToastRef.current,
					description: state.error ?? "Unknown error.",
				});
				chainToastRef.current = null;
			}
		}
		prevStatusRef.current = next;
	}, [state.status, state.error, state.inputAmount]);

	const handleStart = useCallback(
		(n: number) => {
			chainToastRef.current = toast.loading(`Starting chain (N=${n})`, {
				description:
					"Sign the seed send in your wallet — chain will run automatically.",
			});
			start(n);
		},
		[start],
	);

	const handleAbort = useCallback(() => {
		abort();
		// The status-transition effect will resolve the persistent chain toast
		// into a "Chain aborted" warning within the same tick.
	}, [abort]);

	const handleReset = useCallback(async () => {
		const toastId = toast.loading("Preparing reset", {
			description: "Checking wallets for residual funds…",
		});
		try {
			const risky = await computeWalletsAtRisk();
			if (risky.length === 0) {
				await reset();
				toast.success("Chain reset", {
					id: toastId,
					description: "Auto wallets pruned. Ready for another run.",
				});
				return;
			}
			toast.dismiss(toastId);
			setWalletsAtRisk(risky);
			setDialogOpen(true);
		} catch (e) {
			toast.error("Reset check failed", {
				id: toastId,
				description: e instanceof Error ? e.message : String(e),
			});
		}
	}, [computeWalletsAtRisk, reset]);

	const handleForceReset = useCallback(() => {
		forceReset();
		toast.warning("Auto wallets deleted forever", {
			description: "Private keys removed from browser.",
		});
	}, [forceReset]);

	if (state.status === "idle") {
		return (
			<>
				<RecoveryBanner onSwitchToManual={onSwitchToManual} />
				<AutoModeForm onStart={handleStart} />
			</>
		);
	}

	return (
		<>
			<AutoModeProgress
				state={state}
				onAbort={handleAbort}
				onReset={handleReset}
			/>
			<ResetConfirmDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				walletsAtRisk={walletsAtRisk}
				onConfirm={handleForceReset}
			/>
		</>
	);
}
