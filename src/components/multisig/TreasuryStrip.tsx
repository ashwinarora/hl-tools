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
import type { TreasuryState } from "./useTreasuryState";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The treasury at a glance, on every signer screen: who must sign, which API
 * wallets can trade without them, and what the account holds. Observed, with
 * its network and time, and refreshed while the screen is open.
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
	const usdc = state.spot?.balances.find((b) => b.coin === "USDC");
	const otherTokens =
		state.spot?.balances.filter(
			(b) => b.coin !== "USDC" && Number(b.total) !== 0,
		).length ?? 0;
	const now = Date.now();
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
					signer set on {target.network}…
				</div>
			) : state.error ? (
				<Callout
					tone="danger"
					title="Could not read the signer set"
					action={
						<Button size="sm" variant="outline" onClick={state.refetch}>
							Retry
						</Button>
					}
				>
					{state.error}
				</Callout>
			) : state.isMultiSig === false ? (
				<Callout tone="warning" title={`Not a multi-sig on ${target.network}`}>
					{short(target.address)} has no signer set there. Check the address and
					the network in the header.
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
								label: "API wallets (trade without the multi-sig)",
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
													<span>{a.name || "(unnamed)"}</span>
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
															until {day(a.validUntil)}
														</Pill>
													)}
												</span>
											))}
										</span>
									),
							},
							{
								label: "Perps (account value · withdrawable)",
								value: state.perp
									? `${state.perp.marginSummary.accountValue} · ${state.perp.withdrawable} USDC`
									: "—",
								mono: true,
							},
							{
								label: "Spot",
								value: state.spot
									? `${usdc?.total ?? "0"} USDC${otherTokens ? ` + ${otherTokens} other token${otherTokens > 1 ? "s" : ""}` : ""}`
									: "—",
								mono: true,
							},
						]}
					/>
					{state.observedAt !== null && (
						<ObservedLine
							network={target.network}
							observedAt={state.observedAt}
							source={`${state.requests} info requests · weight ${state.weight}${state.live ? " · refreshed every 30 s while open" : ""}`}
						/>
					)}
				</div>
			)}
		</Panel>
	);
}
