import {
	type Asset,
	assetSnippets,
	MAX_DECIMALS,
	parseOutcomeDescription,
	type RelatedIdentity,
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
import { RelatedRow, SpellingsTable } from "./Spellings";

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
	if (a.venue.kind === "hip3") {
		if (a.venue.deployer)
			items.push({
				label: "Dex deployer",
				value: a.venue.deployer,
				mono: true,
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
		{ label: "Full name", value: t.fullName ?? "—" },
		{
			label: "szDecimals",
			value: String(t.szDecimals),
			mono: true,
			hint: "lot size of spot pairs quoting this token",
		},
		{
			label: "weiDecimals",
			value: String(t.weiDecimals),
			mono: true,
			hint: "raw amounts in transfers and CoreWriter are × 10^weiDecimals",
		},
		{ label: "Canonical", value: t.isCanonical ? "yes" : "no" },
	];
}

type Tab = "identity" | "snippets" | "raw";

export function AssetDetail({
	match,
	mid,
	related,
	onPick,
}: {
	match: ResolvedMatch;
	mid: string | null;
	related: readonly RelatedIdentity[];
	onPick: (m: ResolvedMatch) => void;
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
					<div className="space-y-1.5">
						<div className="text-xs font-medium text-muted-foreground">
							Every spelling of this {a ? a.venue.kind : "token"}
						</div>
						<SpellingsTable match={match} />
					</div>
					<RelatedRow related={related} onPick={onPick} />
					<div className="space-y-2 border-t border-border pt-4">
						<div className="text-xs font-medium text-muted-foreground">
							{a ? "Trading rules" : "Token"}
						</div>
						<KeyValueGrid
							items={a ? assetFields(a, mid) : tokenFields(t as TokenRef)}
						/>
					</div>
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
