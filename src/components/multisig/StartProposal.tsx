import { LAB_TREASURY } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Field, Panel, TextInput } from "#/components/hub/layout";
import {
	type AccountTarget,
	ADDRESS_RE,
} from "#/components/tools/multisig/model";
import { Button } from "#/components/ui/button";
import {
	useNetwork,
	useNetworkHydrated,
	useNetworkStore,
} from "#/store/networkStore";
import { TreasuryStrip } from "./TreasuryStrip";
import { useTreasuryState } from "./useTreasuryState";

/** Begin a proposal: name the treasury, see who signs for it, continue to the form. */
export function StartProposal({ wallet }: { wallet?: string | null }) {
	const network = useNetwork();
	const hydrated = useNetworkHydrated();
	// This chunk can hydrate after the root has already restored the stored
	// network, so `hydrated` may be true on the first client render while the
	// server rendered false. React does not repair a mismatched attribute, and
	// the sample button would stay disabled; start from the server's answer.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const ready = mounted && hydrated;
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const [input, setInput] = useState("");
	const [checked, setChecked] = useState<AccountTarget | null>(null);
	const valid = ADDRESS_RE.test(input.trim());
	const state = useTreasuryState(checked);
	// the result belongs to the network it was read on, like every lookup in the hub
	const stale = checked !== null && checked.network !== network;
	const address = useMemo(() => input.trim().toLowerCase(), [input]);

	const check = (value: string, on = network) => {
		const v = value.trim().toLowerCase();
		if (!ADDRESS_RE.test(v)) return;
		setInput(v);
		setChecked({ address: v as `0x${string}`, network: on });
	};

	return (
		<div className="space-y-4">
			<Panel
				title="Start a proposal"
				description="For one multi-sig account, on the network selected in the header."
			>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						check(input);
					}}
				>
					<Field
						label="Multi-sig account (treasury)"
						htmlFor="ms-treasury"
						error={
							input.trim() && !valid
								? "A 20-byte hex address: 0x followed by 40 hex digits."
								: undefined
						}
					>
						<TextInput
							id="ms-treasury"
							mono
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder="0x…"
							aria-invalid={!!input.trim() && !valid}
						/>
					</Field>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="submit"
							size="sm"
							variant="brand"
							disabled={!valid || !ready}
						>
							Check on {network}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={!ready}
							onClick={() => {
								setNetwork("testnet");
								check(LAB_TREASURY, "testnet");
							}}
						>
							Lab treasury (testnet)
						</Button>
						{checked &&
							!stale &&
							state.isMultiSig === true &&
							checked.address === address && (
								<Link
									to="/multisig/propose"
									search={{ treasury: checked.address }}
									className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2"
								>
									Propose an action →
								</Link>
							)}
					</div>
				</form>
			</Panel>
			{checked && !stale && <TreasuryStrip state={state} wallet={wallet} />}
		</div>
	);
}
