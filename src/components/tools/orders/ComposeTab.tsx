import {
	type Asset,
	type ComposeInput,
	composeOrder,
	Decimal,
	type FieldLint,
	INTENTS,
	type Intent,
	type Network,
	type OrderPlan,
} from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpRight,
	Check,
	FileSearch,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AssetPicker } from "#/components/hub/AssetPicker";
import { CodeBlock } from "#/components/hub/CodeBlock";
import {
	EmptyState,
	Field,
	Panel,
	Segmented,
	TextInput,
	Workspace,
} from "#/components/hub/layout";
import { SequenceDiagram } from "#/components/hub/SequenceDiagram";
import {
	Callout,
	IssueList,
	ObservedLine,
	Pill,
} from "#/components/hub/status";
import { useMids, useUniverse } from "#/hooks/useHyperliquid";
import { cn } from "#/lib/utils";
import { useHandoffStore } from "#/store/handoffStore";

export interface ComposeState {
	intent: Intent;
	side: "buy" | "sell";
	size: string;
	price: string;
	entryType: "limit" | "market";
	slippage: string;
	tp: string;
	sl: string;
	tpslMarket: boolean;
	cloid: string;
	builderAddress: string;
	builderFee: string;
}

export const DEFAULT_COMPOSE: ComposeState = {
	intent: "long-tpsl",
	side: "buy",
	size: "",
	price: "",
	entryType: "limit",
	slippage: "0.05",
	tp: "",
	sl: "",
	tpslMarket: true,
	cloid: "",
	builderAddress: "",
	builderFee: "10",
};

const ROLE_LABEL: Record<OrderPlan["role"], string> = {
	entry: "Entry",
	"take-profit": "Take profit",
	"stop-loss": "Stop loss",
	close: "Close",
	order: "Order",
};

function LintCell({
	lint,
	onUse,
	label,
}: {
	lint: FieldLint;
	onUse?: (v: string) => void;
	label: string;
}) {
	return (
		<div className="min-w-0 space-y-1">
			<div className="flex flex-wrap items-center gap-1.5">
				{lint.valid ? (
					<Check
						className="size-3.5 shrink-0 text-success"
						aria-label="valid"
					/>
				) : (
					<X className="size-3.5 shrink-0 text-danger" aria-label="invalid" />
				)}
				<code className="break-all font-mono text-[13px]">
					{lint.wire ?? "—"}
				</code>
				{lint.input.trim() && lint.wire && lint.wire !== lint.input.trim() && (
					<span className="text-2xs text-muted-foreground">
						(typed {lint.input.trim()})
					</span>
				)}
			</div>
			{!lint.valid && lint.options.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{lint.options.map((o) => (
						<button
							key={o.direction}
							type="button"
							disabled={!onUse}
							onClick={() => onUse?.(o.value)}
							className="inline-flex items-center gap-1 rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-2xs hover:bg-surface-2 disabled:cursor-default disabled:opacity-80"
							title={`Use ${o.value} for ${label}`}
						>
							{o.direction === "down" ? (
								<ArrowDown className="size-3" />
							) : (
								<ArrowUp className="size-3" />
							)}
							{o.value}
							<span className="text-muted-foreground">
								({o.delta.startsWith("-") ? o.delta : `+${o.delta}`})
							</span>
						</button>
					))}
				</div>
			)}
			<div className="text-2xs text-subtle-foreground">{lint.rule}</div>
		</div>
	);
}

export function ComposeTab({
	network,
	asset,
	onAsset,
	state,
	onState,
}: {
	network: Network;
	asset: Asset | null;
	onAsset: (a: Asset | null) => void;
	state: ComposeState;
	onState: (s: ComposeState) => void;
}) {
	const send = useHandoffStore((s) => s.send);
	useUniverse(network);
	const dex = asset?.venue.kind === "hip3" ? asset.venue.dex : "";
	const mids = useMids(network, dex, !!asset);
	const mid =
		asset && asset.network === network
			? (mids.data?.data[asset.coin] ?? null)
			: null;
	const set = <K extends keyof ComposeState>(k: K, v: ComposeState[K]) =>
		onState({ ...state, [k]: v });
	const tpsl = state.intent === "long-tpsl" || state.intent === "short-tpsl";
	const needsPrice = !(
		state.intent === "market" ||
		state.intent === "reduce-only-close" ||
		(tpsl && state.entryType === "market")
	);
	const [prefilled, setPrefilled] = useState<string | null>(null);

	// Prefill a sensible size/price from the mid the first time a market is picked.
	useEffect(() => {
		if (!asset || !mid || prefilled === asset.coin) return;
		setPrefilled(asset.coin);
		if (state.size || state.price) return;
		const m = Decimal.tryParse(mid);
		if (!m || !m.isPositive()) return;
		// ~15 quote units of size, rounded up to a whole lot; prices at 5 sig figs.
		const size = Decimal.parse("15")
			.div(m, asset.szDecimals ?? 0, "ceil")
			.toString();
		const px = (f: string) =>
			m
				.mul(Decimal.parse(f))
				.roundToSignificantFigures(5, "half-even")
				.roundToDecimals(asset.pxDecimals ?? 8, "half-even")
				.toString();
		onState({
			...state,
			size,
			price: px("0.98"),
			tp: tpsl ? px("1.08") : "",
			sl: tpsl ? px("0.94") : "",
		});
	}, [asset, mid, prefilled, state, onState, tpsl]);

	const result =
		asset && asset.network === network
			? composeOrder({
					...(state as Omit<ComposeInput, "asset" | "mid">),
					asset,
					mid,
				} as ComposeInput)
			: null;
	const payload = result?.action
		? JSON.stringify(result.action, null, 2)
		: null;

	return (
		<Workspace
			input={
				<Panel
					title="Intent"
					description="Every value is linted before a payload is produced; nothing is rounded without you choosing it."
				>
					<div className="space-y-4">
						<AssetPicker
							network={network}
							value={asset}
							onChange={onAsset}
							initialQuery="BTC"
						/>
						{asset && mids.data && (
							<ObservedLine
								network={network}
								observedAt={mids.data.observedAt}
								source={mid ? `mid ${mid}` : "no mid for this market"}
							/>
						)}
						<div className="space-y-1.5">
							<div className="text-xs font-medium">What do you want to do?</div>
							<div
								className="grid gap-1.5"
								role="radiogroup"
								aria-label="Intent"
							>
								{INTENTS.map((i) => (
									// biome-ignore lint/a11y/useSemanticElements: ARIA radio pattern on buttons keeps the card styling
									<button
										key={i.id}
										type="button"
										role="radio"
										aria-checked={state.intent === i.id}
										onClick={() => set("intent", i.id)}
										className={cn(
											"rounded-md border px-3 py-2 text-left transition-colors",
											state.intent === i.id
												? "border-brand bg-brand-soft"
												: "border-border hover:border-border-strong hover:bg-surface-2",
										)}
									>
										<div className="text-sm font-medium">{i.label}</div>
										<div className="text-xs text-muted-foreground">
											{i.description}
										</div>
									</button>
								))}
							</div>
						</div>
						{!tpsl && (
							<Segmented
								label="Side"
								value={state.side}
								onChange={(v) => set("side", v)}
								options={[
									{
										value: "buy",
										label:
											state.intent === "reduce-only-close"
												? "Buy (close a short)"
												: "Buy",
									},
									{
										value: "sell",
										label:
											state.intent === "reduce-only-close"
												? "Sell (close a long)"
												: "Sell",
									},
								]}
							/>
						)}
						{tpsl && (
							<Segmented
								label="Entry type"
								value={state.entryType}
								onChange={(v) => set("entryType", v)}
								options={[
									{ value: "limit", label: "Limit entry (Gtc)" },
									{ value: "market", label: "Market entry (IOC)" },
								]}
							/>
						)}
						<div className="grid gap-3 sm:grid-cols-2">
							<Field
								label={`Size${asset ? ` (${asset.base})` : ""}`}
								htmlFor="c-size"
							>
								<TextInput
									id="c-size"
									mono
									inputMode="decimal"
									value={state.size}
									onChange={(e) => set("size", e.target.value)}
									placeholder="0.001"
								/>
							</Field>
							{needsPrice ? (
								<Field
									label={`Limit price${asset ? ` (${asset.quote})` : ""}`}
									htmlFor="c-price"
								>
									<TextInput
										id="c-price"
										mono
										inputMode="decimal"
										value={state.price}
										onChange={(e) => set("price", e.target.value)}
										placeholder="80000"
									/>
								</Field>
							) : (
								<Field
									label="Slippage"
									htmlFor="c-slip"
									hint="Fraction of mid, e.g. 0.05 = 5%"
								>
									<TextInput
										id="c-slip"
										mono
										inputMode="decimal"
										value={state.slippage}
										onChange={(e) => set("slippage", e.target.value)}
									/>
								</Field>
							)}
						</div>
						{tpsl && (
							<div className="grid gap-3 sm:grid-cols-2">
								<Field label="Take-profit trigger" htmlFor="c-tp">
									<TextInput
										id="c-tp"
										mono
										inputMode="decimal"
										value={state.tp}
										onChange={(e) => set("tp", e.target.value)}
										placeholder="optional"
									/>
								</Field>
								<Field label="Stop-loss trigger" htmlFor="c-sl">
									<TextInput
										id="c-sl"
										mono
										inputMode="decimal"
										value={state.sl}
										onChange={(e) => set("sl", e.target.value)}
										placeholder="optional"
									/>
								</Field>
								<div className="sm:col-span-2">
									<Segmented
										label="TP/SL execution"
										value={state.tpslMarket ? "market" : "limit"}
										onChange={(v) => set("tpslMarket", v === "market")}
										options={[
											{
												value: "market",
												label: "Market on trigger (10% slippage)",
											},
											{ value: "limit", label: "Limit at trigger price" },
										]}
									/>
								</div>
							</div>
						)}
						<details className="group rounded-md border border-border">
							<summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
								Advanced: cloid and builder fee
							</summary>
							<div className="space-y-3 border-t border-border p-3">
								<Field
									label="cloid (optional)"
									htmlFor="c-cloid"
									hint="16 bytes: 0x + 32 hex digits"
								>
									<TextInput
										id="c-cloid"
										mono
										value={state.cloid}
										onChange={(e) => set("cloid", e.target.value)}
										placeholder="0x…"
									/>
								</Field>
								<div className="grid gap-3 sm:grid-cols-2">
									<Field label="Builder address (optional)" htmlFor="c-builder">
										<TextInput
											id="c-builder"
											mono
											value={state.builderAddress}
											onChange={(e) => set("builderAddress", e.target.value)}
											placeholder="0x…"
										/>
									</Field>
									<Field
										label="Builder fee (tenths of a bp)"
										htmlFor="c-bfee"
										hint="10 = 1 bp; max 100 perps / 1000 spot"
									>
										<TextInput
											id="c-bfee"
											mono
											inputMode="numeric"
											value={state.builderFee}
											onChange={(e) => set("builderFee", e.target.value)}
										/>
									</Field>
								</div>
							</div>
						</details>
					</div>
				</Panel>
			}
			output={
				!asset || asset.network !== network ? (
					<EmptyState
						icon={FileSearch}
						title="Pick a market to compose an order"
						description="The composer resolves the market through the Asset Resolver, then lints every price and size against that market's tick and lot rules before producing a payload."
						sample="BTC · open long 0.001 @ 80000 with TP 90000 / SL 75000"
					/>
				) : result ? (
					<div className="space-y-5">
						<Panel
							title="Pre-flight"
							description="Exact wire representation of each field. Invalid values block the payload; pick a rounding explicitly."
							bodyClassName="p-0"
						>
							<ul className="divide-y divide-border sm:hidden">
								{result.orders.map((o, i) => (
									<li key={o.role} className="space-y-3 px-4 py-3">
										<div className="flex flex-wrap items-center gap-1.5">
											<span className="mr-1 text-sm font-medium">
												{ROLE_LABEL[o.role]}
											</span>
											<Pill tone={o.isBuy ? "success" : "danger"}>
												{o.isBuy ? "buy" : "sell"}
											</Pill>
											<Pill>
												{"limit" in o.kind
													? o.kind.limit.tif
													: `trigger ${o.kind.trigger.tpsl}`}
											</Pill>
											{o.reduceOnly && <Pill tone="info">reduce-only</Pill>}
										</div>
										<div>
											<div className="mb-1 text-2xs uppercase tracking-wide text-subtle-foreground">
												price (p)
											</div>
											<LintCell
												lint={o.price}
												label="price"
												onUse={
													o.derived
														? undefined
														: (v) =>
																set(
																	o.role === "take-profit"
																		? "tp"
																		: o.role === "stop-loss"
																			? "sl"
																			: "price",
																	v,
																)
												}
											/>
											{o.derived && (
												<div className="mt-1 text-2xs text-muted-foreground">
													{o.derived}
												</div>
											)}
										</div>
										{i === 0 && (
											<div>
												<div className="mb-1 text-2xs uppercase tracking-wide text-subtle-foreground">
													size (s)
												</div>
												<LintCell
													lint={o.size}
													label="size"
													onUse={(v) => set("size", v)}
												/>
											</div>
										)}
									</li>
								))}
							</ul>
							<div className="scrollbar-thin hidden overflow-x-auto sm:block">
								<table className="w-full min-w-[560px] border-collapse text-sm">
									<thead>
										<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
											<th className="px-4 py-2 font-medium">order</th>
											<th className="px-3 py-2 font-medium">price (p)</th>
											<th className="px-3 py-2 font-medium">size (s)</th>
										</tr>
									</thead>
									<tbody>
										{result.orders.map((o, i) => (
											<tr
												key={o.role}
												className="border-b border-border/60 align-top last:border-0"
											>
												<td className="px-4 py-3">
													<div className="text-sm font-medium">
														{ROLE_LABEL[o.role]}
													</div>
													<div className="mt-1 flex flex-wrap gap-1">
														<Pill tone={o.isBuy ? "success" : "danger"}>
															{o.isBuy ? "buy" : "sell"}
														</Pill>
														<Pill>
															{"limit" in o.kind
																? o.kind.limit.tif
																: `trigger ${o.kind.trigger.tpsl}`}
														</Pill>
														{o.reduceOnly && (
															<Pill tone="info">reduce-only</Pill>
														)}
													</div>
												</td>
												<td className="px-3 py-3">
													<LintCell
														lint={o.price}
														label="price"
														onUse={
															o.derived
																? undefined
																: (v) =>
																		set(
																			o.role === "take-profit"
																				? "tp"
																				: o.role === "stop-loss"
																					? "sl"
																					: "price",
																			v,
																		)
														}
													/>
													{o.derived && (
														<div className="mt-1 text-2xs text-muted-foreground">
															{o.derived}
														</div>
													)}
												</td>
												<td className="px-3 py-3">
													{i === 0 ? (
														<LintCell
															lint={o.size}
															label="size"
															onUse={(v) => set("size", v)}
														/>
													) : (
														<span className="text-xs text-muted-foreground">
															same as entry
														</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{result.notional && (
								<div
									className={cn(
										"flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-sm",
										result.notional.ok ? "" : "bg-danger-soft",
									)}
								>
									<span className="text-muted-foreground">
										Notional (price × size)
									</span>
									<span className="font-mono">
										{result.notional.notional.toString()} {asset.quote}{" "}
										<span className="text-xs text-muted-foreground">
											(min {result.notional.minimum.toString()})
										</span>
									</span>
								</div>
							)}
						</Panel>
						{result.orders[0]?.size.roundsToZero && (
							<Callout tone="danger" title="This size rounds to zero">
								{result.orders[0].size.issues[0]?.message}
							</Callout>
						)}
						<IssueList
							issues={result.issues.filter(
								(i) => i.code !== "sz.rounds_to_zero",
							)}
						/>
						{payload ? (
							<CodeBlock
								title="Exchange action (unsigned)"
								content={payload}
								footer={
									<Link
										to="/tools/signing"
										onClick={() => send("signing", payload)}
										className="inline-flex items-center gap-1 text-foreground hover:underline"
									>
										Inspect what signing this would hash{" "}
										<ArrowUpRight className="size-3" />
									</Link>
								}
							/>
						) : (
							<Callout
								tone="danger"
								title="No payload until the errors above are fixed"
							>
								The composer never emits a payload with values the exchange
								would reject or that you didn't choose.
							</Callout>
						)}
						<Panel
							title="What happens after acceptance"
							description="Simplified event sequence for this intent."
						>
							<SequenceDiagram
								participants={result.participants}
								steps={result.sequence}
							/>
						</Panel>
					</div>
				) : null
			}
		/>
	);
}
