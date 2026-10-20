import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Droplets, Info } from "lucide-react";
import { LINKS } from "#/components/home/facts";
import { cn } from "#/lib/utils";
import { FAUCET_TILE } from "./copy";
import { FaucetFlow } from "./FaucetFlow";
import { BTN_INK, TEXT_LINK } from "./ui";

/**
 * The faucet tile: the faucet's own limit first (the reason the miner
 * exists), then the exchange in plain sight, $1 of mainnet for ~$1,000 of
 * testnet, what the $1 is, and the chain of wallets that makes it happen.
 */
export function FaucetTile({ className }: { className?: string }) {
	return (
		<article
			aria-labelledby="c-faucet"
			style={{ "--c2-delay": "90ms" } as React.CSSProperties}
			className={cn(
				"c2-rise c2-tile relative isolate flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-testnet/35 bg-[color-mix(in_srgb,var(--testnet)_8%,var(--surface))] p-6 dark:bg-[color-mix(in_srgb,var(--testnet)_7%,var(--surface))]",
				className,
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<h2
					id="c-faucet"
					className="flex items-center gap-2.5 text-sm font-medium"
				>
					<span className="flex size-7 items-center justify-center rounded-lg bg-testnet text-background">
						<Droplets className="size-4" aria-hidden />
					</span>
					{FAUCET_TILE.label}
				</h2>
				<Link to={LINKS.faucetHow} className={cn(TEXT_LINK, "text-[13px]")}>
					{FAUCET_TILE.how}
				</Link>
			</div>

			<p className="mt-3 max-w-[48ch] text-pretty text-[14px] leading-relaxed text-muted-foreground">
				{FAUCET_TILE.problem}
			</p>

			<div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex items-end gap-3">
					<Amount value="$1" unit={FAUCET_TILE.from} />
					<ArrowRight
						className="mb-7 size-6 shrink-0 text-testnet sm:size-7"
						aria-hidden
					/>
					<Amount value="~$1,000" unit={FAUCET_TILE.to} />
				</div>
				<ul className="flex flex-col gap-1 pb-1 text-[13px]">
					{FAUCET_TILE.points.map((p) => (
						<li key={p} className="flex items-center gap-1.5">
							<Check className="size-3.5 text-testnet" aria-hidden />
							{p}
						</li>
					))}
				</ul>
			</div>

			<p className="mt-3 flex items-start gap-2 text-pretty text-[12.5px] leading-snug text-muted-foreground">
				<Info className="mt-px size-3.5 shrink-0 text-testnet" aria-hidden />
				{FAUCET_TILE.fee}
			</p>

			<div className="mt-auto flex flex-wrap items-center justify-between gap-x-5 gap-y-4 pt-4">
				<Link to={LINKS.faucet} className={BTN_INK}>
					{FAUCET_TILE.open}
					<ArrowRight className="size-4" aria-hidden />
				</Link>
				<FaucetFlow className="w-[min(100%,15rem)]" />
			</div>
		</article>
	);
}

function Amount({ value, unit }: { value: string; unit: string }) {
	return (
		<span className="flex min-w-0 flex-col">
			<span className="text-[clamp(2.3rem,3.8vw,3.25rem)] leading-[0.95] font-semibold tabular-nums tracking-[-0.045em]">
				{value}
			</span>
			<span className="mt-1.5 text-[13px] text-muted-foreground">{unit}</span>
		</span>
	);
}
