import {
	COREWRITER_SAMPLES,
	infoClient,
	isTxHash,
	type Network,
	networkConfig,
	rpcCall,
	type TxTrace,
	traceTransaction,
} from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowUpRight,
	GitCompareArrows,
	Loader2,
	RefreshCw,
	Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import { CopyButton } from "#/components/hub/CopyButton";
import {
	EmptyState,
	KeyValueGrid,
	Panel,
	TextInput,
	ToolPage,
} from "#/components/hub/layout";
import {
	Callout,
	formatTimestamp,
	NetworkBadge,
	ObservedLine,
	Pill,
} from "#/components/hub/status";
import { ActionDetail } from "#/components/tools/trace/ActionDetail";
import { TimingRules } from "#/components/tools/trace/TimingRules";
import { TraceFlow } from "#/components/tools/trace/TraceFlow";
import { Button } from "#/components/ui/button";
import { errorMessage } from "#/hooks/useHyperliquid";
import { tool } from "#/lib/tools";
import { useHandoffStore } from "#/store/handoffStore";
import {
	useNetwork,
	useNetworkHydrated,
	useNetworkStore,
} from "#/store/networkStore";

export const Route = createFileRoute("/tools/trace")({
	validateSearch: (
		s: Record<string, unknown>,
	): { sample?: string; tx?: string } => ({
		sample: typeof s.sample === "string" ? s.sample : undefined,
		tx: typeof s.tx === "string" ? s.tx : undefined,
	}),
	head: () => ({ meta: [{ title: "Cross-layer Trace — hl-tools" }] }),
	component: TraceTool,
});

const TRACE_SAMPLES = COREWRITER_SAMPLES.filter((s) => s.txHash);

function useTrace(target: { hash: string; network: Network } | null) {
	const qc = useQueryClient();
	return useQuery<TxTrace>({
		queryKey: ["trace", target?.network, target?.hash],
		enabled: !!target,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
		queryFn: async () => {
			if (!target) throw new Error("no target");
			const { network, hash } = target;
			const other: Network = network === "mainnet" ? "testnet" : "mainnet";
			const universe = await qc
				.ensureQueryData({
					queryKey: ["universe", network],
					queryFn: () => infoClient(network).universe(),
					staleTime: 5 * 60_000,
				})
				.catch(() => undefined);
			return traceTransaction(network, hash, {
				rpc: (m, p) => rpcCall(networkConfig(network).evmRpcUrl, m, p),
				otherRpc: (m, p) => rpcCall(networkConfig(other).evmRpcUrl, m, p),
				info: async (body) => {
					try {
						const r = await infoClient(network).info(
							{ type: String(body.type), ...body },
							{ ttlMs: 0 },
						);
						return { body, response: r.data, error: null };
					} catch (e) {
						return { body, response: null, error: errorMessage(e) };
					}
				},
				universe,
			});
		},
	});
}

function TraceTool() {
	const search = Route.useSearch();
	const network = useNetwork();
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const take = useHandoffStore((s) => s.take);
	const sample = search.sample
		? TRACE_SAMPLES.find((s) => s.id === search.sample)
		: undefined;
	const [input, setInput] = useState(() => sample?.txHash ?? search.tx ?? "");
	const [target, setTarget] = useState<{
		hash: string;
		network: Network;
	} | null>(null);

	// Samples carry their own network; start them once the persisted network
	// has been restored so it can't override the sample's network afterwards.
	const hydrated = useNetworkHydrated();
	const [started, setStarted] = useState(false);
	useEffect(() => {
		if (!hydrated || started) return;
		setStarted(true);
		if (sample?.txHash) {
			if (sample.network !== network) setNetwork(sample.network);
			setTarget({ hash: sample.txHash, network: sample.network });
		} else if (search.tx && isTxHash(search.tx)) {
			setTarget({ hash: search.tx.toLowerCase(), network });
		}
	}, [hydrated, started, sample, search.tx, network, setNetwork]);

	useEffect(() => {
		const handed = take("trace");
		if (handed && isTxHash(handed)) {
			setInput(handed);
			setTarget({ hash: handed.toLowerCase(), network });
		}
	}, [take, network]);

	const trace = useTrace(target);
	const valid = isTxHash(input);
	const submit = (hash: string, net: Network = network) => {
		setInput(hash);
		if (isTxHash(hash))
			setTarget({ hash: hash.trim().toLowerCase(), network: net });
	};
	const t = trace.data;
	const staleNetwork = target && target.network !== network;
	const accountProblem =
		t?.kind === "ok" &&
		t.actions.some((a) => a.findings.some((f) => f.tone === "bad"));

	return (
		<ToolPage tool={tool("trace")}>
			<form
				className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end"
				onSubmit={(e) => {
					e.preventDefault();
					submit(input);
				}}
			>
				<div className="min-w-0 flex-1 space-y-1.5">
					<label htmlFor="trace-hash" className="text-xs font-medium">
						HyperEVM transaction hash on{" "}
						<span
							className={
								network === "mainnet" ? "text-mainnet" : "text-testnet"
							}
						>
							{network}
						</span>
					</label>
					<div className="relative">
						<Search
							className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
							aria-hidden
						/>
						<TextInput
							id="trace-hash"
							mono
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder="0x4b65b9ab3d57b40a29103541b725773012266f2ffd73507077360e9d7d64d949"
							className="h-10 pl-9"
							aria-invalid={input.trim() !== "" && !valid}
						/>
					</div>
				</div>
				<Button
					type="submit"
					variant="brand"
					className="h-10"
					disabled={!valid || trace.isFetching}
				>
					{trace.isFetching ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<GitCompareArrows className="size-4" />
					)}
					Trace
				</Button>
			</form>
			{input.trim() !== "" && !valid && (
				<p className="mb-3 text-xs text-danger">
					A transaction hash is 0x followed by 64 hex characters.
				</p>
			)}
			<div className="mb-6 flex flex-wrap items-center gap-1.5 text-xs">
				<span className="text-muted-foreground">Real transactions:</span>
				{TRACE_SAMPLES.map((s) => (
					<button
						key={s.id}
						type="button"
						onClick={() => {
							if (s.network !== network) setNetwork(s.network);
							submit(s.txHash as string, s.network);
						}}
						className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 hover:border-border-strong hover:bg-surface-2"
						title={s.description}
					>
						<span
							className={
								s.network === "mainnet"
									? "size-1.5 rounded-full bg-mainnet"
									: "size-1.5 rounded-full bg-testnet"
							}
							aria-hidden
						/>
						{s.label.replace(/ \((mainnet|testnet) tx\)/, "")}
					</button>
				))}
			</div>

			{staleNetwork && target && (
				<Callout
					tone="warning"
					title={`This trace ran on ${target.network}; you are now on ${network}`}
					className="mb-5"
					action={
						<Button
							size="sm"
							variant="outline"
							onClick={() => setTarget({ hash: target.hash, network })}
						>
							Trace the same hash on {network}
						</Button>
					}
				>
					Results below stay pinned to {target.network}. Transaction hashes and
					identifiers never carry across networks automatically.
				</Callout>
			)}

			{!target ? (
				<div className="space-y-6">
					<EmptyState
						icon={GitCompareArrows}
						title="Follow a HyperEVM transaction into HyperCore"
						description="See the receipt, every CoreWriter action it emitted, what HyperCore should have done, and what it actually did — with each link marked observed, inferred or unknown."
						sample="0x4b65…d949 → RawAction(limit order) → order 558821730696 filled"
						action={
							<Button
								size="sm"
								variant="outline"
								onClick={() =>
									submit(TRACE_SAMPLES[0]?.txHash as string, "mainnet")
								}
							>
								Try with a sample
							</Button>
						}
					/>
					<TimingRules />
				</div>
			) : trace.isLoading ? (
				<div className="space-y-4" aria-busy="true">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" /> Fetching receipt,
						decoding logs and querying HyperCore…
					</div>
					<div className="grid gap-3 lg:grid-cols-4">
						{[0, 1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-32 animate-pulse rounded-lg border border-border bg-surface"
							/>
						))}
					</div>
				</div>
			) : trace.isError ? (
				<Callout
					tone="danger"
					title="Trace failed"
					action={
						<Button size="sm" variant="outline" onClick={() => trace.refetch()}>
							<RefreshCw className="size-3.5" /> Retry
						</Button>
					}
				>
					{errorMessage(trace.error)}
				</Callout>
			) : t?.kind === "error" ? (
				<Callout
					tone="danger"
					title={`Could not read the transaction from the ${t.network} RPC`}
					action={
						<Button size="sm" variant="outline" onClick={() => trace.refetch()}>
							<RefreshCw className="size-3.5" /> Retry
						</Button>
					}
				>
					{t.message}. The public RPC allows 100 requests per minute per IP;
					wait a moment and retry.
				</Callout>
			) : t?.kind === "not-found" ? (
				<Callout
					tone="unknown"
					title={`No transaction ${t.txHash.slice(0, 10)}… on ${t.network}`}
					action={
						t.foundOnOtherNetwork ? (
							<Button
								size="sm"
								variant="outline"
								onClick={() => {
									const other: Network =
										t.network === "mainnet" ? "testnet" : "mainnet";
									setNetwork(other);
									setTarget({ hash: t.txHash, network: other });
								}}
							>
								Switch to {t.network === "mainnet" ? "testnet" : "mainnet"} and
								trace
							</Button>
						) : null
					}
				>
					{t.foundOnOtherNetwork
						? `It exists on ${t.network === "mainnet" ? "testnet" : "mainnet"}. The trace won't switch networks for you — confirm to continue there.`
						: t.foundOnOtherNetwork === false
							? "It isn't on the other network either. Check the hash, or wait if it was just sent."
							: "The other network could not be checked."}
				</Callout>
			) : t?.kind === "ok" ? (
				<div className="space-y-6">
					<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0 space-y-1.5">
							<div className="flex min-w-0 items-center gap-2">
								<span className="min-w-0 break-all font-mono text-sm">
									{t.txHash}
								</span>
								<CopyButton value={t.txHash} size="xs" />
							</div>
							<ObservedLine
								network={t.network}
								observedAt={t.observedAt}
								source={`${t.receipt.coreWriterLogCount} CoreWriter action${t.receipt.coreWriterLogCount === 1 ? "" : "s"} · ${t.receipt.logCount} logs`}
							/>
						</div>
						<a
							href={networkConfig(t.network).evmExplorerTx(t.txHash)}
							target="_blank"
							rel="noreferrer"
							className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						>
							View on explorer <ArrowUpRight className="size-3" />
						</a>
					</div>

					{t.actions.length === 0 ? (
						<Callout
							tone="unknown"
							title="This transaction emitted no CoreWriter actions"
						>
							No RawAction log from 0x3333…3333 in the receipt, so nothing was
							sent to HyperCore through CoreWriter.
							{t.receipt.evmToCoreTransfers.length > 0
								? ` It does include ${t.receipt.evmToCoreTransfers.length} EVM → Core token transfer(s).`
								: ""}
						</Callout>
					) : (
						t.actions.map((a, i) => (
							<section
								key={a.logIndex}
								className="space-y-4"
								aria-labelledby={`action-${i}`}
							>
								<div className="flex flex-wrap items-center gap-2">
									<h2 id={`action-${i}`} className="text-base font-semibold">
										Action {i + 1} of {t.actions.length}
									</h2>
									<NetworkBadge network={t.network} />
									{a.decode.kind === "decoded" && (
										<Pill>{a.decode.spec.name}</Pill>
									)}
								</div>
								<TraceFlow receipt={t.receipt} action={a} />
								<ActionDetail action={a} network={t.network} index={i} />
							</section>
						))
					)}

					<TimingRules highlight={accountProblem ? "account" : null} />

					<Panel title="Receipt">
						<KeyValueGrid
							columns={3}
							items={[
								{
									label: "Status",
									value:
										t.receipt.status === "success" ? (
											<Pill tone="success">success</Pill>
										) : (
											<Pill tone="danger">reverted</Pill>
										),
								},
								{
									label: "Block",
									value: t.receipt.blockNumber.toString(),
									mono: true,
								},
								{
									label: "Block time",
									value:
										t.receipt.blockTimestamp !== null
											? formatTimestamp(t.receipt.blockTimestamp * 1000)
											: "—",
									mono: true,
								},
								{ label: "From", value: t.receipt.from, mono: true },
								{
									label: "To",
									value: t.receipt.to ?? "contract creation",
									mono: true,
								},
								{
									label: "Gas used",
									value: t.receipt.gasUsed.toLocaleString(),
									mono: true,
									hint: "CoreWriter burns ~25,000 gas before emitting its log.",
								},
								{
									label: "Logs",
									value: String(t.receipt.logCount),
									mono: true,
								},
								{
									label: "CoreWriter actions",
									value: String(t.receipt.coreWriterLogCount),
									mono: true,
								},
								{
									label: "EVM → Core transfers",
									value: t.receipt.evmToCoreTransfers.length
										? t.receipt.evmToCoreTransfers
												.map((x) => `${x.amount} → ${x.to.slice(0, 10)}…`)
												.join(", ")
										: "none",
									mono: true,
								},
							]}
						/>
					</Panel>

					<CodeBlock
						title="Raw requests"
						views={[
							{
								id: "rpc",
								label: `JSON-RPC (${t.rpcLog.length})`,
								content: JSON.stringify(
									t.rpcLog.map((x) => ({
										request: x.request,
										response: x.response ?? x.result,
										failure: x.failure,
									})),
									(_k, v) => (typeof v === "bigint" ? v.toString() : v),
									2,
								),
							},
							{
								id: "info",
								label: `Info API (${t.infoLog.length})`,
								content: JSON.stringify(
									t.infoLog.map((x) => ({
										request: x.body,
										response: x.response,
										error: x.error,
									})),
									null,
									2,
								),
							},
						]}
						maxHeight="24rem"
					/>
				</div>
			) : null}
		</ToolPage>
	);
}
