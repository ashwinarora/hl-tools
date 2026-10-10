import type {
	Address,
	Network,
	OrderRow,
	PositionRow,
	SpotBalanceRow,
} from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink, RefreshCw } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { cn } from "#/lib/utils";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
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
import { RELAY_COPY } from "../model/relay/copy";
import type { TreasuryRow } from "../model/relay/rows";
import { fromNow } from "../model/time";
import { Who } from "../names/Names";
import { type DataColumn, DataTable } from "../shell/DataTable";
import { ago, Btn, Card, PersonRow, Tag } from "../shell/kit";
import { Figure, SourceLine, toneOf, useNow, When } from "../shell/live";
import type { LiveTreasuryState } from "../useTreasuryState";
import type { KnownProposal } from "./useKnownProposals";

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
		numeric: true,
		sort: (a, b) => compareAmount(a.unrealizedPnl, b.unrealizedPnl),
		cell: (r) => signedText(r.unrealizedPnl, { maxDecimals: 2 }),
		cellClass: (r) => toneOf(r.unrealizedPnl),
	},
	{
		id: "liq",
		header: "Liquidation price",
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

/** "Checked 2 minutes ago", with a way to check now. One per box that is asked for, not pushed. */
function Checked({
	state,
	now,
	what,
}: {
	state: LiveTreasuryState;
	now: number;
	what: string;
}) {
	return (
		<>
			<span>
				{state.observedAt === null
					? state.checking
						? "Reading from Hyperliquid…"
						: "Not read yet."
					: state.failed
						? `The last check failed. Shown as read ${ago(state.observedAt, now)}.`
						: `Checked ${ago(state.observedAt, now)} · again every minute while this page is open`}
			</span>
			<button
				type="button"
				onClick={state.refetch}
				disabled={state.checking}
				aria-label={`Check ${what} again now`}
				title="Check again now"
				className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
			>
				<RefreshCw
					className={cn("size-3.5", state.checking && "animate-spin")}
					aria-hidden
				/>
			</button>
		</>
	);
}

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
	const usdc = live.spot?.find((b) => b.coin === "USDC");
	const spot = useMemo(
		() => live.spot?.filter((b) => isNonZero(b.total)) ?? [],
		[live.spot],
	);
	const positions = live.perp?.positions ?? [];
	const orders = live.openOrders ?? [];
	const reading = "Reading from Hyperliquid…";

	// who signs: the chain's list once it is read; the relay's copy until then,
	// and for an account that is no longer a multi-sig
	const frozen = treasury ? treasury.frozenAt !== null : false;
	const signers = state.policy?.authorizedUsers ?? treasury?.signers ?? [];
	const threshold = state.policy?.threshold ?? treasury?.threshold ?? null;
	const active = state.agents?.filter((g) => g.validUntil > now).length ?? null;

	const hydrated = usePrefsHydrated();
	const prefsKey = treasuryKey(network, address);
	const hidden = useMultisigPrefs((s) => s.hidden.includes(prefsKey));
	const setHidden = useMultisigPrefs((s) => s.setHidden);

	return (
		<div className="flex flex-col gap-4">
			<SourceLine status={live.status} onRetry={live.retry}>
				Balances, positions and orders arrive live from Hyperliquid. Nothing
				here is stored by this tool.
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

			<Card title="Balances" flush>
				<dl className="grid grid-cols-1 divide-y divide-border border-b border-border min-[641px]:grid-cols-3 min-[641px]:divide-x min-[641px]:divide-y-0">
					<Figure
						label="Perps account value"
						value={
							live.perp
								? amountText(live.perp.accountValue, {
										maxDecimals: 2,
										minDecimals: 2,
									})
								: "…"
						}
						unit="USDC"
					/>
					<Figure
						label="Can be moved now"
						value={
							live.perp
								? amountText(live.perp.withdrawable, {
										maxDecimals: 2,
										minDecimals: 2,
									})
								: "…"
						}
						unit="USDC"
					/>
					<Figure
						label="Spot USDC"
						value={
							live.spot
								? amountText(usdc?.total ?? "0", {
										maxDecimals: 2,
										minDecimals: 2,
									})
								: "…"
						}
						unit="USDC"
					/>
				</dl>
				<DataTable
					label="Spot balances"
					columns={SPOT}
					rows={spot}
					rowKey={key}
					initialSort={{ id: "total", desc: true }}
					empty={live.spot === null ? reading : "No spot balances."}
				/>
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
					title={frozen ? "Last known signers" : "Signers"}
					actions={
						threshold !== null && signers.length > 0 ? (
							<Tag>
								{threshold} of {signers.length}{" "}
								{frozen ? "had to sign" : "must sign"}
							</Tag>
						) : null
					}
					footer={<Checked state={state} now={now} what="the signers" />}
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
							</PersonRow>
						))
					)}
				</Card>

				<Card
					title="API wallets"
					actions={active !== null ? <Tag>{active} active</Tag> : null}
					footer={<Checked state={state} now={now} what="the API wallets" />}
				>
					{state.agents === null ? (
						<Quiet>
							{state.agentsError
								? "Could not be read from Hyperliquid."
								: reading}
						</Quiet>
					) : state.agents.length === 0 ? (
						<Quiet>None approved. Every action needs the signers.</Quiet>
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
											expired ? (
												<Tag>expired</Tag>
											) : (
												<Tag tone={soon ? "warn" : "gray"}>
													{soon ? "expires " : ""}
													{fromNow(g.validUntil, now)}
												</Tag>
											)
										}
									>
										<b className="text-sm font-semibold">
											{g.name || "(unnamed)"}
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
								An API wallet can trade for this treasury without the signers.
								It cannot withdraw.
							</p>
						</>
					)}
				</Card>
			</div>

			{treasury && (
				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-xs text-muted-foreground">
					<span>
						Added to this tool by{" "}
						{treasury.addedBy === me ? (
							<span className="text-foreground">you</span>
						) : (
							<Who address={treasury.addedBy} className="text-foreground" />
						)}{" "}
						on <When at={treasury.createdAt} />.
						{treasury.addedBy !== me && ` ${RELAY_COPY.addedByOther}`}
					</span>
					{hydrated && (
						<div className="flex flex-wrap items-center gap-2">
							<Btn
								size="sm"
								variant="outline"
								onClick={() => setHidden(network, address, !hidden)}
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
