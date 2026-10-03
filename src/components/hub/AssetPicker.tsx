import {
	type Asset,
	isSimilarMatch,
	type Network,
	resolveAsset,
} from "@hl-tools/core";
import { Search, X } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { useUniverse } from "#/hooks/useHyperliquid";
import { KindBadge, MatchRow, matchKey } from "./asset";
import { TextInput } from "./layout";
import { NetworkBadge } from "./status";

/**
 * Pick a tradeable asset through the resolver. A single match is picked
 * automatically; several matches are listed and nothing is chosen until the
 * user clicks one.
 */
export function AssetPicker({
	network,
	value,
	onChange,
	label = "Market",
	placeholder = "BTC · HYPE/USDC · xyz:TSLA · #12090",
	initialQuery = "",
}: {
	network: Network;
	value: Asset | null;
	onChange: (a: Asset | null) => void;
	label?: string;
	placeholder?: string;
	initialQuery?: string;
}) {
	const id = useId();
	const universe = useUniverse(network);
	const [query, setQuery] = useState(initialQuery);
	const deferred = useDeferredValue(query);
	const matches = useMemo(() => {
		if (!universe.data || !deferred.trim()) return [];
		return resolveAsset(universe.data, deferred, { limit: 30 }).matches.filter(
			(m) => m.kind === "asset",
		);
	}, [universe.data, deferred]);
	// What the query names directly vs. markets whose name merely contains it.
	const direct = matches.filter((m) => !isSimilarMatch(m));
	const similar = matches.filter(isSimilarMatch);

	if (value && value.network === network) {
		return (
			<div className="space-y-1.5">
				<div className="text-xs font-medium">{label}</div>
				<div className="flex min-w-0 items-center gap-2.5 rounded-md border border-border-strong bg-surface px-3 py-2">
					<KindBadge kind={value.venue.kind} />
					<div className="min-w-0 flex-1">
						<div className="truncate font-mono text-sm font-medium">
							{value.coin}
						</div>
						<div className="truncate text-xs text-muted-foreground">
							{value.displaySymbol} · a={value.actionAssetId} · szDecimals{" "}
							{value.szDecimals ?? "unknown"}
						</div>
					</div>
					<NetworkBadge network={value.network} />
					<button
						type="button"
						onClick={() => onChange(null)}
						className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
						aria-label="Change market"
					>
						<X className="size-4" />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-1.5">
			<label htmlFor={id} className="text-xs font-medium">
				{label}
			</label>
			<div className="relative">
				<Search
					className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
					aria-hidden
				/>
				<TextInput
					id={id}
					mono
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={placeholder}
					className="pl-9"
					onKeyDown={(e) => {
						if (
							e.key === "Enter" &&
							direct.length === 1 &&
							direct[0]?.kind === "asset"
						) {
							e.preventDefault();
							onChange(direct[0].asset);
						}
					}}
				/>
			</div>
			{value && value.network !== network && (
				<p className="text-xs text-warning">
					{value.coin} was picked on {value.network}; identifiers don't carry
					across networks — pick again on {network}.
				</p>
			)}
			{universe.isError && (
				<p className="text-xs text-danger">
					Could not load {network} metadata.
				</p>
			)}
			{deferred.trim() && universe.data && (
				<div className="scrollbar-thin max-h-72 overflow-y-auto rounded-md border border-border bg-surface">
					{matches.length === 0 ? (
						<p className="px-3 py-2.5 text-xs text-muted-foreground">
							No tradeable market matches “{deferred}” on {network}.
						</p>
					) : (
						<>
							{direct.length > 1 && (
								<p className="border-b border-border bg-warning-soft px-3 py-1.5 text-xs text-foreground">
									{direct.length} markets match — pick one.
								</p>
							)}
							{direct.length === 1 && (
								<p className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
									Press Enter to pick{" "}
									{direct[0]?.kind === "asset" ? direct[0].asset.coin : ""}.
								</p>
							)}
							<ul aria-label="Matching markets">
								{direct.map((m) =>
									m.kind === "asset" ? (
										<li key={matchKey(m)}>
											<MatchRow
												match={m}
												selected={false}
												onSelect={() => onChange(m.asset)}
											/>
										</li>
									) : null,
								)}
							</ul>
							{similar.length > 0 && (
								<>
									<div className="border-y border-border bg-surface-2/60 px-3 py-1 text-2xs font-medium uppercase tracking-wider text-subtle-foreground">
										Similar names
									</div>
									<ul aria-label="Similar markets">
										{similar.map((m) =>
											m.kind === "asset" ? (
												<li key={matchKey(m)}>
													<MatchRow
														match={m}
														selected={false}
														onSelect={() => onChange(m.asset)}
													/>
												</li>
											) : null,
										)}
									</ul>
								</>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}
