import {
	type Network,
	networkConfig,
	type ProbeCheck,
	type ProbeResult,
	type ProbeStatus,
	probeEndpoint,
	redactUrl,
} from "@hl-tools/core";
import { createFileRoute } from "@tanstack/react-router";
import {
	ChevronRight,
	KeyRound,
	Loader2,
	Network as NetworkIcon,
	Play,
	Square,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import {
	EmptyState,
	Field,
	Panel,
	TextInput,
	ToolPage,
} from "#/components/hub/layout";
import {
	Callout,
	NetworkBadge,
	ObservedLine,
	Pill,
	type Tone,
} from "#/components/hub/status";
import { Button } from "#/components/ui/button";
import { tool } from "#/lib/tools";
import { cn } from "#/lib/utils";
import { useHandoffStore } from "#/store/handoffStore";
import { useNetwork, useNetworkHydrated } from "#/store/networkStore";

export const Route = createFileRoute("/tools/rpc")({
	validateSearch: (s: Record<string, unknown>): { sample?: string } => ({
		sample: typeof s.sample === "string" ? s.sample : undefined,
	}),
	head: () => ({ meta: [{ title: "RPC Capability Probe — hl-tools" }] }),
	component: RpcTool,
});

const STATUS_TONE: Record<ProbeStatus, Tone> = {
	supported: "success",
	unsupported: "neutral",
	inconclusive: "unknown",
};

interface RunState {
	running: boolean;
	checks: ProbeCheck[];
	result: ProbeResult | null;
	error: string | null;
}

const EMPTY: RunState = {
	running: false,
	checks: [],
	result: null,
	error: null,
};

function StatusPill({ check }: { check: ProbeCheck | undefined }) {
	if (!check) return <span className="text-xs text-subtle-foreground">—</span>;
	return (
		<span className="inline-flex flex-wrap items-center gap-1">
			<Pill tone={STATUS_TONE[check.status]}>{check.status}</Pill>
			{check.flag && (
				<Pill
					tone={
						check.flag.kind === "latest-for-historical" ||
						check.flag.kind === "network-mismatch"
							? "danger"
							: "warning"
					}
				>
					flag
				</Pill>
			)}
		</span>
	);
}

function CheckDetail({ check }: { check: ProbeCheck }) {
	return (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">{check.description}</p>
			<p className="text-sm">{check.detail}</p>
			{check.flag && (
				<Callout
					tone={
						check.flag.kind === "latest-for-historical" ||
						check.flag.kind === "network-mismatch"
							? "danger"
							: "warning"
					}
					title={check.flag.message}
				/>
			)}
			<CodeBlock
				title={`${check.exchanges.length} request${check.exchanges.length === 1 ? "" : "s"}`}
				views={[
					{
						id: "req",
						label: "Requests",
						content: JSON.stringify(
							check.exchanges.map((e) => e.request),
							null,
							2,
						),
					},
					{
						id: "res",
						label: "Responses",
						content: JSON.stringify(
							check.exchanges.map((e) => e.response ?? { failure: e.failure }),
							null,
							2,
						),
					},
				]}
				maxHeight="16rem"
			/>
		</div>
	);
}

function RpcTool() {
	const search = Route.useSearch();
	const network = useNetwork();
	const take = useHandoffStore((s) => s.take);
	const other: Network = network === "mainnet" ? "testnet" : "mainnet";
	const [urlA, setUrlA] = useState(networkConfig(network).evmRpcUrl);
	const [urlB, setUrlB] = useState(
		search.sample === "public" ? networkConfig(other).evmRpcUrl : "",
	);
	const [runA, setRunA] = useState<RunState>(EMPTY);
	const [runB, setRunB] = useState<RunState>(EMPTY);
	const [open, setOpen] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	// Keep the default endpoint in step with the global network until the user edits it.
	const [edited, setEdited] = useState(false);
	useEffect(() => {
		if (!edited) setUrlA(networkConfig(network).evmRpcUrl);
	}, [network, edited]);

	useEffect(() => {
		const handed = take("rpc");
		if (handed) {
			setUrlA(handed);
			setEdited(true);
		}
	}, [take]);

	const ra = redactUrl(urlA);
	const rb = urlB.trim() ? redactUrl(urlB) : null;
	const running = runA.running || runB.running;

	const run = async () => {
		abortRef.current?.abort();
		const ctrl = new AbortController();
		abortRef.current = ctrl;
		// Only the primary endpoint is checked against the selected network; B is a comparison.
		const exec = async (
			url: string,
			set: (s: RunState | ((p: RunState) => RunState)) => void,
			expectedNetwork?: Network,
		) => {
			set({ running: true, checks: [], result: null, error: null });
			try {
				const result = await probeEndpoint(url.trim(), {
					signal: ctrl.signal,
					expectedNetwork,
					onCheck: (c) => set((p) => ({ ...p, checks: [...p.checks, c] })),
				});
				set((p) => ({ ...p, running: false, result }));
			} catch (e) {
				set((p) => ({
					...p,
					running: false,
					error:
						(e as Error).name === "AbortError"
							? "Stopped."
							: (e as Error).message,
				}));
			}
		};
		const jobs: Promise<void>[] = [exec(urlA, setRunA, network)];
		if (rb?.valid) {
			const sameHost = (() => {
				try {
					return new URL(urlA).host === new URL(urlB).host;
				} catch {
					return false;
				}
			})();
			// Same host shares one rate limit: run B after A instead of in parallel.
			if (sameHost) await jobs[0];
			jobs.push(exec(urlB, setRunB));
		} else setRunB(EMPTY);
		await Promise.all(jobs);
	};

	// "Try with a sample" runs the public mainnet-vs-testnet comparison
	// (bounded, read-only) once the stored network has been restored. The
	// run fires on the render after the URLs are set so it probes them.
	const hydrated = useNetworkHydrated();
	const autoRan = useRef(false);
	const [autoRun, setAutoRun] = useState(false);
	useEffect(() => {
		if (search.sample !== "public" || !hydrated || autoRan.current) return;
		autoRan.current = true;
		setUrlA(networkConfig(network).evmRpcUrl);
		setUrlB(networkConfig(other).evmRpcUrl);
		setAutoRun(true);
	}, [search.sample, hydrated, network, other]);
	const runRef = useRef(run);
	runRef.current = run;
	useEffect(() => {
		if (!autoRun) return;
		setAutoRun(false);
		void runRef.current();
	}, [autoRun]);

	const compare = !!rb?.valid && (runB.checks.length > 0 || runB.running);
	const ids = [
		...new Set([
			...runA.checks.map((c) => c.id),
			...runB.checks.map((c) => c.id),
		]),
	];
	const byA = Object.fromEntries(runA.checks.map((c) => [c.id, c]));
	const byB = Object.fromEntries(runB.checks.map((c) => [c.id, c]));

	return (
		<ToolPage tool={tool("rpc")}>
			<Panel
				title="Endpoints"
				description="Probes are bounded (~25 read-only requests each) and paced for the public endpoint's 100 requests/minute limit."
			>
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (ra.valid) void run();
					}}
				>
					<div className="grid gap-4 md:grid-cols-2">
						<Field
							label="Endpoint A"
							htmlFor="rpc-a"
							error={
								urlA.trim() && !ra.valid
									? `Enter an http(s) JSON-RPC URL (${ra.display}).`
									: undefined
							}
							hint={ra.valid ? `Probing ${ra.display}` : undefined}
						>
							<TextInput
								id="rpc-a"
								mono
								value={urlA}
								onChange={(e) => {
									setUrlA(e.target.value);
									setEdited(true);
								}}
								placeholder="https://rpc.hyperliquid.xyz/evm"
								data-private
							/>
						</Field>
						<Field
							label="Endpoint B (optional, for comparison)"
							htmlFor="rpc-b"
							error={
								rb && !rb.valid
									? `Enter an http(s) JSON-RPC URL (${rb.display}).`
									: undefined
							}
							hint={
								rb?.valid
									? `Probing ${rb.display}`
									: "Leave empty to probe one endpoint."
							}
						>
							<TextInput
								id="rpc-b"
								mono
								value={urlB}
								onChange={(e) => setUrlB(e.target.value)}
								placeholder={networkConfig(other).evmRpcUrl}
								data-private
							/>
						</Field>
					</div>
					{(ra.sensitive || rb?.sensitive) && (
						<Callout
							tone="info"
							title="This URL contains what looks like an API key"
						>
							<span className="inline-flex items-start gap-1.5">
								<KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
								It stays in this tab's memory only: never stored, logged or
								added to the page URL, and shown redacted in results. Requests
								are sent with no cookies and no referrer.
							</span>
						</Callout>
					)}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="submit"
							variant="brand"
							disabled={!ra.valid || running || (!!rb && !rb.valid)}
						>
							{running ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Play className="size-4" />
							)}
							Run probe
						</Button>
						{running && (
							<Button
								type="button"
								variant="outline"
								onClick={() => abortRef.current?.abort()}
							>
								<Square className="size-4" /> Stop
							</Button>
						)}
						<Button
							type="button"
							variant="ghost"
							onClick={() => {
								setUrlA(networkConfig("mainnet").evmRpcUrl);
								setUrlB(networkConfig("testnet").evmRpcUrl);
								setEdited(true);
							}}
						>
							Use public mainnet vs testnet
						</Button>
					</div>
				</form>
			</Panel>

			{runA.checks.length === 0 && !runA.running ? (
				<div className="mt-5">
					<EmptyState
						icon={NetworkIcon}
						title="Find out what an RPC really supports"
						description="Chain ID, head freshness, historical state (with exact controls that catch endpoints answering historical queries with latest state), eth_getLogs range limits and HyperEVM-specific methods — with the raw request and response for every check."
						sample="historical eth_getCode(USDC, block 1000) → should be empty"
					/>
				</div>
			) : (
				<div className="mt-5 space-y-5">
					<div className={cn("grid gap-3", compare && "md:grid-cols-2")}>
						{[
							{ label: "A", run: runA, r: ra },
							...(compare && rb ? [{ label: "B", run: runB, r: rb }] : []),
						].map(({ label, run: s, r }) => (
							<div
								key={label}
								className="min-w-0 rounded-lg border border-border bg-surface p-4"
							>
								<div className="mb-1 flex flex-wrap items-center gap-2">
									<span className="font-mono text-xs text-muted-foreground">
										{label}
									</span>
									<span className="min-w-0 break-all font-mono text-sm">
										{r.display}
									</span>
									{r.sensitive && <Pill tone="info">key redacted</Pill>}
								</div>
								{s.result?.network ? (
									<ObservedLine
										network={s.result.network}
										observedAt={s.result.finishedAt}
										source={`${s.result.checks.length} checks in ${((s.result.finishedAt - s.result.startedAt) / 1000).toFixed(1)} s`}
									/>
								) : s.running ? (
									<p className="flex items-center gap-2 text-xs text-muted-foreground">
										<Loader2 className="size-3.5 animate-spin" />{" "}
										{s.checks.length} checks done…
									</p>
								) : s.result ? (
									<p className="text-xs text-muted-foreground">
										chain {s.result.chainId ?? "unknown"} · not a HyperEVM
										network
									</p>
								) : null}
								{s.result?.aborted && (
									<Callout
										tone="danger"
										title={s.result.aborted}
										className="mt-3"
									/>
								)}
								{s.error && (
									<Callout tone="warning" title={s.error} className="mt-3" />
								)}
							</div>
						))}
					</div>

					<ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface sm:hidden">
						{ids.map((id) => {
							const a = byA[id];
							const b = byB[id];
							const expanded = open === id;
							return (
								<li key={id} className="px-4 py-3">
									<button
										type="button"
										onClick={() => setOpen(expanded ? null : id)}
										aria-expanded={expanded}
										className="flex w-full items-start gap-1.5 text-left"
									>
										<ChevronRight
											className={cn(
												"mt-0.5 size-3.5 shrink-0 text-subtle-foreground transition-transform",
												expanded && "rotate-90",
											)}
											aria-hidden
										/>
										<span className="text-sm font-medium">
											{(a ?? b)?.title ?? id}
										</span>
									</button>
									<div className="mt-2 space-y-1.5 pl-5">
										{[
											{ label: "A", c: a },
											...(compare ? [{ label: "B", c: b }] : []),
										].map(({ label, c }) => (
											<div
												key={label}
												className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
											>
												{compare && (
													<span className="font-mono text-2xs text-muted-foreground">
														{label}
													</span>
												)}
												<StatusPill check={c} />
												{c?.value && (
													<span className="break-all font-mono text-2xs text-muted-foreground">
														{c.value}
													</span>
												)}
											</div>
										))}
									</div>
									{expanded && (
										<div className="mt-3 space-y-4">
											{a && <CheckDetail check={a} />}
											{compare && b && (
												<div>
													<div className="mb-1 font-mono text-xs text-muted-foreground">
														B
													</div>
													<CheckDetail check={b} />
												</div>
											)}
										</div>
									)}
								</li>
							);
						})}
					</ul>
					<div className="hidden overflow-hidden rounded-lg border border-border bg-surface sm:block">
						<div className="scrollbar-thin overflow-x-auto">
							<table className="w-full min-w-[560px] border-collapse text-sm">
								<thead>
									<tr className="border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground">
										<th className="px-4 py-2 font-medium">check</th>
										<th className="px-3 py-2 font-medium">
											A{" "}
											{runA.result?.network && (
												<NetworkBadge
													network={runA.result.network}
													className="ml-1"
												/>
											)}
										</th>
										{compare && (
											<th className="px-3 py-2 font-medium">
												B{" "}
												{runB.result?.network && (
													<NetworkBadge
														network={runB.result.network}
														className="ml-1"
													/>
												)}
											</th>
										)}
									</tr>
								</thead>
								<tbody>
									{ids.map((id) => {
										const a = byA[id];
										const b = byB[id];
										const title = (a ?? b)?.title ?? id;
										const expanded = open === id;
										return (
											<Fragment key={id}>
												<tr
													className={cn(
														"border-b border-border/60 align-top",
														expanded && "bg-surface-2/60",
													)}
												>
													<td className="px-4 py-2.5">
														<button
															type="button"
															onClick={() => setOpen(expanded ? null : id)}
															aria-expanded={expanded}
															className="flex items-start gap-1.5 text-left"
														>
															<ChevronRight
																className={cn(
																	"mt-0.5 size-3.5 shrink-0 text-subtle-foreground transition-transform",
																	expanded && "rotate-90",
																)}
																aria-hidden
															/>
															<span className="font-medium">{title}</span>
														</button>
													</td>
													<td className="px-3 py-2.5">
														<StatusPill check={a} />
														{a?.value && (
															<div className="mt-0.5 break-all font-mono text-2xs text-muted-foreground">
																{a.value}
															</div>
														)}
													</td>
													{compare && (
														<td className="px-3 py-2.5">
															<StatusPill check={b} />
															{b?.value && (
																<div className="mt-0.5 break-all font-mono text-2xs text-muted-foreground">
																	{b.value}
																</div>
															)}
														</td>
													)}
												</tr>
												{expanded && (
													<tr className="border-b border-border/60">
														<td colSpan={compare ? 3 : 2} className="px-4 py-3">
															<div
																className={cn(
																	"grid gap-4",
																	compare && "lg:grid-cols-2",
																)}
															>
																{a && (
																	<div className="min-w-0">
																		{compare && (
																			<div className="mb-1 font-mono text-xs text-muted-foreground">
																				A
																			</div>
																		)}
																		<CheckDetail check={a} />
																	</div>
																)}
																{compare && b && (
																	<div className="min-w-0">
																		<div className="mb-1 font-mono text-xs text-muted-foreground">
																			B
																		</div>
																		<CheckDetail check={b} />
																	</div>
																)}
															</div>
														</td>
													</tr>
												)}
											</Fragment>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
					<p className="text-xs text-muted-foreground">
						Statuses: <strong>supported</strong> — works as specified;{" "}
						<strong>unsupported</strong> — refused, or answered incorrectly;{" "}
						<strong>inconclusive</strong> — couldn't be determined (e.g. rate
						limited). A <strong>flag</strong> marks behaviour that silently
						misleads, like answering a historical query with the latest state.
					</p>
				</div>
			)}
		</ToolPage>
	);
}
