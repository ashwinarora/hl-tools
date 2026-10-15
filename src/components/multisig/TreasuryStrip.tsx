import { type Network, visibleText } from "@hl-tools/core";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Callout, NetworkBadge, ObservedLine } from "#/components/hub/status";
import { AddressLine, short } from "#/components/tools/multisig/AddressLine";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";
import { API_WALLET_ROW } from "./model/apiWallet";
import { balanceView, modeLabel } from "./model/mode";
import { useTreasuries } from "./relay/queries";
import { Tag } from "./shell/kit";
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
 * One fact of the strip: its label over its value. The facts sit side by
 * side and wrap onto a new row where the screen is narrow; a thin line
 * parts them either way.
 */
function Fact({
	label,
	children,
	mono = false,
	className,
}: {
	label: ReactNode;
	children: ReactNode;
	mono?: boolean;
	/** Its share of the row: `flex` grow and basis. */
	className?: string;
}) {
	return (
		<div
			className={cn(
				"-mt-px -ml-px min-w-0 border-t border-l border-border px-4 py-3",
				className ?? "flex-[1_1_10rem]",
			)}
		>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd
				className={cn(
					"mt-1 min-w-0 text-sm text-foreground [overflow-wrap:anywhere]",
					mono && "font-mono text-[13px] tabular-nums",
				)}
			>
				{children}
			</dd>
		</div>
	);
}

/**
 * The treasury at a glance, on every signer screen: who must sign, which API
 * wallets can trade without them, and what the account holds. Observed, with
 * its network and time; on a page that stays open the holdings arrive live.
 * Laid out as a strip across the page: the address on top, the facts in one
 * row under it, the moment they were read at the bottom.
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
		<section className="min-w-0 overflow-hidden rounded-[10px] border border-border bg-surface shadow-[var(--shadow-card)]">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					Treasury <NetworkBadge network={target.network} />
				</h2>
				<div className="min-w-0 text-xs text-muted-foreground">
					<AddressLine address={target.address} network={target.network} />
				</div>
			</header>
			{state.loading ? (
				<div
					className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground"
					aria-busy="true"
				>
					<Loader2 className="size-4 animate-spin" aria-hidden /> Reading the
					signers on {target.network}…
				</div>
			) : state.error ? (
				<div className="p-4">
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
				</div>
			) : state.isMultiSig === false ? (
				<div className="p-4">
					<Callout tone="warning" title={`Not a treasury on ${target.network}`}>
						<NotATreasury address={target.address} network={target.network} />
					</Callout>
				</div>
			) : (
				<>
					{/* the clipped edge hides each row's first dividing line */}
					<dl className="flex flex-wrap overflow-hidden">
						<Fact label="Signers" className="flex-[1.2_1_12rem]">
							<span className="block">
								{state.policy?.threshold} of{" "}
								{state.policy?.authorizedUsers.length} must sign
							</span>
							<span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
								{state.policy?.authorizedUsers.map((a) => (
									<span
										key={a}
										className="whitespace-nowrap font-mono text-xs text-muted-foreground"
										title={a}
									>
										{short(a)}
										{a === me ? " (you)" : ""}
									</span>
								))}
							</span>
						</Fact>
						<Fact label={API_WALLET_ROW} className="flex-[1.2_1_12rem]">
							{state.agents === null ? (
								"could not be loaded"
							) : state.agents.length === 0 ? (
								"none"
							) : (
								<span className="flex flex-col gap-1.5">
									{state.agents.map((a) => (
										<span
											key={a.address}
											className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
										>
											<span className="min-w-0 [overflow-wrap:anywhere]">
												{a.name ? visibleText(a.name) : "(unnamed)"}
											</span>
											<span
												className="font-mono text-xs text-muted-foreground"
												title={a.address}
											>
												{short(a.address)}
											</span>
											{a.validUntil <= now ? (
												<Tag>expired</Tag>
											) : (
												<Tag tone="warn" className="whitespace-normal">
													{/* one piece of text: a flex row would drop the space after "until" */}
													<span>
														until <When at={a.validUntil} />
													</span>
												</Tag>
											)}
										</span>
									))}
								</span>
							)}
						</Fact>
						{mode && (
							<Fact label="Account mode" className="flex-[1.5_1_15rem]">
								<span className="flex flex-col items-start gap-1">
									<Tag tone={mode.caution ? "warn" : "gray"}>{mode.tag}</Tag>
									<span className="text-xs text-muted-foreground">
										{mode.text}
									</span>
								</span>
							</Fact>
						)}
						{view?.kind === "one" ? (
							<>
								<Fact label="Balance" mono>
									{view.balance === null
										? "—"
										: `${view.balance} USDC${others}`}
								</Fact>
								<Fact label="Can be moved now" mono>
									{view.movable === null ? "—" : `${view.movable} USDC`}
								</Fact>
							</>
						) : view ? (
							<>
								<Fact label="Perps (account value · withdrawable)" mono>
									{view.perpsValue === null
										? "—"
										: `${view.perpsValue} · ${view.perpsMovable} USDC`}
								</Fact>
								<Fact label="Spot" mono>
									{view.spotUsdc === null
										? "—"
										: `${view.spotUsdc} USDC${others}`}
								</Fact>
							</>
						) : null}
					</dl>
					{state.observedAt !== null && (
						<ObservedLine
							network={target.network}
							observedAt={state.observedAt}
							source={state.source}
							className="border-t border-border bg-surface-2/50 px-4 py-2"
						/>
					)}
				</>
			)}
		</section>
	);
}
