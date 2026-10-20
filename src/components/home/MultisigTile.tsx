import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, FileSignature, Plus } from "lucide-react";
import { LINKS } from "#/components/home/facts";
import { TreasuryMock } from "#/components/home/mocks/TreasuryMock";
import { useReturning } from "#/components/home/useReturning";
import { cn } from "#/lib/utils";
import { useNetwork } from "#/store/networkStore";
import { MULTISIG_TILE } from "./copy";
import { PendingCard } from "./PendingCard";
import { BTN_BRAND, BTN_OUTLINE, TEXT_LINK } from "./ui";

/**
 * The flagship tile: what it is and why it is the easy way, the two ways in
 * (create one, add one you already sign for), a note that testnet works the
 * same, and a picture of a friends' treasury beside one of its proposals,
 * which collects its last signature and is sent as you watch.
 */
export function MultisigTile({ className }: { className?: string }) {
	const returning = useReturning();
	// the wizard takes its network from its link: the one in the header now
	const network = useNetwork();
	return (
		<article
			aria-labelledby="c-multisig"
			className={cn(
				"c2-rise c2-tile relative isolate flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-border-strong bg-surface",
				className,
			)}
		>
			<div
				aria-hidden
				className="pointer-events-none absolute -top-40 -right-24 -z-10 size-[560px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_14%,transparent),transparent)] dark:bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_16%,transparent),transparent)]"
			/>

			<div className="p-6 sm:px-8 sm:pt-7">
				<p className="flex items-center gap-2.5 text-sm font-medium">
					<span className="flex size-7 items-center justify-center rounded-lg bg-brand text-brand-foreground">
						<FileSignature className="size-4" aria-hidden />
					</span>
					{MULTISIG_TILE.label}
				</p>
				<h2
					id="c-multisig"
					className="mt-4 text-balance text-[28px] leading-[1.06] font-semibold tracking-[-0.03em] sm:text-[34px]"
				>
					{MULTISIG_TILE.title}
				</h2>
				<p className="mt-3 max-w-[62ch] text-pretty text-[15px] leading-relaxed text-muted-foreground">
					{MULTISIG_TILE.pitch}
				</p>
				<ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
					{MULTISIG_TILE.points.map((p) => (
						<li key={p} className="flex items-center gap-1.5">
							<Check className="size-3.5 text-brand" aria-hidden />
							{p}
						</li>
					))}
				</ul>

				<div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
					<Link
						to="/multisig/create"
						search={{ network }}
						className={BTN_BRAND}
					>
						<Plus className="size-4" aria-hidden />
						{MULTISIG_TILE.create}
					</Link>
					<Link to="/multisig/add" className={BTN_OUTLINE}>
						{MULTISIG_TILE.add}
					</Link>
					{returning && (
						<Link to={LINKS.multisig} className={cn(TEXT_LINK, "sm:ml-2")}>
							{MULTISIG_TILE.returning}
							<ArrowRight className="size-3.5" aria-hidden />
						</Link>
					)}
				</div>
				<p className="mt-3 flex items-start gap-2 text-[13px] text-muted-foreground">
					<span
						aria-hidden
						className="mt-[5px] size-2 shrink-0 rounded-full bg-testnet"
					/>
					{MULTISIG_TILE.testnet}
				</p>
			</div>

			{/* the treasury's window runs off the tile; one of its proposals sits on it */}
			<div
				inert
				className="pointer-events-none relative mt-2 min-h-[440px] flex-1 select-none sm:mt-4 md:min-h-[330px]"
			>
				<div className="absolute top-0 right-4 left-4 overflow-hidden rounded-t-xl border border-b-0 border-border-strong bg-background sm:right-8 sm:left-8">
					<div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
						<span className="flex gap-1.5" aria-hidden>
							<span className="size-2.5 rounded-full bg-border-strong" />
							<span className="size-2.5 rounded-full bg-border-strong" />
							<span className="size-2.5 rounded-full bg-border-strong" />
						</span>
						<span className="ml-2 truncate rounded-md bg-background px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
							hltools.tech/multisig
						</span>
					</div>
					<TreasuryMock pending={false} />
				</div>
				<PendingCard className="absolute z-10 right-6 bottom-6 w-[min(300px,calc(100%-3rem))] sm:right-12 sm:bottom-7" />
				{/* the window fades into the tile at the bottom edge */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-surface via-surface/80 to-transparent"
				/>
			</div>
		</article>
	);
}
