import {
	type Asset,
	classifyQuery,
	compareAcrossNetworks,
	infoClient,
	isSimilarMatch,
	type Network,
	outcomeIdOfQuery,
	type ResolvedMatch,
	relatedIdentities,
	resolveAsset,
} from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Boxes, GitCompare, RefreshCw, Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { MatchRow, matchKey } from "#/components/hub/asset";
import {
	EmptyState,
	Panel,
	TextInput,
	ToolPage,
} from "#/components/hub/layout";
import { Callout, ObservedLine } from "#/components/hub/status";
import { AssetDetail } from "#/components/tools/assets/AssetDetail";
import { CompareTable } from "#/components/tools/assets/CompareTable";
import {
	IdentifierLegend,
	QueryStrip,
	SettledOutcomeCard,
} from "#/components/tools/assets/Spellings";
import { Button } from "#/components/ui/button";
import { errorMessage, useMids, useUniverse } from "#/hooks/useHyperliquid";
import { tool } from "#/lib/tools";
import { useHandoffStore } from "#/store/handoffStore";
import { useNetwork } from "#/store/networkStore";

export const Route = createFileRoute("/tools/assets")({
	validateSearch: (
		s: Record<string, unknown>,
	): { q?: string; sample?: string } => ({
		// The router parses numeric search values as numbers; "100083061"
		// and "@107" must both survive as the typed string.
		q:
			typeof s.q === "string"
				? s.q
				: typeof s.q === "number"
					? String(s.q)
					: undefined,
		sample: typeof s.sample === "string" ? s.sample : undefined,
	}),
	head: () => ({ meta: [{ title: "Asset Resolver — hl-tools" }] }),
	component: AssetsTool,
});

const SAMPLES: Record<string, string> = { hype: "HYPE" };

const EXAMPLES: Record<Network, string[]> = {
	mainnet: [
		"HYPE",
		"@107",
		"BTC",
		"xyz:TSLA",
		"110001",
		"0x0d01dc56dcaaca66ad901c959b4011ec",
	],
	testnet: ["HYPE", "@1035", "test:ABC", "110000", "xyz:TSLA", "BTC"],
};

const LEGEND_ID = "how-names-fit-together";

/**
 * A settled outcome is gone from outcomeMeta but its spec and result
 * persist; fetched only when an outcome-shaped query has no live match.
 */
function useSettledOutcome(network: Network, outcomeId: number | null) {
	return useQuery({
		queryKey: ["settledOutcome", network, outcomeId],
		queryFn: () => infoClient(network).settledOutcome(outcomeId as number),
		enabled: outcomeId !== null,
		staleTime: 24 * 60 * 60_000,
		retry: 1,
	});
}

function AssetsTool() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/tools/assets" });
	const network = useNetwork();
	const take = useHandoffStore((s) => s.take);
	const [query, setQuery] = useState(
		() => search.q ?? (search.sample ? (SAMPLES[search.sample] ?? "") : ""),
	);
	const [compare, setCompare] = useState(false);
	// The selection holds the match itself (not just a key) so a related
	// identity that isn't in the result list can be shown in place.
	const [selected, setSelected] = useState<{
		network: Network;
		match: ResolvedMatch;
	} | null>(null);
	const deferred = useDeferredValue(query);

	useEffect(() => {
		const handed = take("assets");
		if (handed) setQuery(handed);
	}, [take]);

	const universe = useUniverse(network);
	const mids = useMids(network);
	const other: Network = network === "mainnet" ? "testnet" : "mainnet";
	const otherUniverse = useUniverse(other);

	const resolution = useMemo(
		() =>
			universe.data && deferred.trim()
				? resolveAsset(universe.data, deferred)
				: null,
		[universe.data, deferred],
	);

	// Identities never carry across networks: drop a selection made on the other network.
	const activeSelection =
		selected && selected.network === network ? selected.match : null;
	// Similar names (UBTC for "BTC") are suggestions, listed apart from what
	// the query directly means; a single direct identity is selected for you.
	const direct = resolution?.matches.filter((m) => !isSimilarMatch(m)) ?? [];
	const similar = resolution?.matches.filter(isSimilarMatch) ?? [];
	const onlyMatch = direct.length === 1 ? direct[0] : undefined;
	const selectedMatch: ResolvedMatch | undefined = activeSelection ?? onlyMatch;
	const selectedKey = selectedMatch ? matchKey(selectedMatch) : null;

	const hip3Dex =
		selectedMatch?.kind === "asset" && selectedMatch.asset.venue.kind === "hip3"
			? selectedMatch.asset.venue.dex
			: "";
	const hip3Mids = useMids(network, hip3Dex, hip3Dex !== "");
	const midFor = (a: Asset): string | null =>
		(a.venue.kind === "hip3"
			? hip3Mids.data?.data[a.coin]
			: mids.data?.data[a.coin]) ?? null;

	const related = useMemo(
		() =>
			universe.data && selectedMatch
				? relatedIdentities(universe.data, selectedMatch)
				: [],
		[universe.data, selectedMatch],
	);

	// Outcome-shaped query (#…, +…, 100000000+…) with no live match → settled?
	const queryOutcome = useMemo(
		() => classifyQuery(deferred).outcome,
		[deferred],
	);
	const settledId =
		resolution && resolution.matches.length === 0 && queryOutcome
			? outcomeIdOfQuery(deferred)
			: null;
	const settled = useSettledOutcome(network, settledId);

	const compareRows = useMemo(() => {
		if (!compare || !universe.data || !otherUniverse.data || !deferred.trim())
			return null;
		const a = resolveAsset(universe.data, deferred);
		const b = resolveAsset(otherUniverse.data, deferred);
		return network === "mainnet"
			? compareAcrossNetworks(a as never, b as never)
			: compareAcrossNetworks(b as never, a as never);
	}, [compare, universe.data, otherUniverse.data, deferred, network]);

	const commit = (q: string) => {
		setQuery(q);
		setSelected(null);
		void navigate({ search: { q: q || undefined }, replace: true });
	};
	const pick = (m: ResolvedMatch) => setSelected({ network, match: m });

	const matchRow = (m: ResolvedMatch) => (
		<li key={matchKey(m)}>
			<MatchRow
				match={m}
				mid={
					m.kind === "asset" && m.asset.venue.kind !== "hip3"
						? (mids.data?.data[m.asset.coin] ?? null)
						: null
				}
				selected={selectedKey === matchKey(m)}
				onSelect={() => pick(m)}
			/>
		</li>
	);

	return (
		<ToolPage tool={tool("assets")}>
			<div className="space-y-5">
				<form
					className="flex flex-col gap-3 sm:flex-row sm:items-end"
					onSubmit={(e) => {
						e.preventDefault();
						commit(query.trim());
					}}
				>
					<div className="min-w-0 flex-1 space-y-1.5">
						<label htmlFor="asset-query" className="text-xs font-medium">
							Symbol, coin, asset ID, token index, token ID or EVM address
						</label>
						<div className="relative">
							<Search
								className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
								aria-hidden
							/>
							<TextInput
								id="asset-query"
								mono
								value={query}
								onChange={(e) => {
									setQuery(e.target.value);
									setSelected(null);
								}}
								placeholder="HYPE · @107 · xyz:TSLA · #12090 · 110001"
								className="h-10 pl-9"
							/>
						</div>
					</div>
					<div className="flex gap-2">
						<Button type="submit" variant="brand" className="h-10">
							Resolve
						</Button>
						<Button
							type="button"
							variant="outline"
							className="h-10"
							aria-pressed={compare}
							onClick={() => setCompare((c) => !c)}
						>
							<GitCompare className="size-4" aria-hidden />
							{compare ? "Hide comparison" : "Compare networks"}
						</Button>
					</div>
				</form>
				<div className="flex flex-wrap items-center gap-1.5 text-xs">
					<span className="text-muted-foreground">Try on {network}:</span>
					{[
						...EXAMPLES[network],
						// Outcomes rotate, so the example comes from live metadata.
						...(universe.data?.assets.find((a) => a.outcome)?.coin
							? [universe.data.assets.find((a) => a.outcome)?.coin as string]
							: []),
					].map((ex) => (
						<button
							key={ex}
							type="button"
							onClick={() => commit(ex)}
							className="max-w-[16rem] truncate rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-foreground/90 hover:border-border-strong hover:bg-surface-2"
						>
							{ex}
						</button>
					))}
				</div>

				<QueryStrip query={deferred} legendId={LEGEND_ID} />

				{universe.isError ? (
					<Callout
						tone="danger"
						title={`Could not load ${network} metadata`}
						action={
							<Button
								size="sm"
								variant="outline"
								onClick={() => universe.refetch()}
							>
								<RefreshCw className="size-3.5" /> Retry
							</Button>
						}
					>
						{errorMessage(universe.error)} The resolver needs perpDexs,
						allPerpMetas and spotMeta from the info API.
					</Callout>
				) : null}

				{universe.data && (
					<ObservedLine
						network={network}
						observedAt={universe.data.observedAt}
						source={`${universe.data.assets.length.toLocaleString()} identities · ${universe.data.dexes.length} perp dexes · ${universe.data.tokens.length.toLocaleString()} tokens`}
					/>
				)}

				{compare && deferred.trim() && (
					<Panel
						title="Mainnet vs testnet"
						description="Paired by symbol, never by ID — IDs are exactly what differ. Highlighted cells differ between networks."
					>
						{compareRows ? (
							compareRows.length ? (
								<CompareTable rows={compareRows} />
							) : (
								<Callout
									tone="unknown"
									title="No identity matches on either network"
								/>
							)
						) : (
							<div className="h-24 animate-pulse rounded-md bg-surface-2" />
						)}
					</Panel>
				)}

				{!deferred.trim() ? (
					<EmptyState
						icon={Boxes}
						title="Resolve any Hyperliquid identifier"
						description="One asset has several spellings — a coin string for info and WebSocket, an asset ID for orders, a token for balances, a display symbol for the app — and every ID differs between mainnet and testnet. Enter any of them to see all of them, and what each is used for."
						sample="HYPE  →  HYPE perp (a=159) · @107 spot (a=10107) · token 150 …"
						action={
							<Button
								size="sm"
								variant="outline"
								onClick={() => commit("HYPE")}
							>
								Try with a sample
							</Button>
						}
					/>
				) : universe.isLoading ? (
					<div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
						<div className="h-80 animate-pulse rounded-lg border border-border bg-surface" />
						<div className="h-80 animate-pulse rounded-lg border border-border bg-surface" />
					</div>
				) : resolution ? (
					<div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
						<Panel
							title={
								<span>
									{direct.length} match
									{direct.length === 1 ? "" : "es"}
									{similar.length
										? ` · ${similar.length} similar name${similar.length === 1 ? "" : "s"}`
										: ""}
									{resolution.truncated
										? ` (+${resolution.truncated} more)`
										: ""}
								</span>
							}
							description={
								<span className="font-mono">
									“{resolution.normalizedQuery}” on {network}
								</span>
							}
							bodyClassName="p-0"
						>
							{resolution.ambiguous && (
								<div className="border-b border-border p-3">
									<Callout
										tone="warning"
										title="Ambiguous — pick the identity you mean"
									>
										This query matches {direct.length} identities. Nothing is
										selected for you.
									</Callout>
								</div>
							)}
							{resolution.notes.length > 0 && (
								<ul className="space-y-1 border-b border-border px-4 py-3 text-xs text-muted-foreground">
									{resolution.notes.map((n) => (
										<li key={n}>{n}</li>
									))}
								</ul>
							)}
							{resolution.matches.length === 0 ? (
								<div className="p-4">
									{settledId !== null && settled.data?.data ? (
										<Callout
											tone="warning"
											title={`Outcome ${settledId} is not live on ${network} — it has settled`}
										>
											Its spec and settlement result are shown on the right.
										</Callout>
									) : settledId !== null && settled.isLoading ? (
										<Callout
											tone="neutral"
											title="Not live — checking whether it settled…"
										/>
									) : (
										<Callout
											tone="unknown"
											title={`No identity matches on ${network}`}
										>
											{settledId !== null
												? `Outcome ${settledId} is neither live nor settled on ${network}. `
												: ""}
											Identifiers are network-specific: try{" "}
											<button
												type="button"
												className="underline"
												onClick={() => setCompare(true)}
											>
												comparing networks
											</button>
											, or check the spelling of a HIP-3 dex prefix.
										</Callout>
									)}
								</div>
							) : (
								<div className="scrollbar-thin max-h-[36rem] overflow-y-auto">
									{direct.length === 0 && (
										<p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
											Nothing is named exactly “{resolution.normalizedQuery}” on{" "}
											{network}; these names contain it.
										</p>
									)}
									<ul aria-label="Matches">{direct.map(matchRow)}</ul>
									{similar.length > 0 && (
										<>
											{direct.length > 0 && (
												<div className="border-y border-border bg-surface-2/60 px-4 py-1.5 text-2xs font-medium uppercase tracking-wider text-subtle-foreground">
													Similar names
												</div>
											)}
											<ul aria-label="Similar names">
												{similar.map(matchRow)}
											</ul>
										</>
									)}
								</div>
							)}
						</Panel>
						<Panel
							title="Identity"
							description={
								!selectedMatch
									? "Select a match to see every spelling of it."
									: resolution.matches.some((m) => matchKey(m) === selectedKey)
										? undefined
										: `Related to “${resolution.normalizedQuery}”, not one of its matches.`
							}
						>
							{selectedMatch ? (
								<AssetDetail
									key={`${network}:${matchKey(selectedMatch)}`}
									match={selectedMatch}
									mid={
										selectedMatch.kind === "asset"
											? midFor(selectedMatch.asset)
											: null
									}
									related={related}
									onPick={pick}
								/>
							) : settledId !== null && settled.data?.data ? (
								<SettledOutcomeCard
									settled={settled.data.data}
									observedAt={settled.data.observedAt}
									side={queryOutcome?.side ?? null}
								/>
							) : settledId !== null && settled.isError ? (
								<Callout tone="danger" title="Could not query settledOutcome">
									{errorMessage(settled.error)}
								</Callout>
							) : (
								<EmptyState
									title={
										resolution.matches.length ? "Nothing selected" : "No match"
									}
									description={
										direct.length
											? "Choose one of the matches. The resolver never picks for you when a query is ambiguous."
											: resolution.matches.length
												? "Pick a similar name to see its spellings, or refine the query."
												: "Try another spelling, or compare networks."
									}
								/>
							)}
						</Panel>
					</div>
				) : null}

				<div className="pt-4">
					<IdentifierLegend id={LEGEND_ID} />
				</div>
			</div>
		</ToolPage>
	);
}
