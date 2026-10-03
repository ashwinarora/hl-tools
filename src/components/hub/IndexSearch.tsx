import { type AssetUniverse, type Network, resolveAsset } from "@hl-tools/core";
import { Search } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState } from "react";

/**
 * Fill an index parameter by name: nobody knows that HYPE is token 150 or
 * that @107 is spot pair 107. Resolves through the Asset Resolver, filtered
 * to the identities this parameter can take, and shows the index it maps to.
 */
export function IndexSearch({
	kind,
	universe,
	onPick,
}: {
	kind: "perp" | "spot" | "token" | "asset";
	universe: AssetUniverse<Network>;
	onPick: (index: number) => void;
}) {
	const id = useId();
	const [query, setQuery] = useState("");
	const deferred = useDeferredValue(query);
	const options = useMemo(() => {
		if (!deferred.trim()) return [];
		const out: { key: string; label: string; detail: string; index: number }[] =
			[];
		for (const m of resolveAsset(universe, deferred, { limit: 40 }).matches) {
			if (m.kind === "token") {
				if (kind === "token")
					out.push({
						key: `t${m.token.index}`,
						label: m.token.name,
						detail: m.token.fullName ?? "token",
						index: m.token.index,
					});
				continue;
			}
			const a = m.asset;
			if (
				kind === "perp" &&
				a.venue.kind === "perp" &&
				a.perpIndex !== undefined
			)
				out.push({
					key: a.coin,
					label: a.displaySymbol,
					detail: "perp",
					index: a.perpIndex,
				});
			else if (
				kind === "spot" &&
				a.venue.kind === "spot" &&
				a.spotPairIndex !== undefined
			)
				out.push({
					key: a.coin,
					label: a.displaySymbol,
					detail: `spot ${a.coin}`,
					index: a.spotPairIndex,
				});
			else if (kind === "asset")
				out.push({
					key: a.coin,
					label: a.displaySymbol,
					detail: a.venue.kind,
					index: a.actionAssetId,
				});
			else if (kind === "token" && a.venue.kind === "spot" && a.baseToken)
				out.push({
					key: `t${a.baseToken.index}`,
					label: a.baseToken.name,
					detail: `base of ${a.displaySymbol}`,
					index: a.baseToken.index,
				});
		}
		const seen = new Set<string>();
		return out
			.filter((o) => {
				if (seen.has(o.key)) return false;
				seen.add(o.key);
				return true;
			})
			.slice(0, 8);
	}, [deferred, kind, universe]);
	const noun = {
		perp: "perp",
		spot: "spot pair",
		token: "token",
		asset: "asset",
	}[kind];
	return (
		<div className="relative mt-1.5">
			<Search
				className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground"
				aria-hidden
			/>
			<input
				id={id}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={`Find ${noun} by name…`}
				aria-label={`Find ${noun} by name`}
				className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-2 text-xs outline-none placeholder:text-subtle-foreground focus-visible:border-brand"
				autoComplete="off"
			/>
			{deferred.trim() && (
				<ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-surface shadow-md">
					{options.length === 0 ? (
						<li className="px-2.5 py-1.5 text-xs text-muted-foreground">
							No {noun} matches “{deferred.trim()}” on {universe.network}.
						</li>
					) : (
						options.map((o) => (
							<li key={o.key}>
								<button
									type="button"
									onClick={() => {
										onPick(o.index);
										setQuery("");
									}}
									className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-2"
								>
									<span className="min-w-0 truncate">
										<span className="font-mono font-medium">{o.label}</span>
										<span className="ml-1.5 text-muted-foreground">
											{o.detail}
										</span>
									</span>
									<span className="shrink-0 font-mono text-muted-foreground">
										→ {o.index}
									</span>
								</button>
							</li>
						))
					)}
				</ul>
			)}
		</div>
	);
}
