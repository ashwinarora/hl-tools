import { Droplets, Wallet } from "lucide-react";
import {
	AnimatePresence,
	motion,
	useInView,
	useReducedMotion,
} from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "#/lib/utils";

/**
 * How the miner turns $1 into ~1,000 testnet USDC, as motion: a dollar of
 * mainnet USDC hops from one fresh wallet to the next, and each wallet it
 * lands on drops its faucet claim, "+1,000", into your testnet balance. It
 * plays only while on screen, pauses between rounds, and holds still under
 * reduced motion (every wallet lit, the total shown).
 *
 * Decorative: the sentence beside it says the same in words.
 */
const HOP_MS = 720;
const REST_MS = 1600;
const EASE = [0.22, 1, 0.36, 1] as const;

export function FaucetFlow({
	wallets = 5,
	size = "sm",
	className,
}: {
	wallets?: number;
	size?: "sm" | "lg";
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const visible = useInView(ref, { amount: 0.6 });
	const still = useReducedMotion();
	// -1: the dollar is at your wallet; 0…wallets-1: on that fresh wallet.
	// The server draws the finished run (every wallet claimed); in the
	// browser it plays from your wallet again, and the last hop home is the
	// $1 that comes back to you.
	const [at, setAt] = useState(wallets - 1);

	useEffect(() => {
		if (still) {
			setAt(wallets - 1);
			return;
		}
		if (!visible) return;
		let step = wallets - 1;
		let timer: ReturnType<typeof setTimeout>;
		const tick = () => {
			step = step >= wallets - 1 ? -1 : step + 1;
			setAt(step);
			timer = setTimeout(tick, step === wallets - 1 ? REST_MS : HOP_MS);
		};
		timer = setTimeout(tick, 500);
		return () => clearTimeout(timer);
	}, [visible, still, wallets]);

	const lg = size === "lg";
	const node = lg ? "size-11" : "size-7";
	const icon = lg ? "size-4" : "size-3";
	const claimed = Math.max(0, at + 1);
	// one coin per drawing: motion moves it from node to node by its layout id
	const coinId = useId();
	const coin = (
		<span
			className={cn(
				"pointer-events-none absolute inset-x-0 z-20 flex justify-center",
				lg ? "-top-4" : "-top-3",
			)}
		>
			<motion.span
				layoutId={coinId}
				transition={{ duration: still ? 0 : 0.5, ease: EASE }}
				className={cn(
					"rounded-full bg-testnet font-mono font-semibold text-background shadow-[0_0_0_3px_var(--surface)]",
					lg ? "px-1.5 py-0.5 text-[11px]" : "px-1 text-[9px] leading-4",
				)}
			>
				$1
			</motion.span>
		</span>
	);

	return (
		<div
			ref={ref}
			className={cn("relative min-w-0", className)}
			role="img"
			aria-label={`$1 of mainnet USDC passes through ${wallets} fresh wallets; each one claims about 1,000 testnet USDC for you.`}
		>
			<div className="relative flex items-center justify-between">
				{/* the line the dollar travels along */}
				<span
					aria-hidden
					className="absolute inset-x-[calc(var(--n)/2)] top-1/2 h-px -translate-y-1/2 bg-testnet/35"
					style={{ "--n": lg ? "2.75rem" : "1.75rem" } as React.CSSProperties}
				/>
				<span
					aria-hidden
					className={cn(
						"relative z-10 flex shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-muted-foreground",
						node,
					)}
				>
					<Wallet className={icon} />
					{at === -1 && coin}
				</span>
				{Array.from({ length: wallets }, (_, i) => {
					const lit = i <= at;
					return (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
							key={i}
							aria-hidden
							className="relative z-10 flex shrink-0 flex-col items-center"
						>
							<AnimatePresence>
								{i === at && (
									<motion.span
										key="drop"
										initial={{ opacity: 0, y: 0 }}
										animate={{ opacity: [0, 1, 1, 0], y: lg ? 26 : 18 }}
										transition={{ duration: 1.1, ease: EASE }}
										className={cn(
											"absolute top-full mt-0.5 font-mono font-semibold whitespace-nowrap text-brand",
											lg ? "text-[12px]" : "text-[10px]",
										)}
									>
										+1,000
									</motion.span>
								)}
							</AnimatePresence>
							<motion.span
								initial={false}
								animate={{
									scale: i === at ? [1, 1.14, 1] : 1,
								}}
								transition={{ duration: 0.45, ease: EASE }}
								className={cn(
									"flex items-center justify-center rounded-full border transition-colors duration-300",
									node,
									lit
										? "border-testnet bg-testnet/20 text-testnet"
										: "border-testnet/40 bg-surface text-testnet/60",
								)}
							>
								<Droplets className={icon} />
							</motion.span>
							{i === at && coin}
						</span>
					);
				})}
			</div>
			{lg && (
				<div className="mt-4 flex items-baseline justify-between gap-4 text-sm">
					<span className="text-muted-foreground">Testnet USDC so far</span>
					<motion.span
						key={claimed}
						initial={{ opacity: 0.4, y: 3 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.3 }}
						className="font-mono text-base font-semibold tabular-nums"
					>
						~{(claimed * 1000).toLocaleString("en-US")}
					</motion.span>
				</div>
			)}
		</div>
	);
}
