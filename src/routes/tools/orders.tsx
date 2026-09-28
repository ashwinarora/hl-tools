import type { Asset } from "@hl-tools/core";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Segmented, ToolPage } from "#/components/hub/layout";
import { ShareButton } from "#/components/hub/ShareButton";
import {
	type ComposeState,
	ComposeTab,
	DEFAULT_COMPOSE,
} from "#/components/tools/orders/ComposeTab";
import {
	EXPLAIN_SAMPLES,
	ExplainTab,
} from "#/components/tools/orders/ExplainTab";
import { useUniverse } from "#/hooks/useHyperliquid";
import { clearShared, readShared } from "#/lib/share";
import { tool } from "#/lib/tools";
import { useHandoffStore } from "#/store/handoffStore";
import { useNetwork, useNetworkHydrated } from "#/store/networkStore";

type Tab = "compose" | "explain";

export const Route = createFileRoute("/tools/orders")({
	validateSearch: (
		s: Record<string, unknown>,
	): { sample?: string; tab?: Tab } => ({
		sample: typeof s.sample === "string" ? s.sample : undefined,
		tab: s.tab === "explain" || s.tab === "compose" ? s.tab : undefined,
	}),
	head: () => ({
		meta: [{ title: "Order Composer & Failure Explainer — hl-tools" }],
	}),
	component: OrdersTool,
});

function OrdersTool() {
	const search = Route.useSearch();
	const network = useNetwork();
	const hydrated = useNetworkHydrated();
	const take = useHandoffStore((s) => s.take);
	const explainSample = EXPLAIN_SAMPLES.find((s) => s.id === search.sample);
	const [tab, setTab] = useState<Tab>(
		search.tab ?? (explainSample ? "explain" : "compose"),
	);
	const [asset, setAsset] = useState<Asset | null>(null);
	const [compose, setCompose] = useState<ComposeState>(DEFAULT_COMPOSE);
	const [response, setResponse] = useState(explainSample?.response ?? "");
	const [request, setRequest] = useState(explainSample?.request ?? "");
	const universe = useUniverse(network);

	// The TP/SL sample explicitly picks the BTC perp (a sample's choice, not the resolver's).
	const [samplePicked, setSamplePicked] = useState(false);
	useEffect(() => {
		if (search.sample !== "tpsl" || samplePicked || !hydrated || !universe.data)
			return;
		const btc = universe.data.byCoin.get("BTC");
		if (btc) {
			setAsset(btc);
			setCompose({ ...DEFAULT_COMPOSE, intent: "long-tpsl" });
		}
		setSamplePicked(true);
	}, [search.sample, samplePicked, hydrated, universe.data]);

	useEffect(() => {
		const handed = take("orders");
		if (handed) {
			setResponse(handed);
			setTab("explain");
		}
		const shared = readShared("orders");
		if (shared) {
			if (typeof shared.response === "string") setResponse(shared.response);
			if (typeof shared.request === "string") setRequest(shared.request);
			setTab("explain");
			clearShared();
		}
	}, [take]);

	return (
		<ToolPage tool={tool("orders")}>
			<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<Segmented<Tab>
					label="Mode"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "compose", label: "Compose" },
						{ value: "explain", label: "Explain a response" },
					]}
				/>
				{tab === "explain" && (
					<ShareButton
						tool="orders"
						what="response"
						getState={() => ({ response, request })}
						disabled={!response.trim()}
					/>
				)}
			</div>
			{tab === "compose" ? (
				<ComposeTab
					network={network}
					asset={asset}
					onAsset={setAsset}
					state={compose}
					onState={setCompose}
				/>
			) : (
				<ExplainTab
					response={response}
					request={request}
					onResponse={setResponse}
					onRequest={setRequest}
				/>
			)}
		</ToolPage>
	);
}
