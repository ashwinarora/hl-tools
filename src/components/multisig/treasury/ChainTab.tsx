import type {
	Address,
	FillRow,
	FundingRow,
	LedgerRow,
	Network,
	OrderHistoryRow,
} from "@hl-tools/core";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "#/lib/utils";
import type { ChainMatch } from "../live/useChainMatch";
import {
	amountText,
	compareAmount,
	compareNumber,
	compareText,
	fillValue,
	ledgerAmount,
	ledgerWhat,
	type MoreKind,
	orderSide,
	orderTypeText,
	percentText,
	signedText,
	sizeOf,
	viewMoreUrl,
} from "../model/chain/columns";
import type { HistoryPart } from "../model/live/account";
import { Who } from "../names/Names";
import { type DataColumn, DataTable } from "../shell/DataTable";
import { Help } from "../shell/Help";
import { Card } from "../shell/kit";
import { SourceLine, toneOf, When } from "../shell/live";
import type { LiveTreasuryState } from "../useTreasuryState";
import { ProposalCell, TimeCell } from "./ledgerCells";
import type { KnownProposal, KnownState } from "./useKnownProposals";

type List = "transfers" | "trades" | "orders" | "funding";

const LISTS: readonly {
	readonly id: List;
	readonly label: string;
	readonly part: HistoryPart;
	readonly more: MoreKind;
	readonly about: string;
	readonly empty: string;
}[] = [
	{
		id: "transfers",
		label: "Transfers",
		part: "ledger",
		more: "transferHistory",
		about: "Deposits, withdrawals and transfers, as Hyperliquid lists them.",
		empty: "No transfers yet.",
	},
	{
		id: "trades",
		label: "Trades",
		part: "fills",
		more: "tradeHistory",
		about: "The 30 most recent trades, then every new one as it happens.",
		empty: "This treasury has not traded.",
	},
	{
		id: "orders",
		label: "Orders",
		part: "orderHistory",
		more: "historicalOrders",
		about: "The most recent orders, then every change as it happens.",
		empty: "No orders in the recent record.",
	},
	{
		id: "funding",
		label: "Funding",
		part: "fundings",
		more: "fundingHistory",
		about: "Funding is paid or received every hour on open positions.",
		empty: "No funding payments in the recent record.",
	},
];

const key = (r: { readonly key: string }) => r.key;
const sideClass = (buy: boolean) => (buy ? "text-success" : "text-danger");

/** The fee this account paid on a ledger entry; null when it paid none. */
const paidFee = (r: LedgerRow): string | null =>
	r.direction === "in" ? null : r.fee;

/**
 * Hyperliquid's own record of the account: what moved, what was traded. Not
 * the Signing log. Where a transfer was caused by a proposal on record, the
 * row says which.
 */
export function ChainTab({
	network,
	address,
	state,
	proposals,
	proposalsState,
	match,
}: {
	network: Network;
	address: Address;
	state: LiveTreasuryState;
	proposals: readonly KnownProposal[];
	proposalsState: KnownState;
	/** Which proposal each ledger row belongs to (looked up by the page, once for all its tabs). */
	match: ChainMatch;
}) {
	const live = state.live;
	const [list, setList] = useState<List>("transfers");
	const titles = useMemo(
		() => new Map(proposals.map((p) => [p.digest as string, p.title])),
		[proposals],
	);

	const transfers = useMemo<readonly DataColumn<LedgerRow>[]>(
		() => [
			{
				id: "time",
				header: "Time",
				descFirst: true,
				sort: (a, b) => compareNumber(a.time, b.time),
				cell: (r) => <TimeCell at={r.time} network={network} hash={r.hash} />,
			},
			{
				id: "what",
				header: "What",
				sort: (a, b) =>
					compareText(ledgerWhat(a).text, ledgerWhat(b).text) ||
					compareText(a.counterparty, b.counterparty),
				cell: (r) => {
					const w = ledgerWhat(r);
					return (
						<>
							{w.text}
							{w.party && (
								<>
									{" "}
									<Who address={w.party} editable />
								</>
							)}
						</>
					);
				},
			},
			{
				id: "amount",
				header: "Amount",
				numeric: true,
				sort: (a, b) => compareAmount(ledgerAmount(a), ledgerAmount(b)),
				cell: (r) => (
					<>
						{r.direction === "within" || r.direction === "other"
							? amountText(ledgerAmount(r))
							: signedText(ledgerAmount(r))}
						{r.token && (
							<span className="ml-1.5 font-sans text-xs text-muted-foreground">
								{r.token}
							</span>
						)}
					</>
				),
				cellClass: (r) =>
					r.direction === "out" || r.direction === "in"
						? toneOf(ledgerAmount(r))
						: undefined,
			},
			{
				id: "fee",
				header: "Fee",
				numeric: true,
				// the sender pays the fee: on money that arrived it is not this account's
				sort: (a, b) => compareAmount(paidFee(a), paidFee(b)),
				cell: (r) =>
					paidFee(r) === null ? (
						"—"
					) : (
						<>
							{amountText(r.fee)}
							{r.feeToken && (
								<span className="ml-1.5 font-sans text-xs text-muted-foreground">
									{r.feeToken}
								</span>
							)}
						</>
					),
			},
			{
				id: "proposal",
				header: "Proposal",
				headerExtra: <Help k="noneOnRecord" />,
				cell: (r) => (
					<ProposalCell
						match={match.of(r)}
						titles={titles}
						onRetry={() => match.retry(r)}
					/>
				),
				cellClass: () => "whitespace-normal min-w-40",
			},
		],
		[network, match, titles],
	);

	const trades = useMemo<readonly DataColumn<FillRow>[]>(
		() => [
			{
				id: "time",
				header: "Time",
				descFirst: true,
				sort: (a, b) => compareNumber(a.time, b.time),
				cell: (r) => <TimeCell at={r.time} network={network} hash={r.hash} />,
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
				sort: (a, b) => compareText(a.dir, b.dir),
				cell: (r) => r.dir,
				cellClass: (r) => sideClass(r.side === "B"),
			},
			{
				id: "price",
				header: "Price",
				numeric: true,
				sort: (a, b) => compareAmount(a.px, b.px),
				cell: (r) => amountText(r.px),
			},
			{
				id: "size",
				header: "Size",
				numeric: true,
				sort: (a, b) => compareAmount(a.sz, b.sz),
				cell: (r) => amountText(r.sz),
			},
			{
				id: "value",
				header: "Value, USDC",
				numeric: true,
				sort: (a, b) => compareAmount(fillValue(a), fillValue(b)),
				cell: (r) => amountText(fillValue(r), { maxDecimals: 2 }),
			},
			{
				id: "fee",
				header: "Fee",
				numeric: true,
				sort: (a, b) => compareAmount(a.fee, b.fee),
				cell: (r) => amountText(r.fee, { maxDecimals: 4 }),
			},
			{
				id: "pnl",
				header: "Closed profit",
				numeric: true,
				sort: (a, b) => compareAmount(a.closedPnl, b.closedPnl),
				cell: (r) =>
					toneOf(r.closedPnl)
						? signedText(r.closedPnl, { maxDecimals: 4 })
						: "",
				cellClass: (r) => toneOf(r.closedPnl),
			},
		],
		[network],
	);

	const orders = useMemo<readonly DataColumn<OrderHistoryRow>[]>(
		() => [
			{
				id: "time",
				header: "Time",
				descFirst: true,
				sort: (a, b) => compareNumber(a.statusTimestamp, b.statusTimestamp),
				cell: (r) => <When at={r.statusTimestamp} seconds />,
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
				sort: (a, b) => compareAmount(a.origSz, b.origSz),
				cell: (r) => amountText(r.origSz),
			},
			{
				id: "status",
				header: "Status",
				sort: (a, b) => compareText(a.status, b.status),
				cell: (r) => r.status,
			},
		],
		[],
	);

	const funding = useMemo<readonly DataColumn<FundingRow>[]>(
		() => [
			{
				id: "time",
				header: "Time",
				descFirst: true,
				sort: (a, b) => compareNumber(a.time, b.time),
				cell: (r) => <When at={r.time} seconds />,
			},
			{
				id: "coin",
				header: "Market",
				sort: (a, b) => compareText(a.coin, b.coin),
				cell: (r) => r.coin,
			},
			{
				id: "size",
				header: "Position size",
				numeric: true,
				sort: (a, b) =>
					compareAmount(a.szi && sizeOf(a.szi), b.szi && sizeOf(b.szi)),
				cell: (r) => amountText(r.szi),
			},
			{
				id: "payment",
				header: "Payment, USDC",
				headerExtra: <Help k="funding" />,
				numeric: true,
				sort: (a, b) => compareAmount(a.usdc, b.usdc),
				cell: (r) => signedText(r.usdc),
				cellClass: (r) => toneOf(r.usdc),
			},
			{
				id: "rate",
				header: "Rate",
				numeric: true,
				sort: (a, b) => compareAmount(a.fundingRate, b.fundingRate),
				cell: (r) => percentText(r.fundingRate),
			},
		],
		[],
	);

	const current = LISTS.find((l) => l.id === list) ?? LISTS[0];
	const refused = live.refused.some((r) => r.part === current.part);
	const reading = "Reading from Hyperliquid…";
	const empty = (rows: readonly unknown[] | null) =>
		refused
			? "Hyperliquid is not sending this list live right now. Its own page has it."
			: rows === null
				? reading
				: current.empty;
	const sorted = { id: "time", desc: true } as const;

	return (
		<div className="flex flex-col gap-4">
			<SourceLine status={live.status} onRetry={live.retry}>
				Hyperliquid's own record of this account. This is not the Signing log.{" "}
				<Help k="recordAndLog" />
			</SourceLine>

			<div
				role="radiogroup"
				aria-label="Which record"
				className="inline-flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface-2 p-0.5"
			>
				{LISTS.map((l) => (
					// biome-ignore lint/a11y/useSemanticElements: styled as one segmented control
					<button
						key={l.id}
						type="button"
						role="radio"
						aria-checked={l.id === list}
						onClick={() => setList(l.id)}
						className={cn(
							"whitespace-nowrap rounded-md px-3 py-1 text-[13px] transition-colors",
							l.id === list
								? "bg-surface font-medium text-foreground shadow-[var(--shadow-card)]"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{l.label}
					</button>
				))}
			</div>

			<Card
				flush
				footer={
					<>
						<span>
							{current.about}
							{live.gaps.includes(current.part) &&
								" Rows from while this page was disconnected may be missing."}
						</span>
						<a
							href={viewMoreUrl(network, current.more, address)}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 whitespace-nowrap text-brand underline underline-offset-2"
						>
							View more on Hyperliquid
							<ExternalLink className="size-3" aria-hidden />
						</a>
					</>
				}
			>
				{list === "transfers" && (
					<DataTable
						label="Transfers"
						columns={transfers}
						rows={live.ledger ?? []}
						rowKey={key}
						initialSort={sorted}
						empty={empty(live.ledger)}
					/>
				)}
				{list === "trades" && (
					<DataTable
						label="Trades"
						columns={trades}
						rows={live.fills ?? []}
						rowKey={key}
						initialSort={sorted}
						empty={empty(live.fills)}
					/>
				)}
				{list === "orders" && (
					<DataTable
						label="Orders"
						columns={orders}
						rows={live.orderHistory ?? []}
						rowKey={key}
						initialSort={sorted}
						empty={empty(live.orderHistory)}
					/>
				)}
				{list === "funding" && (
					<DataTable
						label="Funding payments"
						columns={funding}
						rows={live.fundings ?? []}
						rowKey={key}
						initialSort={sorted}
						empty={empty(live.fundings)}
					/>
				)}
			</Card>

			<p className="mx-0.5 -mt-2 text-xs text-subtle-foreground">
				{list === "transfers"
					? proposalsState === "unavailable"
						? "The last column says which proposal caused a row. The record of proposals cannot be read right now, so rows are not matched."
						: "The last column says which proposal in the Signing log caused a row, when there is one. Money that arrived has none."
					: "Trades and orders are placed by API wallets. They are never proposals, so there is nothing to match."}
			</p>
		</div>
	);
}
