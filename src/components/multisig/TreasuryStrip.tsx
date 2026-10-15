import { type Network, visibleText } from "@hl-tools/core";
import { Loader2 } from "lucide-react";
import { KeyValueGrid, Panel } from "#/components/hub/layout";
import {
	Callout,
	NetworkBadge,
	ObservedLine,
	Pill,
} from "#/components/hub/status";
import { AddressLine, short } from "#/components/tools/multisig/AddressLine";
import { Button } from "#/components/ui/button";
import { API_WALLET_ROW } from "./model/apiWallet";
import { balanceView, modeLabel } from "./model/mode";
import { useTreasuries } from "./relay/queries";
import { When } from "./shell/live";
import type { TreasuryState } from "./useTreasuryState";

/**
 * An address Hyperliquid reports no signers for. A treasury the sharing
 * service knows was converted back is said as that, with when it noticed:
 * the reader made no mistake. Anything else may be a wrong address or network.
 */
function NotATreasury({
	address,
	network,
}: {
	address: string;
	network: Network;
}) {
	const { rows } = useTreasuries();
	const known = rows.find(
		(t) =>
			t.network === network &&
			t.address === address.toLowerCase() &&
			t.frozenAt !== null,
	);
	return known?.frozenAt ? (
		<>
			{short(address)} was converted back to a normal account (seen{" "}
			<When at={known.frozenAt} />
			). Nothing new can be proposed for it.
		</>
	) : (
		<>
			Hyperliquid reports no signers for {short(address)} there. If it was a
			treasury, it has been converted back to a normal account; if not, check
			the address and the network in the header.
		</>
	);
}

/**
 * The treasury at a glance, on every signer screen: who must sign, which API
 * wallets can trade without them, and what the account holds. Observed, with
 * its network and time; on a page that stays open the holdings arrive live.
 */
export function TreasuryStrip({
	state,
	wallet,
}: {
	state: TreasuryState;
	/** The connected wallet, to mark it among the signers. */
	wallet?: string | null;
}) {
	const { target } = state;
	if (!target) return null;
	const me = wallet?.toLowerCase();
	const otherTokens =
		state.spot?.filter((b) => b.coin !== "USDC" && Number(b.total) !== 0)
			.length ?? 0;
	const now = Date.now();
	const mode = state.mode ? modeLabel(state.mode) : null;
	// which balances there are depends on the mode: none are listed before it is known
	const view = state.modePending
		? null
		: balanceView(state.mode, state.perp, state.spot);
	const others = otherTokens
		? ` + ${otherTokens} other token${otherTokens > 1 ? "s" : ""}`
		: "";
	return (
		<Panel
			title={
				<span className="flex items-center gap-2">
					Treasury <NetworkBadge network={target.network} />
				</span>
			}
			description={
				<AddressLine address={target.address} network={target.network} />
			}
		>
			{state.loading ? (
				<div
					className="flex items-center gap-2 text-sm text-muted-foreground"
					aria-busy="true"
				>
					<Loader2 className="size-4 animate-spin" aria-hidden /> Reading the
					signers on {target.network}…
				</div>
			) : state.error ? (
				<Callout
					tone="danger"
					title="Could not read the signers from Hyperliquid"
					action={
						<Button size="sm" variant="outline" onClick={state.refetch}>
							Retry
						</Button>
					}
				>
					{state.error}
				</Callout>
			) : state.isMultiSig === false ? (
				<Callout tone="warning" title={`Not a treasury on ${target.network}`}>
					<NotATreasury address={target.address} network={target.network} />
				</Callout>
			) : (
				<div className="space-y-3">
					<KeyValueGrid
						columns={2}
						items={[
							{
								label: "Signers",
								value: (
									<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
										<span>
											{state.policy?.threshold} of{" "}
											{state.policy?.authorizedUsers.length} must sign
										</span>
										{state.policy?.authorizedUsers.map((a) => (
											<span
												key={a}
												className="font-mono text-xs text-muted-foreground"
												title={a}
											>
												{short(a)}
												{a === me ? " (you)" : ""}
											</span>
										))}
									</span>
								),
							},
							{
								label: API_WALLET_ROW,
								value:
									state.agents === null ? (
										"could not be loaded"
									) : state.agents.length === 0 ? (
										"none"
									) : (
										<span className="flex flex-col gap-1">
											{state.agents.map((a) => (
												<span
													key={a.address}
													className="flex flex-wrap items-center gap-2"
												>
													<span>
														{a.name ? visibleText(a.name) : "(unnamed)"}
													</span>
													<span
														className="font-mono text-xs text-muted-foreground"
														title={a.address}
													>
														{short(a.address)}
													</span>
													{a.validUntil <= now ? (
														<Pill tone="neutral">expired</Pill>
													) : (
														<Pill tone="warning">
															until <When at={a.validUntil} />
														</Pill>
													)}
												</span>
											))}
										</span>
									),
							},
							...(mode
								? [
										{
											label: "Account mode",
											value: (
												<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
													<Pill tone={mode.caution ? "warning" : "neutral"}>
														{mode.tag}
													</Pill>
													<span className="text-muted-foreground">
														{mode.text}
													</span>
												</span>
											),
										},
									]
								: []),
							...(view?.kind === "one"
								? [
										{
											label: "Balance",
											value:
												view.balance === null
													? "—"
													: `${view.balance} USDC${others}`,
											mono: true,
										},
										{
											label: "Can be moved now",
											value:
												view.movable === null ? "—" : `${view.movable} USDC`,
											mono: true,
										},
									]
								: view
									? [
											{
												label: "Perps (account value · withdrawable)",
												value:
													view.perpsValue === null
														? "—"
														: `${view.perpsValue} · ${view.perpsMovable} USDC`,
												mono: true,
											},
											{
												label: "Spot",
												value:
													view.spotUsdc === null
														? "—"
														: `${view.spotUsdc} USDC${others}`,
												mono: true,
											},
										]
									: []),
						]}
					/>
					{state.observedAt !== null && (
						<ObservedLine
							network={target.network}
							observedAt={state.observedAt}
							source={state.source}
						/>
					)}
				</div>
			)}
		</Panel>
	);
}
