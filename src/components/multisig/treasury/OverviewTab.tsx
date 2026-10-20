import type {
	Address,
	Network,
	OrderRow,
	PositionRow,
	SpotBalanceRow,
} from "@hl-tools/core";
import { visibleText } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink, X } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { useOutcomeLists } from "../live/useOutcomeLists";
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
import { balanceView, MODE_UNREAD, modeLabel } from "../model/mode";
import {
	isOutcomeShare,
	type OutcomeRow,
	splitHoldings,
} from "../model/outcomes";
import { RELAY_COPY } from "../model/relay/copy";
import { type LastSigned, lastSignedText } from "../model/relay/lastSigned";
import type { TreasuryRow } from "../model/relay/rows";
import { fromNow, utcDateTime } from "../model/time";
import { PROVENANCE_CLOSE } from "../model/toasts";
import { useNames, Who } from "../names/Names";
import { Checked } from "../shell/Checked";
import { type DataColumn, DataTable } from "../shell/DataTable";
import { Help } from "../shell/Help";
import {
	Card,
	linkButtonSm,
	PersonRow,
	TabList,
	TabPanel,
	Tag,
} from "../shell/kit";
import { toneOf, useNow, When } from "../shell/live";
import type { LiveTreasuryState } from "../useTreasuryState";
import type { KnownProposal } from "./useKnownProposals";
import { useLastSigned } from "./useLastSigned";

/** The exact moment behind "last signed 2 days ago", for the hover. */
// UTC on hover, as every other time of the section (audit F-049)
const signedTitle = (l: LastSigned | undefined) =>
	l?.kind === "signed" ? utcDateTime(l.at) : undefined;

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

const OUTCOMES: readonly DataColumn<OutcomeRow>[] = [
	{
		id: "outcome",
		header: "Outcome",
		sort: (a, b) => compareText(a.fullTitle, b.fullTitle),
		// a market somebody else named: the whole name and the share's own name on hover
		cell: (r) => (
			<span
				className="[overflow-wrap:anywhere]"
				title={`${r.fullTitle} (${r.coin})`}
			>
				<bdi>{r.title}</bdi>
			</span>
		),
	},
	{
		id: "side",
		header: "Side",
		sort: (a, b) => compareText(a.side, b.side),
		cell: (r) => <bdi>{r.side}</bdi>,
	},
	{
		id: "shares",
		header: "Shares",
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
];

/** The four tabs of what a treasury holds, in Hyperliquid's own order. */
type HoldingsTab = "balances" | "positions" | "outcomes" | "orders";

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
	// outcome shares are named from Hyperliquid's lists, read only when one is held
	const sharesHeld = useMemo(
		() =>
			live.spot?.some((b) => isOutcomeShare(b) && isNonZero(b.total)) ?? false,
		[live.spot],
	);
	const outcomeLists = useOutcomeLists(network, sharesHeld);
	const { balances, outcomes } = useMemo(
		() => splitHoldings(live.spot, outcomeLists),
		[live.spot, outcomeLists],
	);
	const positions = live.perp?.positions ?? [];
	const orders = live.openOrders ?? [];
	const holdingsId = useId();
	const [holdingsTab, setHoldingsTab] = useState<HoldingsTab>("balances");
	const holdingTabs = [
		{ value: "balances" as const, label: "Balances", count: balances.length },
		{
			value: "positions" as const,
			label: "Positions",
			count: positions.length,
		},
		{ value: "outcomes" as const, label: "Outcomes", count: outcomes.length },
		{ value: "orders" as const, label: "Open orders", count: orders.length },
	];
	const mode = state.mode ? modeLabel(state.mode) : null;
	const reading = "Reading from Hyperliquid…";
	// which figures there are depends on the mode (the figures themselves are
	// the tiles above the page's sections, with what is staked and in vaults)
	const view = state.modePending
		? null
		: balanceView(state.mode, live.perp, live.spot);

	// who signs: the chain's list once it is read; the relay's copy until then,
	// and for an account that is no longer a multi-sig
	// no longer a multi-sig: by the relay's copy, or by Hyperliquid's own answer
	// a moment before the copy catches up (the signers shown are then the last
	// known ones, and nothing can be proposed for the account)
	const frozen =
		(treasury ? treasury.frozenAt !== null : false) ||
		state.isMultiSig === false;
	const signers = state.policy?.authorizedUsers ?? treasury?.signers ?? [];
	// from the relay's history: only where the relay lists the treasury for this wallet
	const signed = useLastSigned(network, address, signers, !!treasury);
	const threshold = state.policy?.threshold ?? treasury?.threshold ?? null;
	const active = state.agents?.filter((g) => g.validUntil > now).length ?? null;
	// a proposal is made by a signer of an account that is still a multi-sig
	const canPropose = !frozen && !!me && signers.includes(me);

	const hydrated = usePrefsHydrated();
	const prefsKey = treasuryKey(network, address);
	const provenanceClosed = useMultisigPrefs((s) =>
		s.provenanceClosed.includes(prefsKey),
	);
	const closeProvenance = useMultisigPrefs((s) => s.closeProvenance);
	// a signer with no nickname here yet is offered one in words, beside "you"
	const names = useNames();
	const nameYourself =
		!!me && !!names && names.canName(me) && names.of(me) === null;

	return (
		// From 1280 px: what it holds on the left, who controls it beside it.
		<div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-5">
			<div className="flex min-w-0 flex-col gap-4">
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

				{/* what it holds, one panel with Hyperliquid's own tabs */}
				<Card flush>
					{/* one height for every tab: the mode and its button sit beside Balances only */}
					<div className="flex min-h-[45px] flex-wrap items-center justify-between gap-x-3 border-b border-border pl-1.5 pr-4">
						<TabList
							id={holdingsId}
							label="What the treasury holds"
							value={holdingsTab}
							tabs={holdingTabs}
							onChange={setHoldingsTab}
							className="mb-0 self-end border-b-0"
						/>
						{holdingsTab === "balances" && !mode && state.modeFailed && (
							<span className="inline-flex items-center gap-1.5 py-2">
								<Tag tone="warn" title={MODE_UNREAD}>
									mode unread
								</Tag>
							</span>
						)}
						{holdingsTab === "balances" && mode && (
							<span className="inline-flex items-center gap-1.5 py-2">
								{view?.kind === "two" && <Help k="perpsSpot" />}
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
						)}
					</div>
					<TabPanel id={holdingsId} value={holdingsTab}>
						{holdingsTab === "balances" ? (
							<DataTable
								label="Spot balances"
								columns={SPOT}
								rows={balances}
								rowKey={key}
								initialSort={{ id: "total", desc: true }}
								empty={live.spot === null ? reading : "No spot balances."}
							/>
						) : holdingsTab === "positions" ? (
							<DataTable
								label="Open positions"
								columns={POSITIONS}
								rows={positions}
								rowKey={key}
								initialSort={{ id: "value", desc: true }}
								empty={live.perp === null ? reading : "No positions."}
							/>
						) : holdingsTab === "outcomes" ? (
							<DataTable
								label="Outcome shares"
								columns={OUTCOMES}
								rows={outcomes}
								rowKey={key}
								initialSort={{ id: "shares", desc: true }}
								empty={live.spot === null ? reading : "No outcome shares."}
							/>
						) : (
							<DataTable
								label="Open orders"
								columns={ORDERS}
								rows={orders}
								rowKey={key}
								initialSort={{ id: "placed", desc: true }}
								empty={live.openOrders === null ? reading : "No open orders."}
							/>
						)}
						{holdingsTab !== "balances" && (
							<p className="border-t border-border px-4 py-2 text-xs text-subtle-foreground">
								{holdingsTab === "outcomes"
									? "Outcome shares are bought and sold by an API wallet, not through proposals. They can only be read here."
									: "Positions and orders are placed by an API wallet, not through proposals. They can only be read here."}
							</p>
						)}
					</TabPanel>
				</Card>
			</div>

			<div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[861px]:grid-cols-2 xl:grid-cols-1">
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
									? "Hyperliquid reports no signers for this account."
									: reading}
						</Quiet>
					) : (
						signers.map((a) => (
							<PersonRow
								key={a}
								trailing={
									a === me ? (
										<span className="inline-flex items-center gap-1.5">
											{nameYourself && (
												<button
													type="button"
													onClick={() => names?.edit(a)}
													title={RELAY_COPY.nameYourselfTitle}
													className="inline-flex min-h-11 items-center rounded px-1 text-xs font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:min-h-0"
												>
													{RELAY_COPY.nameYourself}
												</button>
											)}
											<Tag tone="you">you</Tag>
										</span>
									) : null
								}
							>
								{/* your own row offers the words "Name yourself" instead of the small icon */}
								<Who
									address={a}
									editable={!(a === me && nameYourself)}
									className="text-[13px]"
								/>
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

			{treasury && hydrated && !provenanceClosed && (
				<div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 py-2 pr-1.5 pl-3.5 text-xs text-muted-foreground xl:col-span-2">
					<span className="min-w-0 flex-1 py-1">
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
						{/* a conversion back and a new one, or a change of signers, since */}
						{treasury.changedAt > treasury.createdAt + 60_000 && (
							<>
								{" "}
								Its signers last changed on <When at={treasury.changedAt} />.
							</>
						)}
						{/* a lure is about a signer's address: the account itself is not one */}
						{treasury.addedBy !== me &&
							me !== address &&
							` ${RELAY_COPY.addedByOther}`}
					</span>
					<button
						type="button"
						onClick={() => closeProvenance(network, address)}
						aria-label={PROVENANCE_CLOSE}
						title={PROVENANCE_CLOSE}
						className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:size-7"
					>
						<X className="size-3.5" aria-hidden />
					</button>
				</div>
			)}
		</div>
	);
}
