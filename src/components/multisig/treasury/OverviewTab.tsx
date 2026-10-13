import type {
	Address,
	Network,
	OrderRow,
	PositionRow,
	SpotBalanceRow,
} from "@hl-tools/core";
import { visibleText } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useMultisigDrafts } from "#/store/multisigDraftsStore";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { useStaking } from "../live/useStaking";
import { useVaults } from "../live/useVaults";
import { API_WALLET_FORMER, API_WALLET_SENTENCE } from "../model/apiWallet";
import {
	amountText,
	compareAmount,
	compareNumber,
	compareText,
	explorerAccountUrl,
	isNonZero,
	orderSide,
	orderTypeText,
	positionSide,
	signedText,
	sizeOf,
} from "../model/chain/columns";
import { approvalOf } from "../model/chain/match";
import { CHANGE } from "../model/change";
import { balanceView, modeLabel } from "../model/mode";
import { RELAY_COPY } from "../model/relay/copy";
import { type LastSigned, lastSignedText } from "../model/relay/lastSigned";
import type { TreasuryRow } from "../model/relay/rows";
import { stakingSummaryLine } from "../model/staking";
import { fromNow, localDateTime } from "../model/time";
import { vaultsSummaryLine } from "../model/vault";
import { Who } from "../names/Names";
import { Checked } from "../shell/Checked";
import { type DataColumn, DataTable } from "../shell/DataTable";
import { Help } from "../shell/Help";
import { Btn, Card, linkButtonSm, PersonRow, Tag } from "../shell/kit";
import { Figure, SourceLine, toneOf, useNow, When } from "../shell/live";
import type { LiveTreasuryState } from "../useTreasuryState";
import type { KnownProposal } from "./useKnownProposals";
import { useLastSigned } from "./useLastSigned";

/** The exact moment behind "last signed 2 days ago", for the hover. */
const signedTitle = (l: LastSigned | undefined) =>
	l?.kind === "signed" ? localDateTime(l.at) : undefined;

const DAY = 86_400_000;
/** An API wallet this close to its expiry is pointed out. */
const EXPIRES_SOON_MS = 7 * DAY;

const sideClass = (buyOrLong: boolean) =>
	buyOrLong ? "text-success" : "text-danger";

const SPOT: readonly DataColumn<SpotBalanceRow>[] = [
	{
		id: "coin",
		header: "Token",
		sort: (a, b) => compareText(a.coin, b.coin),
		cell: (r) => r.coin,
	},
	{
		id: "total",
		header: "Total",
		numeric: true,
		sort: (a, b) => compareAmount(a.total, b.total),
		cell: (r) => amountText(r.total),
	},
	{
		id: "hold",
		header: "On hold",
		headerExtra: <Help k="onHold" />,
		numeric: true,
		sort: (a, b) => compareAmount(a.hold, b.hold),
		cell: (r) => amountText(r.hold),
	},
	{
		id: "available",
		header: "Available",
		numeric: true,
		sort: (a, b) => compareAmount(a.available, b.available),
		cell: (r) => amountText(r.available),
	},
];

const POSITIONS: readonly DataColumn<PositionRow>[] = [
	{
		id: "coin",
		header: "Market",
		sort: (a, b) => compareText(a.coin, b.coin),
		cell: (r) => r.coin,
	},
	{
		id: "side",
		header: "Side",
		sort: (a, b) => compareText(positionSide(a.szi), positionSide(b.szi)),
		cell: (r) => positionSide(r.szi),
		cellClass: (r) => sideClass(positionSide(r.szi) === "Long"),
	},
	{
		id: "size",
		header: "Size",
		numeric: true,
		sort: (a, b) => compareAmount(sizeOf(a.szi), sizeOf(b.szi)),
		cell: (r) => amountText(sizeOf(r.szi)),
	},
	{
		id: "value",
		header: "Value, USDC",
		numeric: true,
		sort: (a, b) => compareAmount(a.positionValue, b.positionValue),
		cell: (r) => amountText(r.positionValue, { maxDecimals: 2 }),
	},
	{
		id: "entry",
		header: "Entry",
		numeric: true,
		sort: (a, b) => compareAmount(a.entryPx, b.entryPx),
		cell: (r) => amountText(r.entryPx),
	},
	{
		id: "mark",
		header: "Mark",
		numeric: true,
		sort: (a, b) => compareAmount(a.markPx, b.markPx),
		cell: (r) => amountText(r.markPx),
	},
	{
		id: "pnl",
		header: "Unrealised profit",
		headerExtra: <Help k="unrealised" />,
		numeric: true,
		sort: (a, b) => compareAmount(a.unrealizedPnl, b.unrealizedPnl),
		cell: (r) => signedText(r.unrealizedPnl, { maxDecimals: 2 }),
		cellClass: (r) => toneOf(r.unrealizedPnl),
	},
	{
		id: "liq",
		header: "Liquidation price",
		headerExtra: <Help k="liquidation" />,
		numeric: true,
		sort: (a, b) => compareAmount(a.liquidationPx, b.liquidationPx),
		cell: (r) => amountText(r.liquidationPx),
	},
];

const ORDERS: readonly DataColumn<OrderRow>[] = [
	{
		id: "placed",
		header: "Placed",
		descFirst: true,
		sort: (a, b) => compareNumber(a.timestamp, b.timestamp),
		cell: (r) => <When at={r.timestamp} seconds />,
	},
	{
		id: "coin",
		header: "Market",
		sort: (a, b) => compareText(a.coin, b.coin),
		cell: (r) => r.coin,
	},
	{
		id: "side",
		header: "Side",
		sort: (a, b) => compareText(orderSide(a.side), orderSide(b.side)),
		cell: (r) => orderSide(r.side),
		cellClass: (r) => sideClass(r.side === "B"),
	},
	{
		id: "type",
		header: "Type",
		sort: (a, b) => compareText(orderTypeText(a), orderTypeText(b)),
		cell: orderTypeText,
	},
	{
		id: "price",
		header: "Price",
		numeric: true,
		sort: (a, b) => compareAmount(a.limitPx, b.limitPx),
		cell: (r) => amountText(r.limitPx),
	},
	{
		id: "size",
		header: "Size",
		numeric: true,
		sort: (a, b) => compareAmount(a.sz, b.sz),
		cell: (r) => amountText(r.sz),
	},
];

const key = (r: { readonly key: string }) => r.key;

function Quiet({ children }: { children: ReactNode }) {
	return <span className="text-sm text-muted-foreground">{children}</span>;
}

/**
 * The treasury now: what it holds (pushed live by Hyperliquid) and who
 * controls it (asked for once a minute). Read-only; nothing here is stored.
 */
export function OverviewTab({
	network,
	address,
	state,
	me,
	treasury,
	proposals,
}: {
	network: Network;
	address: Address;
	state: LiveTreasuryState;
	me: Address | null;
	/** The relay's entry for this treasury; null when the relay cannot be asked. */
	treasury: TreasuryRow | null;
	/** The proposals on record, to say which one approved an API wallet. */
	proposals: readonly KnownProposal[];
}) {
	const now = useNow();
	const live = state.live;
	const spot = useMemo(
		() => live.spot?.filter((b) => isNonZero(b.total)) ?? [],
		[live.spot],
	);
	const positions = live.perp?.positions ?? [];
	const orders = live.openOrders ?? [];
	const mode = state.mode ? modeLabel(state.mode) : null;
	const reading = "Reading from Hyperliquid…";
	// which figures there are depends on the mode: nothing is laid out before it is known
	const view = state.modePending
		? null
		: balanceView(state.mode, live.perp, live.spot);
	const usdc = (v: string | null) =>
		v === null ? "…" : amountText(v, { maxDecimals: 2, minDecimals: 2 });
	// one read a minute: what is staked does not show in the spot balances
	const staked = stakingSummaryLine(useStaking(state.target).summary);
	// and so is what sits in a vault
	const inVaults = vaultsSummaryLine(useVaults(state.target).deposits);

	// who signs: the chain's list once it is read; the relay's copy until then,
	// and for an account that is no longer a multi-sig
	const frozen = treasury ? treasury.frozenAt !== null : false;
	const signers = state.policy?.authorizedUsers ?? treasury?.signers ?? [];
	// from the relay's history: only where the relay lists the treasury for this wallet
	const signed = useLastSigned(network, address, signers, !!treasury);
	const threshold = state.policy?.threshold ?? treasury?.threshold ?? null;
	const active = state.agents?.filter((g) => g.validUntil > now).length ?? null;
	// a proposal is made by a signer of an account that is still a multi-sig
	const canPropose = !frozen && !!me && signers.includes(me);

	const hydrated = usePrefsHydrated();
	const prefsKey = treasuryKey(network, address);
	const hidden = useMultisigPrefs((s) => s.hidden.includes(prefsKey));
	const setHidden = useMultisigPrefs((s) => s.setHidden);

	return (
		<div className="flex flex-col gap-4">
			<SourceLine status={live.status} onRetry={live.retry}>
				Balances, positions and orders arrive live from Hyperliquid. Nothing
				here is stored by this tool. <Help k="live" />
			</SourceLine>

			{live.otherDexes && live.otherDexes.length > 0 && (
				<div className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground">
					This treasury also holds something in{" "}
					{live.otherDexes.length === 1
						? "another perps market"
						: `${live.otherDexes.length} other perps markets`}{" "}
					run by builders ({live.otherDexes.join(", ")}). Those are not shown
					here.{" "}
					<a
						href={explorerAccountUrl(network, address)}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 whitespace-nowrap text-brand underline underline-offset-2"
					>
						View the account on Hyperliquid
						<ExternalLink className="size-3" aria-hidden />
					</a>
				</div>
			)}

			<Card
				title={
					<span className="inline-flex items-center gap-1.5">
						Balances {view?.kind === "two" && <Help k="perpsSpot" />}
					</span>
				}
				actions={
					mode ? (
						<span className="inline-flex items-center gap-1.5">
							<Tag tone={mode.caution ? "warn" : "gray"} title={mode.text}>
								{mode.tag}
							</Tag>
							<Help k="accountMode" />
							{canPropose && (
								<Link
									to="/multisig/propose"
									search={{ treasury: address, kind: "accountMode", network }}
									className={linkButtonSm}
									aria-label="Change the account mode"
								>
									Change
								</Link>
							)}
						</span>
					) : null
				}
				flush
			>
				{view === null ? (
					<p className="flex min-h-[70px] items-center border-b border-border px-4 text-sm text-muted-foreground">
						{reading}
					</p>
				) : (
					<dl className="grid grid-cols-1 divide-y divide-border border-b border-border min-[641px]:grid-cols-3 min-[641px]:divide-x min-[641px]:divide-y-0">
						{view.kind === "one" ? (
							<>
								<Figure
									label="Balance"
									value={usdc(view.balance)}
									unit="USDC"
								/>
								<Figure
									label="Can be moved now"
									extra={<Help k="movable" />}
									value={usdc(view.movable)}
									unit="USDC"
								/>
								<Figure
									label="In use"
									extra={<Help k="inUse" />}
									value={usdc(view.inUse)}
									unit="USDC"
								/>
							</>
						) : (
							<>
								<Figure
									label="Perps account value"
									value={usdc(view.perpsValue)}
									unit="USDC"
								/>
								<Figure
									label="Can be moved now"
									extra={<Help k="movable" />}
									value={usdc(view.perpsMovable)}
									unit="USDC"
								/>
								<Figure
									label="Spot USDC"
									value={usdc(view.spotUsdc)}
									unit="USDC"
								/>
							</>
						)}
					</dl>
				)}
				<DataTable
					label="Spot balances"
					columns={SPOT}
					rows={spot}
					rowKey={key}
					initialSort={{ id: "total", desc: true }}
					empty={live.spot === null ? reading : "No spot balances."}
				/>
				{staked && (
					// HYPE that left spot for staking is still the treasury's
					<p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 py-2.5 text-[13px]">
						<span className="text-muted-foreground">In staking:</span>
						<span>{staked}</span>
						{treasury && (
							<Link
								to="/multisig/t/$network/$address"
								params={{ network, address }}
								search={{ tab: "staking" }}
								className="text-xs underline underline-offset-2"
							>
								Staking
							</Link>
						)}
					</p>
				)}
				{inVaults && (
					// USDC that went into a vault is still the treasury's
					<p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 py-2.5 text-[13px]">
						<span className="text-muted-foreground">In vaults:</span>
						<span>{inVaults}</span>
						{treasury && (
							<Link
								to="/multisig/t/$network/$address"
								params={{ network, address }}
								search={{ tab: "vaults" }}
								className="text-xs underline underline-offset-2"
							>
								Vaults
							</Link>
						)}
					</p>
				)}
			</Card>

			{positions.length > 0 && (
				<Card title="Positions" actions={<Tag>{positions.length}</Tag>} flush>
					<DataTable
						label="Open positions"
						columns={POSITIONS}
						rows={positions}
						rowKey={key}
						initialSort={{ id: "value", desc: true }}
						empty="No positions."
					/>
				</Card>
			)}
			{orders.length > 0 && (
				<Card title="Open orders" actions={<Tag>{orders.length}</Tag>} flush>
					<DataTable
						label="Open orders"
						columns={ORDERS}
						rows={orders}
						rowKey={key}
						initialSort={{ id: "placed", desc: true }}
						empty="No open orders."
					/>
				</Card>
			)}
			{positions.length > 0 || orders.length > 0 ? (
				<p className="mx-0.5 -mt-2 text-xs text-subtle-foreground">
					Positions and orders are placed by an API wallet, not through
					proposals. They can only be read here.
				</p>
			) : (
				<div className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-muted-foreground">
					{live.perp === null || live.openOrders === null
						? reading
						: "No positions and no open orders."}
				</div>
			)}

			<div className="grid grid-cols-1 items-start gap-4 min-[861px]:grid-cols-2">
				<Card
					title={
						<span className="inline-flex items-center gap-1.5">
							{frozen ? "Last known signers" : "Signers"} <Help k="signer" />
							{signed && (
								<span className="inline-flex items-center gap-1 text-xs font-normal text-subtle-foreground">
									· last signed <Help k="lastSigned" />
								</span>
							)}
						</span>
					}
					actions={
						threshold !== null && signers.length > 0 ? (
							<>
								<Tag>
									{threshold} of {signers.length}{" "}
									{frozen ? "had to sign" : "must sign"}
								</Tag>
								{/* a change is a proposal like any other: its signers make it */}
								{!frozen && me && signers.includes(me) && (
									<Link
										to="/multisig/propose"
										search={{
											treasury: address,
											kind: "changeSigners",
											network,
										}}
										className={linkButtonSm}
									>
										{CHANGE.linkLabel}
									</Link>
								)}
							</>
						) : null
					}
					footer={
						<Checked
							observedAt={state.observedAt}
							checking={state.checking}
							failed={state.failed}
							refetch={state.refetch}
							now={now}
							what="the signers"
						/>
					}
				>
					{signers.length === 0 ? (
						<Quiet>
							{state.error
								? "The signer list could not be read from Hyperliquid."
								: state.isMultiSig === false
									? "Hyperliquid reports no signer set for this account."
									: reading}
						</Quiet>
					) : (
						signers.map((a) => (
							<PersonRow
								key={a}
								trailing={a === me ? <Tag tone="you">you</Tag> : null}
							>
								<Who address={a} editable className="text-[13px]" />
								{lastSignedText(signed?.get(a), now) && (
									<span
										className="block text-xs text-subtle-foreground"
										title={signedTitle(signed?.get(a))}
									>
										{lastSignedText(signed?.get(a), now)}
									</span>
								)}
							</PersonRow>
						))
					)}
					{!frozen && me && signers.includes(me) && (
						<p className="mt-3 border-t border-border pt-2.5 text-xs">
							<Link
								to="/multisig/propose"
								search={{ treasury: address, kind: "convertBack", network }}
								className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
							>
								{CHANGE.backTitle}
							</Link>{" "}
							<Help k="convertBack" />
						</p>
					)}
				</Card>

				<Card
					title={
						<span className="inline-flex items-center gap-1.5">
							API wallets <Help k="apiWallet" />
						</span>
					}
					actions={active !== null ? <Tag>{active} active</Tag> : null}
					footer={
						<Checked
							observedAt={state.observedAt}
							checking={state.checking}
							failed={state.failed}
							refetch={state.refetch}
							now={now}
							what="the API wallets"
						/>
					}
				>
					{state.agents === null ? (
						<Quiet>
							{state.agentsError
								? "Could not be read from Hyperliquid."
								: reading}
						</Quiet>
					) : state.agents.length === 0 ? (
						<Quiet>
							{frozen
								? "None approved."
								: "None approved. Every action needs the signers."}
						</Quiet>
					) : (
						<>
							{state.agents.map((g) => {
								const expired = g.validUntil <= now;
								const soon = !expired && g.validUntil - now < EXPIRES_SOON_MS;
								const approvedBy = approvalOf(g.address, proposals);
								const approval = approvedBy
									? proposals.find((p) => p.digest === approvedBy)
									: undefined;
								return (
									<PersonRow
										key={g.address}
										trailing={
											<span className="inline-flex items-center gap-2">
												{expired ? (
													<Tag>expired</Tag>
												) : (
													<Tag tone={soon ? "warn" : "gray"}>
														{soon ? "expires " : ""}
														{fromNow(g.validUntil, now)}
													</Tag>
												)}
												{canPropose && (
													<Link
														to="/multisig/propose"
														search={{
															treasury: address,
															kind: "removeAgent",
															agent: g.name,
															network,
														}}
														className={linkButtonSm}
														aria-label={`Remove the API wallet ${g.name ? visibleText(g.name) : "without a name"}`}
													>
														Remove
													</Link>
												)}
											</span>
										}
									>
										<b className="text-sm font-semibold">
											{g.name ? visibleText(g.name) : "(unnamed)"}
										</b>{" "}
										<Who
											address={g.address}
											editable
											className="text-[13px] text-muted-foreground"
										/>
										<span className="block text-xs text-subtle-foreground">
											{expired ? "expired " : "expires "}
											<When at={g.validUntil} />
											{approval && (
												<>
													{" · approved through "}
													<Link
														to="/multisig/proposal"
														search={{ digest: approval.digest }}
														className="text-brand underline underline-offset-2"
													>
														{approval.title}
													</Link>
												</>
											)}
										</span>
									</PersonRow>
								);
							})}
							<p className="mt-2.5 text-xs text-subtle-foreground">
								{frozen ? API_WALLET_FORMER : API_WALLET_SENTENCE}
							</p>
						</>
					)}
				</Card>
			</div>

			{treasury && (
				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-xs text-muted-foreground">
					<span>
						{treasury.addedBy === address ? (
							`${RELAY_COPY.registeredByAccount}, `
						) : (
							<>
								Added to this tool by{" "}
								{treasury.addedBy === me ? (
									<span className="text-foreground">you</span>
								) : (
									<Who address={treasury.addedBy} className="text-foreground" />
								)}{" "}
							</>
						)}
						on <When at={treasury.createdAt} />.
						{treasury.addedBy !== me && ` ${RELAY_COPY.addedByOther}`}
					</span>
					{hydrated && (
						<div className="flex flex-wrap items-center gap-2">
							<Btn
								size="sm"
								variant="outline"
								onClick={() => {
									// taken out of this browser's list: what was half-filled for it goes too
									if (!hidden)
										useMultisigDrafts.getState().dropFor(network, address);
									setHidden(network, address, !hidden);
								}}
							>
								{hidden ? "Show in my list again" : "Hide from my list"}
							</Btn>
							<span>
								{hidden
									? "Hidden in this browser. It stays reachable by its address."
									: "Hiding is for this browser only; nothing changes for your co-signers."}
							</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
