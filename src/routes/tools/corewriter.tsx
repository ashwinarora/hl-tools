import {
	COREWRITER_SAMPLES,
	coreWriterActionByKey,
	decodeCoreWriterAction,
	encodeCoreWriterAction,
} from "@hl-tools/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	EmptyState,
	Field,
	Panel,
	Segmented,
	TextArea,
	ToolPage,
	Workspace,
} from "#/components/hub/layout";
import { Callout, IssueList } from "#/components/hub/status";
import {
	BUILD_DEFAULTS,
	BuildForm,
} from "#/components/tools/corewriter/BuildForm";
import { DecodeResult } from "#/components/tools/corewriter/DecodeResult";
import { Precompiles } from "#/components/tools/corewriter/Precompiles";
import { Button } from "#/components/ui/button";
import { useUniverse } from "#/hooks/useHyperliquid";
import { tool } from "#/lib/tools";
import { useHandoffStore } from "#/store/handoffStore";
import {
	useNetwork,
	useNetworkHydrated,
	useNetworkStore,
} from "#/store/networkStore";

type Tab = "decode" | "build" | "precompiles";

export const Route = createFileRoute("/tools/corewriter")({
	validateSearch: (
		s: Record<string, unknown>,
	): { sample?: string; tab?: Tab } => ({
		sample: typeof s.sample === "string" ? s.sample : undefined,
		tab:
			s.tab === "build" || s.tab === "precompiles" || s.tab === "decode"
				? s.tab
				: undefined,
	}),
	head: () => ({ meta: [{ title: "CoreWriter Workbench — hl-tools" }] }),
	component: CoreWriterTool,
});

function CoreWriterTool() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/tools/corewriter" });
	const network = useNetwork();
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const take = useHandoffStore((s) => s.take);
	const universe = useUniverse(network);
	const [tab, setTabState] = useState<Tab>(search.tab ?? "decode");
	// The mode is part of the page's address (not the pasted bytes), so a
	// reload or a shared link lands on the same tab.
	const setTab = useCallback(
		(t: Tab) => {
			setTabState(t);
			void navigate({
				search: (s) => ({ ...s, tab: t === "decode" ? undefined : t }),
				replace: true,
			});
		},
		[navigate],
	);
	const [hex, setHex] = useState(() =>
		search.sample
			? (COREWRITER_SAMPLES.find((s) => s.id === search.sample)?.hex ?? "")
			: "",
	);
	const [actionKey, setActionKey] = useState("limitOrder");
	const [values, setValues] = useState<Record<string, string>>(BUILD_DEFAULTS);

	// A URL sample belongs to a network; apply it after the persisted network
	// is restored so asset/token labels come from the right metadata.
	const hydrated = useNetworkHydrated();
	const [sampleApplied, setSampleApplied] = useState(false);
	useEffect(() => {
		if (!hydrated || sampleApplied) return;
		setSampleApplied(true);
		const s = COREWRITER_SAMPLES.find((x) => x.id === search.sample);
		if (s && s.network !== network) setNetwork(s.network);
	}, [hydrated, sampleApplied, search.sample, network, setNetwork]);

	useEffect(() => {
		const handed = take("corewriter");
		if (handed) {
			setHex(handed);
			setTab("decode");
		}
	}, [take, setTab]);

	const decode = useMemo(
		() =>
			hex.trim()
				? decodeCoreWriterAction(hex.trim(), { universe: universe.data })
				: null,
		[hex, universe.data],
	);
	const built = useMemo(
		() =>
			encodeCoreWriterAction(actionKey, values, { universe: universe.data }),
		[actionKey, values, universe.data],
	);
	const builtDecode = useMemo(
		() =>
			built.hex
				? decodeCoreWriterAction(built.hex, { universe: universe.data })
				: null,
		[built.hex, universe.data],
	);

	const loadSample = (id: string) => {
		const s = COREWRITER_SAMPLES.find((x) => x.id === id);
		if (!s?.hex) return;
		if (s.network !== network) setNetwork(s.network);
		setHex(s.hex);
		setTab("decode");
	};

	return (
		<ToolPage tool={tool("corewriter")}>
			<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<Segmented<Tab>
					label="Workbench mode"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "decode", label: "Decode bytes" },
						{ value: "build", label: "Build action" },
						{ value: "precompiles", label: "Read precompiles" },
					]}
				/>
				<Link
					to="/tools/trace"
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>
					Trace a transaction end to end <ArrowRight className="size-3" />
				</Link>
			</div>

			{tab === "decode" && (
				<Workspace
					input={
						<Panel
							title="Raw action bytes"
							description="The bytes passed to CoreWriter.sendRawAction — or the full sendRawAction calldata."
						>
							<div className="space-y-4">
								<Field
									label="Hex"
									htmlFor="cw-hex"
									hint={
										decode?.kind === "decoded" ||
										decode?.kind === "unknown-version" ||
										decode?.kind === "unknown-action"
											? `${decode.bytes.length} bytes`
											: "0x-prefixed or bare hex; whitespace is ignored."
									}
								>
									<TextArea
										id="cw-hex"
										rows={8}
										value={hex}
										onChange={(e) => setHex(e.target.value)}
										placeholder="0x01000007…"
										data-private
									/>
								</Field>
								<div className="space-y-1.5">
									<div className="text-xs font-medium">Samples</div>
									<div className="flex flex-wrap gap-1.5">
										{COREWRITER_SAMPLES.filter((s) => s.hex).map((s) => (
											<button
												key={s.id}
												type="button"
												onClick={() => loadSample(s.id)}
												className="rounded border border-border bg-surface px-2 py-1 text-left text-xs hover:border-border-strong hover:bg-surface-2"
												title={s.description}
											>
												{s.label}
											</button>
										))}
									</div>
								</div>
							</div>
						</Panel>
					}
					output={
						!decode ? (
							<EmptyState
								icon={Workflow}
								title="Decode a CoreWriter action"
								description="Byte 0 is the encoding version, bytes 1–3 the action ID, the rest is the ABI-encoded field tuple. Paste bytes to see every field as a raw integer and in human units."
								sample="0x01000007 …0098 9680 …0000 → usdClassTransfer(10 USDC, toPerp=false)"
								action={
									<Button
										size="sm"
										variant="outline"
										onClick={() => loadSample("limit-order")}
									>
										Try with a sample
									</Button>
								}
							/>
						) : universe.isError ? (
							<>
								<Callout
									tone="warning"
									title={`${network} metadata unavailable`}
								>
									Fields decode, but asset and token names can't be resolved.
								</Callout>
								<DecodeResult decode={decode} network={network} />
							</>
						) : (
							<DecodeResult decode={decode} network={network} />
						)
					}
				/>
			)}

			{tab === "build" && (
				<Workspace
					input={
						<Panel
							title="Action fields"
							description={
								coreWriterActionByKey(actionKey)?.notes ??
								"Enter values in human units where a unit is shown; they are scaled exactly or rejected."
							}
						>
							<BuildForm
								actionKey={actionKey}
								onActionKey={(k) => setActionKey(k)}
								values={values}
								onValues={setValues}
								universe={universe.data}
							/>
						</Panel>
					}
					output={
						built.hex && builtDecode ? (
							<DecodeResult decode={builtDecode} network={network} />
						) : (
							<div className="space-y-3">
								<Callout tone="danger" title="Can't encode yet">
									Fix the highlighted fields to produce bytes.
								</Callout>
								<IssueList issues={built.issues} />
							</div>
						)
					}
				/>
			)}

			{tab === "precompiles" && (
				<Precompiles network={network} universe={universe.data} />
			)}
		</ToolPage>
	);
}
