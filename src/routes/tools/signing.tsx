import { SIGNING_SAMPLES, stringifyJson } from "@hl-tools/core";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRightLeft, Copy, PenLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	EmptyState,
	Panel,
	Segmented,
	ToolPage,
	Workspace,
} from "#/components/hub/layout";
import { ShareButton } from "#/components/hub/ShareButton";
import { Callout } from "#/components/hub/status";
import { CompareView } from "#/components/tools/signing/CompareView";
import {
	InspectionView,
	Verdict,
} from "#/components/tools/signing/InspectionView";
import {
	EMPTY_INPUT,
	parseInput,
	type SigningInput,
	useInspection,
} from "#/components/tools/signing/model";
import {
	SigningForm,
	sampleInput,
} from "#/components/tools/signing/SigningForm";
import { Button } from "#/components/ui/button";
import { clearShared, readShared } from "#/lib/share";
import { tool } from "#/lib/tools";
import { useHandoffStore } from "#/store/handoffStore";
import {
	useNetwork,
	useNetworkHydrated,
	useNetworkStore,
} from "#/store/networkStore";

type Mode = "inspect" | "compare";

export const Route = createFileRoute("/tools/signing")({
	validateSearch: (s: Record<string, unknown>): { sample?: string } => ({
		sample: typeof s.sample === "string" ? s.sample : undefined,
	}),
	head: () => ({ meta: [{ title: "Signing Inspector — hl-tools" }] }),
	component: SigningTool,
});

/** A common real-world mistake: the same order with a trailing zero in the price. */
function trailingZeroPair(): [SigningInput, SigningInput] {
	const a = sampleInput("order") ?? EMPTY_INPUT;
	return [a, { ...a, text: a.text.replace('"p": "100"', '"p": "100.0"') }];
}

function SigningTool() {
	const search = Route.useSearch();
	const network = useNetwork();
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const take = useHandoffStore((s) => s.take);
	const [mode, setMode] = useState<Mode>("inspect");
	const [a, setA] = useState<SigningInput>(() =>
		search.sample ? (sampleInput(search.sample) ?? EMPTY_INPUT) : EMPTY_INPUT,
	);
	const [b, setB] = useState<SigningInput>(EMPTY_INPUT);

	// URL samples are tied to a network (usdSend is a testnet vector).
	const hydrated = useNetworkHydrated();
	const [sampleApplied, setSampleApplied] = useState(false);
	useEffect(() => {
		if (!hydrated || sampleApplied) return;
		setSampleApplied(true);
		const s = SIGNING_SAMPLES.find((x) => x.id === search.sample);
		if (s && s.network !== network) setNetwork(s.network);
	}, [hydrated, sampleApplied, search.sample, network, setNetwork]);

	useEffect(() => {
		const handed = take("signing");
		if (handed) setA({ ...EMPTY_INPUT, text: handed });
		const shared = readShared("signing");
		if (shared) {
			if (shared.mode === "compare" || shared.mode === "inspect")
				setMode(shared.mode);
			if (shared.a && typeof shared.a === "object")
				setA({ ...EMPTY_INPUT, ...(shared.a as SigningInput) });
			if (shared.b && typeof shared.b === "object")
				setB({ ...EMPTY_INPUT, ...(shared.b as SigningInput) });
			clearShared();
		}
	}, [take]);

	const loadSample = (id: string) => {
		const s = sampleInput(id);
		if (!s) return;
		setA(s);
		const net = SIGNING_SAMPLES.find((x) => x.id === id)?.network;
		if (net && net !== network) setNetwork(net);
	};

	const parsedA = useMemo(() => parseInput(a), [a]);
	const parsedB = useMemo(() => parseInput(b), [b]);
	const inspA = useInspection(parsedA, network);
	const inspB = useInspection(parsedB, network);
	const pastedPretty =
		parsedA.kind === "ok" ? stringifyJson(parsedA.effective.action) : "";

	return (
		<ToolPage tool={tool("signing")}>
			<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<Segmented<Mode>
					label="Mode"
					value={mode}
					onChange={setMode}
					options={[
						{ value: "inspect", label: "Inspect" },
						{ value: "compare", label: "Compare two payloads" },
					]}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-muted-foreground">
						No private-key input. Nothing is sent anywhere.
					</span>
					<ShareButton
						tool="signing"
						what="payload"
						getState={() => ({ mode, a, b })}
						disabled={!a.text.trim()}
					/>
				</div>
			</div>

			{mode === "inspect" ? (
				<Workspace
					input={
						<>
							<Panel
								title="Input"
								description={`Signing for ${network}. The global network switch sets the phantom-agent source and the expected hyperliquidChain.`}
							>
								<SigningForm
									value={a}
									onChange={setA}
									parsed={parsedA}
									onSample={loadSample}
								/>
							</Panel>
							<Callout tone="neutral" title="Scope">
								Single-signer L1 and user-signed actions. Multi-sig envelopes
								are out of scope. This tool never signs and has no private-key
								field.
							</Callout>
						</>
					}
					output={
						parsedA.kind === "empty" ? (
							<EmptyState
								icon={PenLine}
								title="Paste an action to see exactly what is signed"
								description="The inspector reproduces the MsgPack bytes, action hash, EIP-712 typed data and digest, and recovers the signer from a signature."
								sample='{"type":"order","orders":[{"a":1,"b":true,"p":"100","s":"100","r":false,"t":{"limit":{"tif":"Gtc"}}}],"grouping":"na"}'
								action={
									<Button
										size="sm"
										variant="outline"
										onClick={() => loadSample("order")}
									>
										Try with a sample
									</Button>
								}
							/>
						) : parsedA.kind === "json-error" ? (
							<Callout tone="danger" title="The payload is not valid JSON">
								{parsedA.error.message}. Keys and strings need double quotes,
								and trailing commas are not allowed.
							</Callout>
						) : parsedA.kind === "field-error" ? (
							<Callout tone="danger" title={`Invalid ${parsedA.field}`}>
								{parsedA.message}
							</Callout>
						) : inspA ? (
							<div className="space-y-5">
								<Verdict inspection={inspA} expected={a.expectedSigner} />
								<InspectionView
									inspection={inspA}
									pastedPretty={pastedPretty}
								/>
							</div>
						) : (
							<div className="h-64 animate-pulse rounded-lg border border-border bg-surface" />
						)
					}
				/>
			) : (
				<div className="space-y-5">
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								const [x, y] = trailingZeroPair();
								setA(x);
								setB(y);
								if (network !== "mainnet") setNetwork("mainnet");
							}}
						>
							Load example: trailing zero in price
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => setB(a)}
							disabled={!a.text}
						>
							<Copy className="size-3.5" /> Copy A → B
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setA(b);
								setB(a);
							}}
						>
							<ArrowRightLeft className="size-3.5" /> Swap
						</Button>
					</div>
					<div className="grid min-w-0 gap-5 lg:grid-cols-2">
						<Panel title="A">
							<SigningForm
								value={a}
								onChange={setA}
								parsed={parsedA}
								compact
								label="Payload A"
							/>
						</Panel>
						<Panel title="B">
							<SigningForm
								value={b}
								onChange={setB}
								parsed={parsedB}
								compact
								label="Payload B"
							/>
						</Panel>
					</div>
					{parsedA.kind === "ok" && parsedB.kind === "ok" && inspA && inspB ? (
						<CompareView
							a={inspA}
							b={inspB}
							actionA={parsedA.effective.action}
							actionB={parsedB.effective.action}
						/>
					) : parsedA.kind === "json-error" || parsedB.kind === "json-error" ? (
						<Callout tone="danger" title="One payload is not valid JSON">
							{parsedA.kind === "json-error"
								? `A: ${parsedA.error.message}`
								: ""}
							{parsedB.kind === "json-error"
								? ` B: ${parsedB.error.message}`
								: ""}
						</Callout>
					) : (
						<EmptyState
							title="Paste two payloads to find where they diverge"
							description="Useful when your library and an SDK sign the same order differently: the first divergent MsgPack byte points at the field."
							sample='"p": "100"  vs  "p": "100.0"'
						/>
					)}
				</div>
			)}
		</ToolPage>
	);
}
