import {
	classifyQuery,
	IDENTIFIER_FAMILIES,
	type IdentifierFamily,
	identitySpellings,
	type Network,
	type RelatedIdentity,
	type ResolvedMatch,
	type SettledOutcome,
	USED_IN_LABEL,
	type UsedIn,
} from "@hl-tools/core";
import { ArrowRight, BookOpen } from "lucide-react";
import { KindBadge, matchKind } from "#/components/hub/asset";
import { CopyButton } from "#/components/hub/CopyButton";
import { KeyValueGrid } from "#/components/hub/layout";
import {
	Callout,
	NetworkBadge,
	ObservedLine,
	Pill,
} from "#/components/hub/status";
import { cn } from "#/lib/utils";

const FAMILY_TONE: Record<IdentifierFamily, string> = {
	coin: "border-info/40 text-info",
	"asset-id": "border-brand/45 text-brand",
	display: "border-border-strong text-muted-foreground",
	token: "border-success/40 text-success",
	"outcome-encoding": "border-unknown/45 text-unknown",
};

export function FamilyBadge({ family }: { family: IdentifierFamily }) {
	const spec = IDENTIFIER_FAMILIES.find((f) => f.family === family);
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center rounded border px-1.5 font-mono text-2xs font-medium uppercase tracking-wide",
				FAMILY_TONE[family],
			)}
		>
			{spec?.title ?? family}
		</span>
	);
}

/** "Used in" chips: API word first, plain words on hover. */
export function UsedInChips({ usedIn }: { usedIn: readonly UsedIn[] }) {
	return (
		<span className="flex flex-wrap gap-1">
			{usedIn.map((u) => (
				<span
					key={u}
					title={USED_IN_LABEL[u].plain}
					className={cn(
						"inline-flex h-5 items-center rounded border px-1.5 font-mono text-2xs",
						u === "frontend"
							? "border-dashed border-border-strong text-muted-foreground"
							: "border-border text-foreground/80",
					)}
				>
					{USED_IN_LABEL[u].api}
				</span>
			))}
		</span>
	);
}

/**
 * What the typed query is, by shape alone: shown before any network call
 * so a malformed or ambiguous input is explained even with zero results.
 */
export function QueryStrip({
	query,
	legendId,
}: {
	query: string;
	legendId: string;
}) {
	const c = classifyQuery(query);
	if (c.shape === "empty") return null;
	return (
		<div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs">
			<span className="flex shrink-0 items-center gap-2">
				<span className="text-muted-foreground">You typed</span>
				<span className="font-medium">{c.title}</span>
				{c.family && <FamilyBadge family={c.family} />}
			</span>
			<span className="min-w-0 basis-full text-muted-foreground sm:flex-1 sm:basis-auto">
				{c.explanation}{" "}
				<a href={`#${legendId}`} className="text-foreground hover:underline">
					How names fit together
				</a>
			</span>
			{c.derived.length > 0 && (
				<span className="flex w-full flex-wrap gap-1.5 font-mono">
					{c.derived.map((d) => (
						<span
							key={d.label}
							className="inline-flex items-baseline gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5"
						>
							<span className="text-subtle-foreground">{d.label}</span>
							<span className="text-foreground">{d.value}</span>
						</span>
					))}
				</span>
			)}
		</div>
	);
}

/** Every spelling of one identity: spelling · value · used in. */
export function SpellingsTable({ match }: { match: ResolvedMatch }) {
	const rows = identitySpellings(match);
	return (
		<div className="scrollbar-thin overflow-x-auto rounded-md border border-border">
			<table className="w-full min-w-[520px] border-collapse text-sm">
				<thead>
					<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
						<th className="px-3 py-1.5 font-medium">spelling</th>
						<th className="px-3 py-1.5 font-medium">value</th>
						<th className="px-3 py-1.5 font-medium">used in</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr
							key={r.label}
							className="border-b border-border/60 align-top last:border-0"
						>
							<td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
								{r.label}
							</td>
							<td className="px-3 py-2">
								<div className="flex min-w-0 items-start gap-1.5">
									<code className="min-w-0 break-all font-mono text-[13px] text-foreground">
										{r.value}
									</code>
									<CopyButton value={r.value} size="xs" />
								</div>
								{r.note && (
									<div className="mt-0.5 text-2xs text-subtle-foreground">
										{r.note}
									</div>
								)}
							</td>
							<td className="px-3 py-2">
								<UsedInChips usedIn={r.usedIn} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

const RELATION_LABEL: Record<RelatedIdentity["relation"], string> = {
	perp: "perp",
	hip3: "HIP-3 perp",
	spot: "spot pair",
	token: "token",
	"other-side": "other side",
	"same-question": "same question",
};

/** The same asset on other venues, as chips that re-select in place. */
export function RelatedRow({
	related,
	onPick,
}: {
	related: readonly RelatedIdentity[];
	onPick: (m: ResolvedMatch) => void;
}) {
	if (related.length === 0) return null;
	return (
		<div className="space-y-2">
			<div className="text-xs font-medium text-muted-foreground">
				Same asset elsewhere
			</div>
			<div className="flex flex-wrap gap-1.5">
				{related.map((r) => {
					const m = r.match;
					const label = m.kind === "asset" ? m.asset.coin : `${m.token.name}`;
					const detail =
						m.kind === "asset"
							? m.asset.displaySymbol
							: `token ${m.token.index}`;
					return (
						<button
							key={`${r.relation}:${label}`}
							type="button"
							onClick={() => onPick(m)}
							className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-left text-xs hover:border-border-strong hover:bg-surface-2"
							title={`Show every spelling of ${label}`}
						>
							<KindBadge kind={matchKind(m)} className="w-12" />
							<span className="font-mono text-foreground">{label}</span>
							<span className="text-muted-foreground">{detail}</span>
							<span className="text-2xs text-subtle-foreground">
								{RELATION_LABEL[r.relation]}
							</span>
							<ArrowRight
								className="size-3 text-subtle-foreground"
								aria-hidden
							/>
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** The legend: five families, where each is used, how each is derived. */
export function IdentifierLegend({ id }: { id: string }) {
	return (
		<section id={id} className="scroll-mt-20 space-y-3">
			<div className="flex items-center gap-2">
				<BookOpen className="size-4 text-brand" aria-hidden />
				<h2 className="text-base font-semibold">
					How Hyperliquid names things
				</h2>
			</div>
			<p className="max-w-3xl text-sm text-muted-foreground">
				Every tradeable thing has several spellings, and each spelling is
				accepted in exactly one place. The prefixes are the coin-string column:{" "}
				<code className="font-mono">@</code> spot pair by index,{" "}
				<code className="font-mono">#</code> outcome coin,{" "}
				<code className="font-mono">+</code> outcome token,{" "}
				<code className="font-mono">dex:</code> HIP-3 perp. A bare number is an
				asset ID, but the same number also exists as a spot pair index, a token
				index and an outcome ID — four separate index spaces.
			</p>
			<ul className="space-y-2 sm:hidden">
				{IDENTIFIER_FAMILIES.map((f) => (
					<li
						key={f.family}
						className="space-y-2 rounded-lg border border-border bg-surface p-3"
					>
						<FamilyBadge family={f.family} />
						<p className="text-xs text-muted-foreground">{f.summary}</p>
						<div className="flex flex-wrap gap-1">
							{f.examples.map((e) => (
								<code
									key={e}
									className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs"
								>
									{e}
								</code>
							))}
						</div>
						<UsedInChips usedIn={f.usedIn} />
						<p className="text-xs text-muted-foreground">{f.derivation}</p>
					</li>
				))}
			</ul>
			<div className="scrollbar-thin hidden overflow-x-auto rounded-lg border border-border sm:block">
				<table className="w-full min-w-[760px] border-collapse text-sm">
					<thead>
						<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
							<th className="px-3 py-2 font-medium">family</th>
							<th className="px-3 py-2 font-medium">looks like</th>
							<th className="px-3 py-2 font-medium">used in</th>
							<th className="px-3 py-2 font-medium">how it is derived</th>
						</tr>
					</thead>
					<tbody>
						{IDENTIFIER_FAMILIES.map((f) => (
							<tr
								key={f.family}
								className="border-b border-border/60 align-top last:border-0"
							>
								<td className="px-3 py-2.5">
									<div className="mb-1">
										<FamilyBadge family={f.family} />
									</div>
									<div className="text-xs text-muted-foreground">
										{f.summary}
									</div>
								</td>
								<td className="px-3 py-2.5">
									<div className="flex flex-wrap gap-1">
										{f.examples.map((e) => (
											<code
												key={e}
												className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs"
											>
												{e}
											</code>
										))}
									</div>
								</td>
								<td className="px-3 py-2.5">
									<UsedInChips usedIn={f.usedIn} />
								</td>
								<td className="px-3 py-2.5 text-xs text-muted-foreground">
									{f.derivation}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

/** A HIP-4 outcome that has settled: not in outcomeMeta any more, but its spec and result persist. */
export function SettledOutcomeCard({
	settled,
	observedAt,
	side,
}: {
	settled: SettledOutcome;
	observedAt: number;
	side: 0 | 1 | null;
}) {
	const spec = settled.parsedDescription;
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<KindBadge kind="outcome" />
					<div className="min-w-0">
						<div className="truncate font-mono text-base font-semibold">
							outcome {settled.outcomeId}
						</div>
						<div className="truncate text-xs text-muted-foreground">
							{settled.name}
						</div>
					</div>
				</div>
				<Pill tone="warning">settled</Pill>
			</div>
			<ObservedLine
				network={settled.network as Network}
				observedAt={observedAt}
				source="settledOutcome"
			/>
			<Callout tone="info" title="This outcome is no longer live">
				Settled outcomes leave <code>outcomeMeta</code>, and their book, mids
				and candles are no longer served. The spec and the settlement result
				stay available through <code>settledOutcome</code>, which is what is
				shown here.
			</Callout>
			<div className="scrollbar-thin overflow-x-auto rounded-md border border-border">
				<table className="w-full min-w-[520px] border-collapse text-sm">
					<thead>
						<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
							<th className="px-3 py-1.5 font-medium">side</th>
							<th className="px-3 py-1.5 font-medium">coin</th>
							<th className="px-3 py-1.5 font-medium">token</th>
							<th className="px-3 py-1.5 font-medium">asset ID</th>
							<th className="px-3 py-1.5 font-medium">paid per share</th>
						</tr>
					</thead>
					<tbody>
						{settled.sides.map((s) => (
							<tr
								key={s.side}
								className={cn(
									"border-b border-border/60 font-mono text-xs last:border-0",
									side === s.side && "bg-brand-soft",
								)}
							>
								<td className="px-3 py-2">
									{s.side} · {s.name}
									{side === s.side && (
										<span className="ml-1.5 font-sans text-2xs text-muted-foreground">
											(you asked for this side)
										</span>
									)}
								</td>
								<td className="px-3 py-2">{s.coin}</td>
								<td className="px-3 py-2">{s.token}</td>
								<td className="px-3 py-2">{s.actionAssetId}</td>
								<td className="px-3 py-2">
									{s.payout} {settled.quoteToken}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<KeyValueGrid
				items={[
					{
						label: "Network",
						value: <NetworkBadge network={settled.network as Network} />,
					},
					{
						label: "Settle fraction",
						value: settled.settleFraction,
						mono: true,
						hint: "Yes shares convert to this many quote tokens, No shares to 1 − it",
					},
					{
						label: "Details",
						value: settled.details || "—",
						mono: true,
					},
					{
						label: "Venue",
						value: settled.venue ?? "—",
						mono: true,
					},
					{
						label: "Specification",
						value: spec ? (
							<span className="font-mono text-xs">
								{Object.entries(spec).map(([k, v]) => (
									<span key={k} className="mr-3 inline-block">
										<span className="text-muted-foreground">{k}:</span> {v}
									</span>
								))}
							</span>
						) : (
							settled.description || "—"
						),
					},
				]}
			/>
		</div>
	);
}
