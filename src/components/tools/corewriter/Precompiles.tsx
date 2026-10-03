import {
	type AssetUniverse,
	describeFailure,
	encodePrecompileInput,
	type Network,
	networkConfig,
	PRECOMPILES,
	type PrecompileQuery,
	type PrecompileSpec,
	type PrecompileUnits,
	precompileGas,
	queryPrecompile,
} from "@hl-tools/core";
import { ChevronDown, Loader2, Play } from "lucide-react";
import { useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import { IndexSearch } from "#/components/hub/IndexSearch";
import { Field, TextInput } from "#/components/hub/layout";
import { Callout, ObservedLine } from "#/components/hub/status";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

const DEFAULT_USER: Record<Network, string> = {
	// HLP vault (exists on HyperCore with positions and balances).
	mainnet: "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303",
	// A testnet contract that sends CoreWriter actions.
	testnet: "0x4418ed2e9cccc6e32ffbd803b507dd3e4243aa15",
};

function defaults(
	spec: PrecompileSpec,
	network: Network,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const p of spec.params) {
		switch (p.kind) {
			case "address":
				out[p.name] =
					p.name === "vault"
						? "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"
						: DEFAULT_USER[network];
				break;
			case "perp":
			case "asset":
			case "dex":
				out[p.name] = "0";
				break;
			case "spot":
				out[p.name] = network === "mainnet" ? "107" : "1035";
				break;
			case "token":
				out[p.name] = network === "mainnet" ? "150" : "1105";
				break;
		}
	}
	// USDC (token 0) is the balance most accounts actually hold.
	if (spec.key === "spotBalance") out.token = "0";
	if (spec.key === "vaultEquity" && network === "mainnet")
		out.user = "0x677d831aef5328190852e24f13c46cac05f984e7";
	if (spec.key === "delegations" || spec.key === "delegatorSummary")
		out.user =
			network === "mainnet"
				? "0x5ac99df645f3414876c816caa18b2d234024b487"
				: DEFAULT_USER[network];
	return out;
}

function unitsFor(
	spec: PrecompileSpec,
	inputs: Record<string, string>,
	u?: AssetUniverse<Network>,
): { units: PrecompileUnits; label: string | null } {
	if (!u) return { units: {}, label: null };
	const n = (k: string) => Number(inputs[k]);
	if (spec.params.some((p) => p.kind === "perp")) {
		const perp = u.assets.find(
			(a) => a.venue.kind === "perp" && a.perpIndex === n("perp"),
		);
		return perp
			? {
					units: { perpSzDecimals: perp.szDecimals ?? undefined },
					label: `${perp.coin} · szDecimals ${perp.szDecimals}`,
				}
			: { units: {}, label: `No perp ${inputs.perp} on ${u.network}` };
	}
	if (spec.key === "position2" || spec.key === "bbo") {
		const a = u.byActionId.get(n(spec.key === "bbo" ? "asset" : "perp"));
		if (!a || a.szDecimals === null)
			return {
				units: {},
				label: a
					? `${a.coin} · szDecimals unknown`
					: `No asset ${inputs.asset ?? inputs.perp} on ${u.network}`,
			};
		// Spot prices use 8 − szDecimals; express that through the perp formula (6 − x).
		const sz = a.venue.kind === "spot" ? a.szDecimals - 2 : a.szDecimals;
		return {
			units: { perpSzDecimals: sz },
			label: `${a.coin} · ${a.displaySymbol}`,
		};
	}
	if (spec.params.some((p) => p.kind === "spot")) {
		const s = u.spotByIndex.get(n("spot"));
		return s?.baseToken
			? {
					units: { spotBaseSzDecimals: s.baseToken.szDecimals },
					label: `${s.coin} · ${s.displaySymbol}`,
				}
			: { units: {}, label: `No spot pair ${inputs.spot} on ${u.network}` };
	}
	if (spec.params.some((p) => p.kind === "token")) {
		const t = u.tokensByIndex.get(n("token"));
		return t
			? {
					units: { tokenWeiDecimals: t.weiDecimals, tokenSymbol: t.name },
					label: `${t.name} · weiDecimals ${t.weiDecimals}`,
				}
			: { units: {}, label: `No token ${inputs.token} on ${u.network}` };
	}
	return { units: {}, label: null };
}

function PrecompileCard({
	spec,
	network,
	rpcUrl,
	universe,
}: {
	spec: PrecompileSpec;
	network: Network;
	rpcUrl: string;
	universe?: AssetUniverse<Network>;
}) {
	const [open, setOpen] = useState(false);
	const [inputs, setInputs] = useState<Record<string, string>>(() =>
		defaults(spec, network),
	);
	const [state, setState] = useState<{
		loading: boolean;
		result: PrecompileQuery | null;
		network: Network | null;
		url: string | null;
	}>({
		loading: false,
		result: null,
		network: null,
		url: null,
	});
	const enc = encodePrecompileInput(spec, inputs);
	const { units, label } = unitsFor(spec, inputs, universe);
	const run = async () => {
		if (!enc.data) return;
		setState((s) => ({ ...s, loading: true }));
		const result = await queryPrecompile(rpcUrl, spec, enc.data, units);
		setState({ loading: false, result, network, url: rpcUrl });
	};
	const res = state.result;
	const outLen =
		typeof res?.exchange.result === "string"
			? (res.exchange.result.length - 2) / 2
			: 0;
	return (
		<div className="min-w-0 rounded-lg border border-border bg-surface">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2/60"
			>
				<div className="min-w-0">
					<div className="text-sm font-semibold">{spec.name}</div>
					<div className="truncate font-mono text-2xs text-muted-foreground">
						{spec.address}
					</div>
				</div>
				<ChevronDown
					className={cn(
						"mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180",
					)}
					aria-hidden
				/>
			</button>
			{open && (
				<div className="space-y-3 border-t border-border px-4 py-3">
					<p className="text-xs text-muted-foreground">{spec.description}</p>
					{spec.params.map((p) => (
						<Field
							key={p.name}
							label={
								<span className="font-mono">
									{p.name}{" "}
									<span className="font-normal text-muted-foreground">
										{p.type}
									</span>
								</span>
							}
							htmlFor={`${spec.key}-${p.name}`}
							hint={p.description}
						>
							<TextInput
								id={`${spec.key}-${p.name}`}
								mono
								value={inputs[p.name] ?? ""}
								onChange={(e) =>
									setInputs({ ...inputs, [p.name]: e.target.value })
								}
							/>
							{(p.kind === "perp" ||
								p.kind === "spot" ||
								p.kind === "token" ||
								p.kind === "asset") &&
								universe && (
									<IndexSearch
										kind={p.kind}
										universe={universe}
										onPick={(index) =>
											setInputs({ ...inputs, [p.name]: String(index) })
										}
									/>
								)}
						</Field>
					))}
					{label && (
						<div className="font-mono text-2xs text-muted-foreground">
							resolves to: {label}
						</div>
					)}
					{enc.issues.length > 0 && (
						<p className="text-xs text-danger">{enc.issues[0]?.message}</p>
					)}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							variant="brand"
							onClick={run}
							disabled={!enc.data || state.loading}
						>
							{state.loading ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Play className="size-3.5" />
							)}
							Query live
						</Button>
						<span className="font-mono text-2xs text-muted-foreground">
							calldata{" "}
							{enc.data
								? `${enc.data.slice(0, 18)}${enc.data.length > 18 ? "…" : ""}`
								: "—"}
						</span>
					</div>
					{res && state.network && (
						<div className="space-y-3 border-t border-border pt-3">
							<ObservedLine
								network={state.network}
								observedAt={res.exchange.startedAt}
								source={`eth_call · ${res.exchange.durationMs} ms`}
							/>
							{res.exchange.failure ? (
								res.exchange.failure.kind === "rpc" ? (
									<Callout tone="danger" title="The precompile reverted">
										{describeFailure(res.exchange.failure)} Precompiles revert
										on invalid input (unknown asset, token, vault or user) and
										consume all gas passed to the call frame.
									</Callout>
								) : (
									<Callout tone="danger" title="Request failed">
										{describeFailure(res.exchange.failure)}
									</Callout>
								)
							) : res.decoded?.kind === "error" ? (
								<Callout tone="unknown" title="Unexpected output layout">
									{res.decoded.message}
								</Callout>
							) : res.decoded ? (
								<div className="scrollbar-thin overflow-x-auto rounded-md border border-border">
									<div className="border-b border-border bg-surface-2 px-3 py-1.5 text-xs font-medium">
										Decoded output
									</div>
									{res.decoded.kind === "array" &&
									res.decoded.rows.length === 0 ? (
										<p className="px-3 py-2 text-xs text-muted-foreground">
											Empty array — no entries for this input.
										</p>
									) : (
										<table className="w-full min-w-[420px] border-collapse font-mono text-xs">
											<thead>
												<tr className="border-b border-border text-2xs uppercase tracking-wider text-subtle-foreground">
													<th className="px-3 py-1.5 text-left font-medium">
														field
													</th>
													<th className="px-3 py-1.5 text-left font-medium">
														raw
													</th>
													<th className="px-3 py-1.5 text-left font-medium">
														human
													</th>
												</tr>
											</thead>
											<tbody>
												{(res.decoded.kind === "tuple"
													? [res.decoded.values]
													: res.decoded.rows
												).map((row, ri) =>
													row.map((v) => (
														<tr
															// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
															key={`${ri}-${v.name}`}
															className="border-b border-border/60 align-top last:border-0"
														>
															<td className="w-40 px-3 py-1.5 text-syn-key">
																{res.decoded?.kind === "array"
																	? `[${ri}].`
																	: ""}
																{v.name}
															</td>
															<td className="break-all px-3 py-1.5 text-muted-foreground">
																{v.raw}
															</td>
															<td className="break-all px-3 py-1.5">
																{v.human ?? ""}
																{v.note && (
																	<div className="text-2xs text-subtle-foreground">
																		{v.note}
																	</div>
																)}
															</td>
														</tr>
													)),
												)}
											</tbody>
										</table>
									)}
								</div>
							) : null}
							<details className="group">
								<summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
									Raw JSON-RPC request and response · gas ≈{" "}
									{precompileGas(
										((enc.data?.length ?? 2) - 2) / 2,
										outLen,
									).toLocaleString()}
								</summary>
								<CodeBlock
									className="mt-2"
									title="raw JSON-RPC"
									views={[
										{
											id: "req",
											label: "Request",
											content: JSON.stringify(res.exchange.request, null, 2),
										},
										{
											id: "res",
											label: "Response",
											content: JSON.stringify(
												res.exchange.response ?? null,
												null,
												2,
											),
										},
									]}
									maxHeight="14rem"
								/>
							</details>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function Precompiles({
	network,
	universe,
}: {
	network: Network;
	universe?: AssetUniverse<Network>;
}) {
	const [custom, setCustom] = useState("");
	const url = custom.trim() || networkConfig(network).evmRpcUrl;
	const customValid = !custom.trim() || /^https?:\/\/\S+$/.test(custom.trim());
	return (
		<div className="space-y-5">
			<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
				<Field
					label="JSON-RPC endpoint"
					htmlFor="pc-rpc"
					error={customValid ? undefined : "Enter an http(s) URL."}
					hint={`Default: public ${network} RPC (${networkConfig(network).evmRpcUrl}). A custom URL stays in this tab's memory only.`}
				>
					<TextInput
						id="pc-rpc"
						mono
						value={custom}
						onChange={(e) => setCustom(e.target.value)}
						placeholder={networkConfig(network).evmRpcUrl}
						data-private
					/>
				</Field>
			</div>
			<p className="text-xs text-muted-foreground">
				Read precompiles return HyperCore state as of the EVM block. Inputs and
				outputs are raw ABI without a function selector. Expand a precompile,
				adjust inputs and query it live.
			</p>
			<div className="grid min-w-0 gap-3 md:grid-cols-2">
				{PRECOMPILES.map((p) => (
					<PrecompileCard
						key={`${network}-${p.key}`}
						spec={p}
						network={network}
						rpcUrl={customValid ? url : networkConfig(network).evmRpcUrl}
						universe={universe}
					/>
				))}
			</div>
		</div>
	);
}
