import { cn } from "#/lib/utils";
import { SAMPLE, TEAL_TEXT } from "./sample";

/**
 * A picture of a treasury's Overview as the Multisig section draws it:
 * title, network, "2 of 3", tabs, balances, signers and what is waiting.
 * Made-up data (`sample.ts`). Wrap it in `Frame`.
 */
export function TreasuryMock({
	className,
	pending = true,
}: {
	className?: string;
	/** false leaves the right half of the last row empty, for a card laid over it */
	pending?: boolean;
}) {
	const s = SAMPLE;
	return (
		<div className={cn("space-y-3 p-4 text-left sm:p-5", className)}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="truncate text-base font-semibold tracking-tight sm:text-lg">
						{s.name}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
						<span className="font-mono">{s.address}</span>
						<span className="inline-flex items-center gap-1 rounded-full border border-testnet/40 px-1.5 py-px text-[10px] text-testnet">
							<span className="size-1.5 rounded-full bg-testnet" aria-hidden />
							{s.network}
						</span>
						<span>
							{s.threshold} of {s.signers.length} signers
						</span>
					</div>
				</div>
				<span className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-brand-foreground">
					Propose an action
				</span>
			</div>

			<div className="flex gap-4 border-b border-border text-xs text-muted-foreground">
				<span className="-mb-px border-b-2 border-brand pb-1.5 font-medium text-foreground">
					Overview
				</span>
				<span className="pb-1.5">
					Pending{" "}
					<span className="rounded-full bg-brand-soft px-1.5 text-[10px] font-medium text-foreground">
						{s.pending.length}
					</span>
				</span>
				<span className="hidden pb-1.5 sm:inline">Staking</span>
				<span className="hidden pb-1.5 sm:inline">Vaults</span>
				<span className="pb-1.5">Signing log</span>
			</div>

			<section className="rounded-lg border border-border bg-surface">
				<div className="flex items-center justify-between border-b border-border px-3 py-2">
					<span className={cn("text-sm font-semibold", TEAL_TEXT)}>
						Balances
					</span>
					<span className="inline-flex items-center gap-1 text-[10px] text-success">
						<span className="size-1.5 rounded-full bg-success" aria-hidden />
						Live
					</span>
				</div>
				<div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
					{s.balances.map((b) => (
						<div
							key={b.label}
							className="flex min-w-0 items-baseline justify-between gap-2 px-3 py-2 sm:block sm:py-2.5"
						>
							<div className="truncate text-[11px] text-muted-foreground">
								{b.label}
							</div>
							<div className="mt-0.5 whitespace-nowrap font-mono text-sm tabular-nums sm:text-base">
								{b.value}{" "}
								<span className="text-[10px] text-muted-foreground">
									{b.unit}
								</span>
							</div>
						</div>
					))}
				</div>
			</section>

			<div className="grid gap-3 sm:grid-cols-2">
				<section className="rounded-lg border border-border bg-surface">
					<div className="flex items-center justify-between border-b border-border px-3 py-2">
						<span className={cn("text-sm font-semibold", TEAL_TEXT)}>
							Signers
						</span>
						<span className="rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
							{s.threshold} of {s.signers.length} must sign
						</span>
					</div>
					<ul className="divide-y divide-border">
						{s.signers.map((x) => (
							<li
								key={x.address}
								className="flex items-center justify-between px-3 py-1.5 text-xs"
							>
								<span>{x.name}</span>
								<span className="font-mono text-muted-foreground">
									{x.address}
								</span>
							</li>
						))}
					</ul>
				</section>
				{pending && (
					<section className="rounded-lg border border-border bg-surface">
						<div className="flex items-center justify-between border-b border-border px-3 py-2">
							<span className={cn("text-sm font-semibold", TEAL_TEXT)}>
								Pending
							</span>
							<span className="text-[10px] text-muted-foreground">
								{s.pending.length} waiting
							</span>
						</div>
						<ul className="divide-y divide-border">
							{s.pending.map((p) => (
								<li key={p.title} className="px-3 py-1.5 text-xs">
									<div className="flex items-center justify-between gap-2">
										<span className="truncate">{p.title}</span>
										<Pips signed={p.signed} of={s.threshold} />
									</div>
									<div className="truncate text-[11px] text-muted-foreground">
										{p.what}
									</div>
								</li>
							))}
						</ul>
					</section>
				)}
			</div>
		</div>
	);
}

/** "1 of 2" as two small bars, the section's way of counting signatures. */
export function Pips({ signed, of }: { signed: number; of: number }) {
	return (
		<span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
			<span className="flex gap-0.5" aria-hidden>
				{Array.from({ length: of }, (_, i) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
						key={i}
						className={cn(
							"h-1 w-3 rounded-full",
							i < signed ? "bg-brand" : "bg-border-strong",
						)}
					/>
				))}
			</span>
			{signed} of {of}
		</span>
	);
}
