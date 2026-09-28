import {
	type Asset,
	assetSnippets,
	MAX_DECIMALS,
	parseOutcomeDescription,
	type ResolvedMatch,
	type TokenRef,
} from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { KindBadge, matchKind, matchTitle } from "#/components/hub/asset";
import { CodeBlock } from "#/components/hub/CodeBlock";
import { KeyValueGrid, type KV, Segmented } from "#/components/hub/layout";
import {
	Callout,
	IssueList,
	NetworkBadge,
	Pill,
} from "#/components/hub/status";

function pretty(v: unknown): string {
	return JSON.stringify(v, null, 2);
}

function venueLabel(a: Asset): string {
	switch (a.venue.kind) {
		case "perp":
			return "Perp · first perp dex";
		case "hip3":
			return `HIP-3 perp dex "${a.venue.dex}"${a.venue.dexFullName ? ` (${a.venue.dexFullName})` : ""}`;
		case "spot":
			return "Spot order book";
		case "outcome":
			return "HIP-4 outcome";
	}
}

function assetIdFormula(a: Asset): string {
	switch (a.venue.kind) {
		case "perp":
			return `index in meta.universe = ${a.actionAssetId}`;
		case "hip3":
			return `100000 + dex ${a.venue.dexIndex} × 10000 + index ${a.perpIndex} = ${a.actionAssetId}`;
		case "spot":
			return `10000 + spot index ${a.spotPairIndex} = ${a.actionAssetId}`;
		case "outcome":
			return `100000000 + (10 × outcome ${a.outcome?.outcomeId} + side ${a.outcome?.side}) = ${a.actionAssetId}`;
	}
}

function tokenLine(t: TokenRef) {
	return (
		<span>
			<span className="text-foreground">{t.name}</span>{" "}
			<span className="text-muted-foreground">
				· index {t.index} · szDecimals {t.szDecimals} · weiDecimals{" "}
				{t.weiDecimals}
			</span>
		</span>
	);
}

function assetFields(a: Asset, mid: string | null): KV[] {
	const items: KV[] = [
		{ label: "Network", value: <NetworkBadge network={a.network} /> },
		{ label: "Venue", value: venueLabel(a) },
		{
			label: "Origin",
			value:
				a.origin === "native"
					? "Native HyperCore"
					: a.origin === "hip3"
						? "HIP-3 (builder-deployed)"
						: "HIP-4 (outcome market)",
		},
		{
			label: "Info / WS coin",
			value: a.coin,
			mono: true,
			hint: "Use this string in info requests and subscriptions.",
		},
		{
			label: "Action asset ID (a)",
			value: String(a.actionAssetId),
			mono: true,
			hint: assetIdFormula(a),
		},
		{ label: "Base / quote", value: `${a.base} / ${a.quote}`, mono: true },
	];
	if (a.szDecimals === null) {
		items.push({
			label: "szDecimals / px decimals",
			value: <Pill tone="unknown">unknown</Pill>,
			hint: "outcomeMeta does not publish size decimals for outcome tokens; prices follow spot rules (MAX_DECIMALS 8, 5 significant figures).",
		});
	} else {
		const venueKind = a.venue.kind;
		items.push({
			label: "szDecimals (lot size)",
			value: String(a.szDecimals),
			mono: true,
			hint: `lot = ${a.szDecimals === 0 ? "1" : `0.${"0".repeat(a.szDecimals - 1)}1`}`,
		});
		items.push({
			label: "Max price decimals",
			value: String(a.pxDecimals),
			mono: true,
			hint: `${MAX_DECIMALS[venueKind]} (${venueKind === "spot" || venueKind === "outcome" ? "spot" : "perp"}) − szDecimals ${a.szDecimals}, and ≤ 5 significant figures`,
		});
	}
	if (a.perpIndex !== undefined)
		items.push({
			label: "Perp index in dex universe",
			value: String(a.perpIndex),
			mono: true,
		});
	if (a.venue.kind === "hip3") {
		items.push({
			label: "Perp dex index",
			value: String(a.venue.dexIndex),
			mono: true,
		});
		if (a.venue.deployer)
			items.push({
				label: "Dex deployer",
				value: a.venue.deployer,
				mono: true,
			});
	}
	if (a.spotPairIndex !== undefined) {
		items.push({
			label: "Spot pair index",
			value: String(a.spotPairIndex),
			mono: true,
			hint: `coin "@${a.spotPairIndex}"${a.isCanonical ? " (canonical name also accepted)" : ""}`,
		});
	}
	if (a.baseToken)
		items.push({
			label: "Base token",
			value: tokenLine(a.baseToken),
			mono: true,
			hint: `tokenId ${a.baseToken.tokenId}`,
		});
	if (a.quoteToken)
		items.push({
			label: "Quote token",
			value: tokenLine(a.quoteToken),
			mono: true,
		});
	if (a.baseToken?.evmContract) {
		items.push({
			label: "Linked EVM contract",
			value: a.baseToken.evmContract.address,
			mono: true,
			hint: `evmExtraWeiDecimals ${a.baseToken.evmContract.evmExtraWeiDecimals}`,
		});
	}
	if (a.maxLeverage !== undefined)
		items.push({
			label: "Max leverage",
			value: `${a.maxLeverage}×${a.onlyIsolated ? " · isolated only" : ""}`,
			mono: true,
		});
	if (a.isDelisted)
		items.push({
			label: "Status",
			value: <Pill tone="warning">delisted</Pill>,
		});
	if (a.outcome) {
		items.push({
			label: "Outcome",
			value: `${a.outcome.outcomeId} · side ${a.outcome.side} (${a.outcome.sideName})`,
			mono: true,
			hint: `encoding ${a.outcome.encoding} · token ${a.outcome.tokenName}`,
		});
		if (a.outcome.questionName)
			items.push({
				label: "Question",
				value: `${a.outcome.questionName} (#${a.outcome.questionId})`,
			});
		const parsed = parseOutcomeDescription(a.outcome.description);
		items.push({
			label: "Specification",
			value: parsed ? (
				<span className="font-mono text-xs">
					{Object.entries(parsed).map(([k, v]) => (
						<span key={k} className="mr-3 inline-block">
							<span className="text-muted-foreground">{k}:</span> {v}
						</span>
					))}
				</span>
			) : (
				a.outcome.description || "—"
			),
		});
	}
	items.push({
		label: "Mid price",
		value: mid ?? <span className="text-muted-foreground">not in allMids</span>,
		mono: true,
		hint: mid ? "from allMids (refreshes every 15 s)" : undefined,
	});
	return items;
}

function tokenFields(t: TokenRef): KV[] {
	return [
		{ label: "Network", value: <NetworkBadge network={t.network} /> },
		{
			label: "Token index",
			value: String(t.index),
			mono: true,
			hint: "Used by spotSend/sendAsset token strings and CoreWriter token fields.",
		},
		{ label: "Name", value: t.name, mono: true },
		{ label: "Full name", value: t.fullName ?? "—" },
		{ label: "szDecimals", value: String(t.szDecimals), mono: true },
		{ label: "weiDecimals", value: String(t.weiDecimals), mono: true },
		{ label: "tokenId", value: t.tokenId, mono: true },
		{
			label: "Token string",
			value: `${t.name}:${t.tokenId}`,
			mono: true,
			hint: "Format expected by spotSend / sendAsset.",
		},
		{
			label: "Linked EVM contract",
			value: t.evmContract ? t.evmContract.address : "not linked",
			mono: true,
			hint: t.evmContract
				? `evmExtraWeiDecimals ${t.evmContract.evmExtraWeiDecimals}`
				: undefined,
		},
		{ label: "Canonical", value: t.isCanonical ? "yes" : "no" },
	];
}

type Tab = "identity" | "snippets" | "raw";

export function AssetDetail({
	match,
	mid,
	relatedPairs,
}: {
	match: ResolvedMatch;
	mid: string | null;
	relatedPairs?: Asset[];
}) {
	const [tab, setTab] = useState<Tab>("identity");
	const a = match.kind === "asset" ? match.asset : null;
	const t = match.kind === "token" ? match.token : null;
	const snippets = a ? assetSnippets(a, mid) : null;
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<KindBadge kind={matchKind(match)} />
					<div className="min-w-0">
						<div className="truncate font-mono text-base font-semibold">
							{a ? a.coin : t?.name}
						</div>
						<div className="truncate text-xs text-muted-foreground">
							{matchTitle(match)}
						</div>
					</div>
				</div>
				<Segmented<Tab>
					label="Detail view"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "identity", label: "Identity" },
						...(a ? [{ value: "snippets" as Tab, label: "Snippets" }] : []),
						{ value: "raw", label: "Raw metadata" },
					]}
				/>
			</div>
			{tab === "identity" && (
				<>
					<KeyValueGrid
						items={a ? assetFields(a, mid) : tokenFields(t as TokenRef)}
					/>
					{t && relatedPairs && relatedPairs.length > 0 && (
						<div className="space-y-2 border-t border-border pt-4">
							<div className="text-xs font-medium text-muted-foreground">
								Spot pairs using {t.name} ({relatedPairs.length})
							</div>
							<div className="flex flex-wrap gap-1.5">
								{relatedPairs.slice(0, 24).map((p) => (
									<span
										key={p.coin}
										className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs"
									>
										{p.coin}{" "}
										<span className="text-muted-foreground">
											{p.displaySymbol}
										</span>
									</span>
								))}
							</div>
						</div>
					)}
				</>
			)}
			{tab === "snippets" && snippets && a && (
				<div className="space-y-4">
					<CodeBlock
						title="REST · l2Book info request"
						views={[
							{
								id: "json",
								label: "JSON",
								content: pretty(snippets.restInfo.body),
								lang: "json",
							},
							{
								id: "curl",
								label: "curl",
								content: snippets.restInfo.curl,
								lang: "bash",
							},
						]}
					/>
					<CodeBlock
						title="WebSocket · subscription message"
						content={pretty(snippets.wsSubscribe)}
					/>
					{snippets.order.action ? (
						<CodeBlock
							title="Minimal order action (unsigned)"
							content={pretty(snippets.order.action)}
							footer={
								<span className="flex flex-wrap items-center justify-between gap-2">
									<span>{snippets.order.explanation}</span>
									<Link
										to="/tools/orders"
										className="inline-flex items-center gap-1 text-foreground hover:underline"
									>
										Compose in Order Composer <ArrowRight className="size-3" />
									</Link>
								</span>
							}
						/>
					) : null}
					<IssueList issues={snippets.order.issues} />
				</div>
			)}
			{tab === "raw" && (
				<CodeBlock
					title={
						a
							? "Source metadata objects (as returned by the info API)"
							: "spotMeta.tokens entry"
					}
					content={pretty(a ? a.raw : t)}
				/>
			)}
			{a?.venue.kind === "outcome" && tab === "identity" && (
				<Callout tone="info" title="Outcomes use their own identifiers">
					Trade with asset <code>{a.actionAssetId}</code>, query books with coin{" "}
					<code>{a.coin}</code>, and look for balances under token{" "}
					<code>{a.base}</code>.
				</Callout>
			)}
		</div>
	);
}
