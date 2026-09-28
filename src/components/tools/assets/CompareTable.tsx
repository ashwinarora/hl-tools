import type { CrossNetworkRow, ResolvedMatch } from "@hl-tools/core";
import { KindBadge, matchKind } from "#/components/hub/asset";
import { NetworkBadge, Pill } from "#/components/hub/status";
import { cn } from "#/lib/utils";

function cells(m: ResolvedMatch | null): Record<string, string> {
	if (!m) return {};
	if (m.kind === "token") {
		return {
			id: `token ${m.token.index}`,
			coin: m.token.name,
			sz: String(m.token.szDecimals),
			px: "—",
			extra: `wei ${m.token.weiDecimals}`,
		};
	}
	const a = m.asset;
	return {
		id: String(a.actionAssetId),
		coin: a.coin,
		sz: a.szDecimals === null ? "unknown" : String(a.szDecimals),
		px: a.pxDecimals === null ? "unknown" : String(a.pxDecimals),
		extra:
			a.spotPairIndex !== undefined
				? `pair ${a.spotPairIndex} · base token ${a.baseToken?.index}`
				: a.venue.kind === "hip3"
					? `dex ${a.venue.dexIndex}`
					: a.maxLeverage !== undefined
						? `${a.maxLeverage}×`
						: "",
	};
}

const COLS: { key: string; label: string; diff: string[] }[] = [
	{ key: "coin", label: "coin", diff: ["coin", "token index"] },
	{ key: "id", label: "asset ID", diff: ["action asset ID", "token index"] },
	{ key: "sz", label: "szDec", diff: ["szDecimals"] },
	{ key: "px", label: "pxDec", diff: ["max px decimals"] },
	{
		key: "extra",
		label: "indexes",
		diff: ["spot pair index", "base token index", "max leverage"],
	},
];

export function CompareTable({ rows }: { rows: CrossNetworkRow[] }) {
	return (
		<div className="scrollbar-thin overflow-x-auto rounded-lg border border-border">
			<table className="w-full min-w-[720px] border-collapse text-sm">
				<thead>
					<tr className="border-b border-border bg-surface-2 text-left text-xs text-muted-foreground">
						<th className="px-3 py-2 font-medium">Identity</th>
						<th className="px-3 py-2 font-medium" colSpan={COLS.length}>
							<NetworkBadge network="mainnet" />
						</th>
						<th
							className="border-l border-border px-3 py-2 font-medium"
							colSpan={COLS.length}
						>
							<NetworkBadge network="testnet" />
						</th>
					</tr>
					<tr className="border-b border-border text-left font-mono text-2xs uppercase tracking-wide text-subtle-foreground">
						<th className="px-3 py-1.5" />
						{COLS.map((c) => (
							<th key={`m-${c.key}`} className="px-3 py-1.5 font-medium">
								{c.label}
							</th>
						))}
						{COLS.map((c, i) => (
							<th
								key={`t-${c.key}`}
								className={cn(
									"px-3 py-1.5 font-medium",
									i === 0 && "border-l border-border",
								)}
							>
								{c.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => {
						const m = cells(r.mainnet);
						const t = cells(r.testnet);
						const any = r.mainnet ?? r.testnet;
						return (
							<tr
								key={r.label + (any ? matchKind(any) : "")}
								className="border-b border-border last:border-b-0"
							>
								<td className="px-3 py-2">
									<div className="flex items-center gap-2">
										{any && <KindBadge kind={matchKind(any)} />}
										<span className="font-medium">{r.label}</span>
									</div>
								</td>
								{([m, t] as const).map((side, sIdx) =>
									COLS.map((c, i) => {
										const missing = sIdx === 0 ? !r.mainnet : !r.testnet;
										if (missing) {
											return i === 0 ? (
												<td
													key={`${sIdx === 0 ? "mainnet" : "testnet"}-${c.key}`}
													colSpan={COLS.length}
													className={cn(
														"px-3 py-2",
														sIdx === 1 && "border-l border-border",
													)}
												>
													<Pill tone="unknown">
														not on {sIdx === 0 ? "mainnet" : "testnet"}
													</Pill>
												</td>
											) : null;
										}
										const differs = c.diff.some((d) =>
											r.differences.includes(d),
										);
										return (
											<td
												key={`${sIdx === 0 ? "mainnet" : "testnet"}-${c.key}`}
												className={cn(
													"px-3 py-2 font-mono text-xs",
													i === 0 && sIdx === 1 && "border-l border-border",
													differs && "bg-warning-soft text-foreground",
												)}
											>
												{side[c.key] || "—"}
											</td>
										);
									}),
								)}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
