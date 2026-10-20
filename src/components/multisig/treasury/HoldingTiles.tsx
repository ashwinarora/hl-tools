import type { Address, Network } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";
import { useStaking } from "../live/useStaking";
import { useVaults } from "../live/useVaults";
import { amountIn } from "../model/headline";
import { balanceView, MODE_UNREAD } from "../model/mode";
import { stakingSummaryLine } from "../model/staking";
import { vaultsSummaryLine } from "../model/vault";
import { Help } from "../shell/Help";
import { Figure, SourceLine, Usdc } from "../shell/live";
import type { LiveTreasuryState } from "../useTreasuryState";

/**
 * The hairlines between tiles: each tile draws its right and lower edge, and
 * the row's frame clips the outer ones, so a short last row leaves no hole.
 */
const LINES =
	"min-w-0 shadow-[1px_0_0_0_var(--border),0_1px_0_0_var(--border)]";

/** One tile: a figure with its label. On a phone an odd last tile takes the row. */
function Tile({ children }: { children: ReactNode }) {
	return (
		<dl className={cn(LINES, "max-[640px]:last:odd:col-span-2")}>{children}</dl>
	);
}

/**
 * The treasury's figures as a row of tiles at the top of its page, above
 * everything else: the balances (pushed live by Hyperliquid, so shown on
 * every section), and on the Overview what sits in staking and in vaults
 * (`holdings`: those are asked for over HTTP once a minute while shown, so
 * they are read only where they were read before). A phone sets them two
 * by two.
 */
export function HoldingTiles({
	network,
	address,
	state,
	holdings,
	linked,
}: {
	network: Network;
	address: Address;
	state: LiveTreasuryState;
	/** Also what is staked and what sits in vaults (the Overview). */
	holdings: boolean;
	/** Whether the treasury's own sections can be linked to (it is in the wallet's list). */
	linked: boolean;
}) {
	const live = state.live;
	// which figures there are depends on the mode: nothing is laid out before it is known
	const view = state.modePending
		? null
		: balanceView(state.mode, live.perp, live.spot);
	return (
		<div className="mb-4 flex flex-col gap-2">
			<SourceLine
				status={live.status}
				asOf={live.asOf}
				onRetry={live.retry}
				reason={live.refused[0]?.reason ?? null}
			>
				Balances, positions and orders arrive live from Hyperliquid. Nothing
				here is stored by this tool. <Help k="live" />
			</SourceLine>
			<div className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-border bg-surface shadow-[var(--shadow-card)] min-[641px]:grid-cols-[repeat(auto-fit,minmax(11.5rem,1fr))]">
				{view === null ? (
					<p
						className={cn(
							LINES,
							"col-span-2 flex min-h-[76px] items-center px-4 text-sm text-muted-foreground min-[641px]:col-span-1",
						)}
					>
						Reading from Hyperliquid…
					</p>
				) : view.kind === "one" ? (
					<>
						<Tile>
							<Figure
								big
								label="Balance"
								value={<Usdc value={view.balance} />}
								unit="USDC"
							/>
						</Tile>
						<Tile>
							<Figure
								big
								label="Can be moved now"
								extra={<Help k="movable" />}
								value={<Usdc value={view.movable} />}
								unit="USDC"
							/>
						</Tile>
						<Tile>
							<Figure
								big
								label="In use"
								extra={<Help k="inUse" />}
								value={<Usdc value={view.inUse} />}
								unit="USDC"
							/>
						</Tile>
					</>
				) : (
					<>
						<Tile>
							<Figure
								big
								label="Perps account value"
								value={<Usdc value={view.perpsValue} />}
								unit="USDC"
							/>
						</Tile>
						<Tile>
							<Figure
								big
								label="Can be moved now"
								extra={<Help k="movable" />}
								value={<Usdc value={view.perpsMovable} />}
								unit="USDC"
							/>
						</Tile>
						<Tile>
							<Figure
								big
								label="Spot USDC"
								value={<Usdc value={view.spotUsdc} />}
								unit="USDC"
							/>
						</Tile>
					</>
				)}
				{holdings && (
					<Holdings
						network={network}
						address={address}
						state={state}
						linked={linked}
					/>
				)}
			</div>
			{state.modeFailed && (
				// laid out without the mode: said, never guessed (audit F-060)
				<p className="flex items-start gap-1.5 text-[13px] text-warning">
					<span
						className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
						aria-hidden
					/>
					<span>{MODE_UNREAD}</span>
				</p>
			)}
		</div>
	);
}

/**
 * A summary line as figures: each part's amount large with its unit, the
 * rest of the part's words under it, word for word ("1.5 HYPE staked" is
 * "1.5" · "HYPE" · "staked"). A part with no amount stays as it is.
 */
function Amounts({ line }: { line: string }) {
	const parts = line.split(" · ");
	return (
		<>
			{parts.map((part, i) => {
				const cut = amountIn(part);
				return (
					<span
						key={part}
						className={cn("block", i > 0 && "mt-1.5 text-sm leading-5")}
					>
						{cut && !cut.before ? (
							<>
								{cut.figure}
								<span className="ml-1.5 font-sans text-xs font-normal tracking-normal text-muted-foreground">
									{cut.unit}
									{cut.after && (
										<>
											{" "}
											<span className="text-subtle-foreground">
												{cut.after}
											</span>
										</>
									)}
								</span>
							</>
						) : (
							<span className="font-sans text-sm">{part}</span>
						)}
						{i < parts.length - 1 && <span className="sr-only"> · </span>}
					</span>
				);
			})}
		</>
	);
}

/** What is staked and what sits in vaults: still the treasury's, though not in its balances. */
function Holdings({
	network,
	address,
	state,
	linked,
}: {
	network: Network;
	address: Address;
	state: LiveTreasuryState;
	linked: boolean;
}) {
	// one read a minute: what is staked does not show in the spot balances
	const staked = stakingSummaryLine(useStaking(state.target).summary);
	// and so is what sits in a vault
	const inVaults = vaultsSummaryLine(useVaults(state.target).deposits);
	return (
		<>
			{staked && (
				// HYPE that left spot for staking is still the treasury's
				<Tile>
					<Figure
						big
						label="In staking"
						value={<Amounts line={staked} />}
						extra={
							linked && (
								<Link
									to="/multisig/t/$network/$address"
									params={{ network, address }}
									search={{ tab: "staking" }}
									className="ml-auto text-xs text-foreground underline underline-offset-2"
								>
									Staking
								</Link>
							)
						}
					/>
				</Tile>
			)}
			{inVaults && (
				// USDC that went into a vault is still the treasury's
				<Tile>
					<Figure
						big
						label="In vaults"
						value={<Amounts line={inVaults} />}
						extra={
							linked && (
								<Link
									to="/multisig/t/$network/$address"
									params={{ network, address }}
									search={{ tab: "vaults" }}
									className="ml-auto text-xs text-foreground underline underline-offset-2"
								>
									Vaults
								</Link>
							)
						}
					/>
				</Tile>
			)}
		</>
	);
}
