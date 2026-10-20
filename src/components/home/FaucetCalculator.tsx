import { motion, useSpring, useTransform } from "motion/react";
import { useEffect, useId, useState } from "react";
import { cn } from "#/lib/utils";
import { FAUCET_BAND } from "./copy";

/**
 * The miner's arithmetic as one control: how many dollars of mainnet USDC go
 * in (one fresh wallet each, up to a run of 50), and what comes out. The
 * figures follow the faucet's how-to for a chain of N wallets: N + 1 USDC
 * leaves your balance ($N signed, $1 for activating the first wallet), ~$1
 * comes back from the last one, ~N × 1,000 testnet USDC arrives. The total
 * counts up as the slider moves.
 */
const MAX = 50;

export function FaucetCalculator({ className }: { className?: string }) {
	const id = useId();
	const [n, setN] = useState(5);
	const spring = useSpring(n * 1000, { stiffness: 140, damping: 22 });
	const shown = useTransform(
		spring,
		(v) => `~${(Math.round(v / 10) * 10).toLocaleString("en-US")}`,
	);
	useEffect(() => {
		spring.set(n * 1000);
	}, [n, spring]);

	const usd = (v: number) => `$${v.toLocaleString("en-US")}`;
	const fill = ((n - 1) / (MAX - 1)) * 100;

	return (
		<div
			className={cn(
				"rounded-2xl border border-testnet/30 bg-surface p-5 sm:p-6",
				className,
			)}
		>
			<label htmlFor={id} className="text-sm font-medium">
				{FAUCET_BAND.ask}
			</label>
			<div className="mt-1 text-[13px] text-muted-foreground">
				{FAUCET_BAND.askHint}
			</div>

			<div className="mt-5 flex items-center gap-4">
				<input
					id={id}
					type="range"
					min={1}
					max={MAX}
					step={1}
					value={n}
					onChange={(e) => setN(Number(e.target.value))}
					aria-valuetext={`${usd(n)} in, about ${(n * 1000).toLocaleString("en-US")} testnet USDC out`}
					className="c2-range h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-border-strong"
					style={{
						background: `linear-gradient(to right, var(--testnet) ${fill}%, var(--border-strong) ${fill}%)`,
					}}
				/>
				<span className="w-14 shrink-0 text-right font-mono text-lg font-semibold tabular-nums">
					{usd(n)}
				</span>
			</div>

			<div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
				<div>
					<div className="text-[13px] text-muted-foreground">
						{FAUCET_BAND.youGet}
					</div>
					<div className="flex items-baseline gap-2">
						<motion.span className="text-[clamp(2.4rem,5vw,3.25rem)] leading-none font-semibold tabular-nums tracking-[-0.04em]">
							{shown}
						</motion.span>
						<span className="whitespace-nowrap text-sm text-muted-foreground">
							testnet USDC
						</span>
					</div>
					<div className="mt-2 text-[13px] text-muted-foreground">
						{FAUCET_BAND.wallets(n)}
					</div>
				</div>
				<dl className="grid gap-1.5 text-[13px] sm:min-w-[11.5rem]">
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">{FAUCET_BAND.youPut}</dt>
						<dd className="font-mono tabular-nums">{usd(n + 1)}</dd>
					</div>
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">{FAUCET_BAND.back}</dt>
						<dd className="font-mono tabular-nums">~$1</dd>
					</div>
					<div className="flex justify-between gap-4 border-t border-border pt-1.5">
						<dt className="text-muted-foreground">{FAUCET_BAND.net}</dt>
						<dd className="font-mono font-semibold tabular-nums">~{usd(n)}</dd>
					</div>
				</dl>
			</div>
		</div>
	);
}
