import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Boxes,
	Droplets,
	FileSignature,
	GitBranch,
	Link2,
	ListChecks,
	Plus,
	Send,
	Users,
	Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { LINKS, MULTISIG } from "#/components/home/facts";
import { TEAL_TEXT } from "#/components/home/mocks/sample";
import { cn } from "#/lib/utils";
import { useNetwork } from "#/store/networkStore";
import { FAUCET_BAND, MULTISIG_BAND, MULTISIG_TILE } from "./copy";
import { FaucetCalculator } from "./FaucetCalculator";
import { FaucetFlow } from "./FaucetFlow";
import { ANSWERS, DIAGNOSTICS } from "./ToolsTile";
import { BTN_BRAND, BTN_INK, BTN_OUTLINE, TEXT_LINK } from "./ui";

/**
 * Below the bento, one band per product in the same order: a rail on the
 * left with the product's name in its own colour and its actions, the
 * substance on the right. Each band rises in as it scrolls into view
 * (`c2-reveal`, CSS only).
 */
export function Bands({ wrap }: { wrap: string }) {
	return (
		<div className="border-t border-border">
			<MultisigBand wrap={wrap} />
			<FaucetBand wrap={wrap} />
			<ToolsBand wrap={wrap} />
		</div>
	);
}

function Band({
	id,
	wrap,
	mark,
	title,
	lead,
	actions,
	children,
	className,
}: {
	id: string;
	wrap: string;
	mark: ReactNode;
	title: string;
	lead: ReactNode;
	actions: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			aria-labelledby={id}
			className={cn("border-b border-border", className)}
		>
			<div
				className={cn(
					wrap,
					"grid gap-10 py-14 sm:py-20 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-16",
				)}
			>
				<div className="c2-reveal min-w-0">
					<div className="lg:sticky lg:top-24">
						{mark}
						<h2
							id={id}
							className="mt-4 text-balance text-[26px] leading-[1.1] font-semibold tracking-[-0.025em] sm:text-[30px]"
						>
							{title}
						</h2>
						<div className="mt-3 text-pretty text-[15px] leading-relaxed text-muted-foreground">
							{lead}
						</div>
						<div className="mt-6 flex flex-col items-start gap-3">
							{actions}
						</div>
					</div>
				</div>
				<div className="c2-reveal min-w-0">{children}</div>
			</div>
		</section>
	);
}

function Mark({
	icon,
	label,
	tone,
}: {
	icon: ReactNode;
	label: string;
	tone: string;
}) {
	return (
		<p className="flex items-center gap-2.5 text-sm font-medium">
			<span
				className={cn(
					"flex size-7 items-center justify-center rounded-lg",
					tone,
				)}
			>
				{icon}
			</span>
			{label}
		</p>
	);
}

const WHY_ICONS = [Users, Send, Boxes, ListChecks, Link2, GitBranch] as const;

function MultisigBand({ wrap }: { wrap: string }) {
	const network = useNetwork();
	return (
		<Band
			id="c-band-multisig"
			wrap={wrap}
			mark={
				<Mark
					icon={<FileSignature className="size-4" aria-hidden />}
					label="Multisig"
					tone="bg-brand text-brand-foreground"
				/>
			}
			title={MULTISIG_BAND.title}
			lead={MULTISIG_BAND.lead}
			actions={
				<>
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
					<p className="flex items-start gap-2 text-[13px] text-muted-foreground">
						<span
							aria-hidden
							className="mt-[5px] size-2 shrink-0 rounded-full bg-testnet"
						/>
						{MULTISIG_TILE.testnet}
					</p>
					<Link to={LINKS.glossary} className={TEXT_LINK}>
						The words, explained
					</Link>
				</>
			}
		>
			<ol className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
				{MULTISIG_BAND.steps.map((s, i) => (
					<li key={s.title} className="bg-surface p-5">
						<span className="flex items-center gap-3">
							<span className="flex size-6 items-center justify-center rounded-full border border-brand/50 font-mono text-xs text-brand">
								{i + 1}
							</span>
							<span className={cn("text-base font-semibold", TEAL_TEXT)}>
								{s.title}
							</span>
						</span>
						<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
							{s.body}
						</p>
					</li>
				))}
			</ol>

			<h3 className="mt-12 text-sm font-medium">
				{MULTISIG_BAND.actionsTitle}
			</h3>
			<ul className="mt-3 flex flex-wrap gap-2">
				{MULTISIG.actions.map((a) => (
					<li
						key={a}
						className="rounded-full border border-border bg-surface px-3 py-1 text-[13px]"
					>
						{a}
					</li>
				))}
				<li className="flex items-center gap-1.5 rounded-full border border-dashed border-brand/55 px-3 py-1 text-[13px]">
					{MULTISIG_BAND.soon}
					<span className="rounded-full bg-brand-soft px-1.5 text-[10.5px] font-medium text-foreground">
						{MULTISIG_BAND.soonTag}
					</span>
				</li>
			</ul>

			<h3 className="mt-12 text-sm font-medium">{MULTISIG_BAND.whyTitle}</h3>
			<ul className="mt-4 grid gap-x-8 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
				{MULTISIG_BAND.why.map((w, i) => {
					const Icon = WHY_ICONS[i] ?? Users;
					return (
						<li key={w.title} className="min-w-0">
							<span className="flex size-9 items-center justify-center rounded-xl border border-brand/30 bg-brand-soft text-brand">
								<Icon className="size-4" aria-hidden />
							</span>
							<span className="mt-3 block text-[15px] font-semibold tracking-tight">
								{w.title}
							</span>
							<span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
								{w.title === "Open source" ? (
									<>
										{w.body}{" "}
										<a
											href={LINKS.repo}
											target="_blank"
											rel="noopener noreferrer"
											className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
										>
											See it on GitHub
										</a>
									</>
								) : (
									w.body
								)}
							</span>
						</li>
					);
				})}
			</ul>
		</Band>
	);
}

function FaucetBand({ wrap }: { wrap: string }) {
	return (
		<Band
			id="c-band-faucet"
			wrap={wrap}
			className="bg-[color-mix(in_oklch,var(--testnet)_5%,var(--background))]"
			mark={
				<Mark
					icon={<Droplets className="size-4" aria-hidden />}
					label="Testnet Faucet Miner"
					tone="bg-testnet text-background"
				/>
			}
			title={FAUCET_BAND.title}
			lead={FAUCET_BAND.lead}
			actions={
				<>
					<Link to={LINKS.faucet} className={BTN_INK}>
						{FAUCET_BAND.open}
						<ArrowRight className="size-4" aria-hidden />
					</Link>
					<Link to={LINKS.faucetHow} className={TEXT_LINK}>
						{FAUCET_BAND.how}
					</Link>
					<p className="text-[13px] text-muted-foreground">
						{FAUCET_BAND.needs}
					</p>
				</>
			}
		>
			<div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
				<FaucetCalculator />
				<figure className="flex flex-col justify-center rounded-2xl border border-border bg-surface p-5 sm:p-6">
					<FaucetFlow size="lg" />
					<figcaption className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
						Your $1 hops from one fresh wallet to the next. Each one claims its
						faucet drip and passes it on to you; the last one sends the $1 back.
					</figcaption>
				</figure>
			</div>

			<ul className="mt-8 grid gap-x-8 gap-y-6 md:grid-cols-3">
				{FAUCET_BAND.points.map((p) => (
					<li key={p.title} className="min-w-0">
						<span className="block text-[15px] font-semibold tracking-tight">
							{p.title}
						</span>
						<span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
							{p.body}
						</span>
					</li>
				))}
			</ul>
		</Band>
	);
}

function ToolsBand({ wrap }: { wrap: string }) {
	return (
		<Band
			id="c-band-tools"
			wrap={wrap}
			mark={
				<Mark
					icon={<Wrench className="size-4" aria-hidden />}
					label="Developer tools"
					tone="bg-surface-3 text-foreground"
				/>
			}
			title="Start from the error you see"
			lead="Eight read-only tools on one protocol core. None of them signs or sends anything."
			actions={
				<>
					<Link {...LINKS.lookAtTreasury} className={TEXT_LINK}>
						Look up any treasury's signers and balances
					</Link>
					<Link to={LINKS.changes} className={TEXT_LINK}>
						Every rule change, dated
					</Link>
				</>
			}
		>
			<ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
				{DIAGNOSTICS.map((t) => (
					<li key={t.id} className="min-w-0 bg-surface">
						<Link
							to={t.path}
							className="group flex h-full gap-4 p-5 transition-colors hover:bg-surface-2"
						>
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors group-hover:text-brand">
								<t.icon className="size-4" aria-hidden />
							</span>
							<span className="min-w-0">
								<span className="block text-[15px] font-semibold tracking-tight">
									{t.title}
								</span>
								<span className="mt-1 block font-mono text-xs leading-relaxed text-muted-foreground">
									{ANSWERS[t.id] ?? t.answers}
								</span>
							</span>
						</Link>
					</li>
				))}
			</ul>
		</Band>
	);
}
