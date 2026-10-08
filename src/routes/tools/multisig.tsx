import { isAddress, MULTISIG_SAMPLES, type Network } from "@hl-tools/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Segmented, ToolPage } from "#/components/hub/layout";
import { ShareButton } from "#/components/hub/ShareButton";
import { AccountView } from "#/components/tools/multisig/AccountView";
import { EnvelopeView } from "#/components/tools/multisig/EnvelopeView";
import {
	type AccountTarget,
	ADDRESS_RE,
} from "#/components/tools/multisig/model";
import { clearShared, readShared } from "#/lib/share";
import { tool } from "#/lib/tools";
import { useHandoffStore } from "#/store/handoffStore";
import {
	useNetwork,
	useNetworkHydrated,
	useNetworkStore,
} from "#/store/networkStore";

type View = "account" | "envelope";
export const Route = createFileRoute("/tools/multisig")({
	validateSearch: (
		s: Record<string, unknown>,
	): { view?: View; address?: string; sample?: string } => ({
		view: s.view === "envelope" || s.view === "account" ? s.view : undefined,
		address: typeof s.address === "string" ? s.address : undefined,
		sample: typeof s.sample === "string" ? s.sample : undefined,
	}),
	head: () => ({ meta: [{ title: "Multisig Inspector — hl-tools" }] }),
	component: MultisigTool,
});

function MultisigTool() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const network = useNetwork();
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const hydrated = useNetworkHydrated();
	const take = useHandoffStore((s) => s.take);
	const send = useHandoffStore((s) => s.send);
	const [view, setView] = useState<View>(search.view ?? "account");
	const [addressInput, setAddressInput] = useState(search.address ?? "");
	const [target, setTarget] = useState<AccountTarget | null>(null);
	const [envelopeText, setEnvelopeText] = useState("");

	const lookup = (raw: string, net: Network = network) => {
		const address = raw.trim();
		if (!ADDRESS_RE.test(address)) return;
		const lower = address.toLowerCase() as `0x${string}`;
		setAddressInput(lower);
		setTarget({ address: lower, network: net });
		setView("account");
		void navigate({
			to: "/tools/multisig",
			search: { view: "account", address: lower },
			replace: true,
		});
	};

	const loadSample = (id: string) => {
		const s = MULTISIG_SAMPLES.find((x) => x.id === id);
		if (!s) return;
		if (s.network !== network) setNetwork(s.network);
		if (s.kind === "account") lookup(s.input, s.network);
		else {
			setView("envelope");
			setEnvelopeText(s.input);
		}
	};

	// Samples and the ?address= target are applied once the persisted network is known,
	// so a testnet sample cannot be overridden by the stored preference a moment later.
	const [applied, setApplied] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once, after hydration
	useEffect(() => {
		if (!hydrated || applied) return;
		setApplied(true);
		if (search.sample) loadSample(search.sample);
		else if (search.address && isAddress(search.address))
			lookup(search.address, network);
	}, [hydrated, applied]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a hand-off is taken once, on mount
	useEffect(() => {
		const handed = take("multisig");
		if (handed) {
			if (ADDRESS_RE.test(handed.trim())) lookup(handed);
			else {
				setView("envelope");
				setEnvelopeText(handed);
			}
		}
		const shared = readShared("multisig");
		if (shared && typeof shared.text === "string") {
			setView("envelope");
			setEnvelopeText(shared.text);
			clearShared();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- hand-off is read once on mount
	}, [take]);

	return (
		<ToolPage tool={tool("multisig")}>
			<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<Segmented<View>
					label="View"
					value={view}
					onChange={(v) => {
						setView(v);
						void navigate({
							to: "/tools/multisig",
							search: { view: v, address: search.address },
							replace: true,
						});
					}}
					options={[
						{ value: "account", label: "Account" },
						{ value: "envelope", label: "Envelope / proposal" },
					]}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-muted-foreground">
						Read-only. Nothing is stored; every number is fetched from
						Hyperliquid when you look.
					</span>
					<ShareButton
						tool="multisig"
						what="envelope text"
						getState={() => ({ view: "envelope", text: envelopeText })}
						disabled={view !== "envelope" || !envelopeText.trim()}
					/>
				</div>
			</div>
			{view === "account" ? (
				<AccountView
					input={addressInput}
					onInput={setAddressInput}
					onLookup={() => lookup(addressInput)}
					target={target}
					network={network}
					onRelookup={() => target && lookup(target.address, network)}
					onSample={() => loadSample("lab-treasury")}
				/>
			) : (
				<EnvelopeView
					text={envelopeText}
					onChange={setEnvelopeText}
					network={network}
					onSample={loadSample}
					onHandOff={() => {
						send("signing", envelopeText);
						void navigate({ to: "/tools/signing" });
					}}
				/>
			)}
		</ToolPage>
	);
}
