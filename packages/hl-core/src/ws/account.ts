/**
 * Typed rows for the account channels: what an account holds
 * (clearinghouseState, spotState, openOrders) and what happened to it
 * (userFills, userHistoricalOrders, userFundings, userNonFundingLedgerUpdates).
 *
 * Parsing is total. A message of another shape gives null, a malformed row is
 * dropped, nothing throws: the server's types are observed, not promised
 * (amounts arrive as strings where the docs say numbers). Amounts stay decimal
 * strings; arithmetic goes through Decimal.
 */
import { Decimal } from "../decimal.ts";

type Rec = Readonly<Record<string, unknown>>;

const rec = (v: unknown): Rec | null =>
	v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null =>
	typeof v === "number" && Number.isSafeInteger(v) ? v : null;
/** A decimal amount as a string, whether the server sent a string or a number. */
const amt = (v: unknown): string | null => {
	if (typeof v === "string") return Decimal.isValid(v) ? v : null;
	if (typeof v === "number" && Number.isFinite(v)) {
		const s = String(v);
		return Decimal.isValid(s) ? s : null;
	}
	return null;
};
const addr = (v: unknown): string | null =>
	typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)
		? v.toLowerCase()
		: null;
const present = <T>(v: T | null): v is T => v !== null;

// ───────────────────────────── holdings ─────────────────────────────

export interface PositionRow {
	/** `<dex>:<coin>`; the first perp dex is the empty string. */
	readonly key: string;
	readonly dex: string;
	readonly coin: string;
	/** Signed size: negative is short. */
	readonly szi: string;
	readonly entryPx: string | null;
	readonly positionValue: string;
	/** Not sent by the server: positionValue ÷ |szi|, to six significant figures. */
	readonly markPx: string | null;
	readonly unrealizedPnl: string;
	readonly returnOnEquity: string | null;
	/** Null when the account cannot be liquidated at any price at this size. */
	readonly liquidationPx: string | null;
	readonly marginUsed: string;
	readonly leverage: {
		readonly type: string;
		readonly value: number;
	} | null;
	/** Funding paid (positive) or received (negative) since the position was opened. */
	readonly fundingSinceOpen: string | null;
}

export interface PerpAccount {
	readonly dex: string;
	readonly accountValue: string;
	readonly notional: string;
	readonly marginUsed: string;
	/** What a transfer out of perps could move now. */
	readonly withdrawable: string;
	/** The server's clock on this message, ms. */
	readonly time: number | null;
	readonly positions: readonly PositionRow[];
}

function markOf(positionValue: string, szi: string): string | null {
	const size = Decimal.parse(szi).abs();
	if (size.isZero()) return null;
	return Decimal.parse(positionValue)
		.abs()
		.div(size, 12)
		.roundToSignificantFigures(6, "half-even")
		.toString();
}

function positionOf(dex: string, v: unknown): PositionRow | null {
	const p = rec(rec(v)?.position);
	if (!p) return null;
	const coin = str(p.coin);
	const szi = amt(p.szi);
	const positionValue = amt(p.positionValue);
	const unrealizedPnl = amt(p.unrealizedPnl);
	const marginUsed = amt(p.marginUsed);
	if (!coin || !szi || !positionValue || !unrealizedPnl || !marginUsed)
		return null;
	const lev = rec(p.leverage);
	const levType = str(lev?.type);
	const levValue = int(lev?.value);
	return {
		key: `${dex}:${coin}`,
		dex,
		coin,
		szi,
		entryPx: amt(p.entryPx),
		positionValue,
		markPx: markOf(positionValue, szi),
		unrealizedPnl,
		returnOnEquity: amt(p.returnOnEquity),
		liquidationPx: amt(p.liquidationPx),
		marginUsed,
		leverage:
			levType && levValue !== null ? { type: levType, value: levValue } : null,
		fundingSinceOpen: amt(rec(p.cumFunding)?.sinceOpen),
	};
}

function perpAccountOf(dex: string, v: unknown): PerpAccount | null {
	const s = rec(v);
	const m = rec(s?.marginSummary);
	if (!s || !m) return null;
	const accountValue = amt(m.accountValue);
	const notional = amt(m.totalNtlPos);
	const marginUsed = amt(m.totalMarginUsed);
	const withdrawable = amt(s.withdrawable);
	if (!accountValue || !notional || !marginUsed || !withdrawable) return null;
	return {
		dex,
		accountValue,
		notional,
		marginUsed,
		withdrawable,
		time: int(s.time),
		positions: list(s.assetPositions)
			.map((p) => positionOf(dex, p))
			.filter(present),
	};
}

/** `clearinghouseState` data: one perp dex of one account. */
export function parsePerpAccount(data: unknown): PerpAccount | null {
	const d = rec(data);
	if (!d) return null;
	return perpAccountOf(str(d.dex) ?? "", d.clearinghouseState);
}

/** `allDexsClearinghouseState` data: every perp dex of one account, the first dex first. */
export function parseAllDexs(data: unknown): readonly PerpAccount[] | null {
	const d = rec(data);
	if (!d || !Array.isArray(d.clearinghouseStates)) return null;
	const out: PerpAccount[] = [];
	for (const pair of d.clearinghouseStates) {
		if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
		const s = perpAccountOf(pair[0], pair[1]);
		if (s) out.push(s);
	}
	return out;
}

/** Whether a perp dex holds anything: value, or a position. */
export function perpAccountInUse(s: PerpAccount): boolean {
	return s.positions.length > 0 || !Decimal.parse(s.accountValue).isZero();
}

export interface SpotBalanceRow {
	/** The coin name. */
	readonly key: string;
	readonly coin: string;
	readonly token: number | null;
	readonly total: string;
	/** Locked by open orders. */
	readonly hold: string;
	/** total − hold. */
	readonly available: string;
}

/** `spotState` data: the account's spot balances. */
export function parseSpotState(
	data: unknown,
): readonly SpotBalanceRow[] | null {
	const d = rec(data);
	const s = rec(d?.spotState);
	if (!s || !Array.isArray(s.balances)) return null;
	return s.balances
		.map((v): SpotBalanceRow | null => {
			const b = rec(v);
			const coin = str(b?.coin);
			const total = amt(b?.total);
			if (!b || !coin || !total) return null;
			const hold = amt(b.hold) ?? "0";
			return {
				key: coin,
				coin,
				token: int(b.token),
				total,
				hold,
				available: Decimal.parse(total).sub(Decimal.parse(hold)).toString(),
			};
		})
		.filter(present);
}

export interface OrderRow {
	/** The order id. */
	readonly key: string;
	readonly oid: number;
	readonly coin: string;
	/** "B" buys, "A" sells. */
	readonly side: "B" | "A";
	readonly limitPx: string;
	/** What is left to fill. */
	readonly sz: string;
	readonly origSz: string;
	/** When the order was placed, ms. */
	readonly timestamp: number;
	/** "Limit", "Stop Market"…; null on channels that do not send it. */
	readonly orderType: string | null;
	readonly tif: string | null;
	readonly reduceOnly: boolean;
	readonly isTrigger: boolean;
	readonly triggerPx: string | null;
	readonly triggerCondition: string | null;
	readonly cloid: string | null;
}

function orderOf(v: unknown): OrderRow | null {
	const o = rec(v);
	if (!o) return null;
	const oid = int(o.oid);
	const coin = str(o.coin);
	const side = o.side === "B" || o.side === "A" ? o.side : null;
	const limitPx = amt(o.limitPx);
	const sz = amt(o.sz);
	const timestamp = int(o.timestamp);
	if (oid === null || !coin || !side || !limitPx || !sz || timestamp === null)
		return null;
	const isTrigger = o.isTrigger === true;
	return {
		key: String(oid),
		oid,
		coin,
		side,
		limitPx,
		sz,
		origSz: amt(o.origSz) ?? sz,
		timestamp,
		orderType: str(o.orderType),
		tif: str(o.tif),
		reduceOnly: o.reduceOnly === true,
		isTrigger,
		triggerPx: isTrigger ? amt(o.triggerPx) : null,
		triggerCondition: isTrigger ? str(o.triggerCondition) : null,
		cloid: str(o.cloid),
	};
}

/** `openOrders` data: every resting order of one account on one perp dex (spot included on the first). */
export function parseOpenOrders(
	data: unknown,
): { readonly dex: string; readonly orders: readonly OrderRow[] } | null {
	const d = rec(data);
	if (!d || !Array.isArray(d.orders)) return null;
	return {
		dex: str(d.dex) ?? "",
		orders: d.orders.map(orderOf).filter(present),
	};
}

// ───────────────────────────── history ─────────────────────────────

/** One message of a streaming channel: the snapshot that opens it, or rows that arrived since. */
export interface RowBatch<T> {
	readonly snapshot: boolean;
	readonly rows: readonly T[];
}

function batch<T>(
	data: unknown,
	field: string,
	row: (v: unknown) => T | null,
): RowBatch<T> | null {
	const d = rec(data);
	if (!d || !Array.isArray(d[field])) return null;
	return {
		snapshot: d.isSnapshot === true,
		rows: (d[field] as unknown[]).map(row).filter(present),
	};
}

export interface FillRow {
	/** The trade id: unique per fill, where one transaction hash can cover several fills. */
	readonly key: string;
	readonly tid: number;
	readonly time: number;
	readonly coin: string;
	readonly side: "B" | "A";
	/** "Open Long", "Close Short", "Buy", "Sell"… as the server words it. */
	readonly dir: string;
	readonly px: string;
	readonly sz: string;
	readonly fee: string;
	readonly feeToken: string | null;
	readonly closedPnl: string | null;
	readonly oid: number | null;
	readonly hash: string | null;
	/** True when this side crossed the spread (taker). */
	readonly crossed: boolean;
}

function fillOf(v: unknown): FillRow | null {
	const f = rec(v);
	if (!f) return null;
	const tid = int(f.tid);
	const time = int(f.time);
	const coin = str(f.coin);
	const side = f.side === "B" || f.side === "A" ? f.side : null;
	const px = amt(f.px);
	const sz = amt(f.sz);
	if (tid === null || time === null || !coin || !side || !px || !sz)
		return null;
	return {
		key: String(tid),
		tid,
		time,
		coin,
		side,
		dir: str(f.dir) ?? (side === "B" ? "Buy" : "Sell"),
		px,
		sz,
		fee: amt(f.fee) ?? "0",
		feeToken: str(f.feeToken),
		closedPnl: amt(f.closedPnl),
		oid: int(f.oid),
		hash: str(f.hash),
		crossed: f.crossed === true,
	};
}

/** `userFills` data. */
export const parseFills = (data: unknown): RowBatch<FillRow> | null =>
	batch(data, "fills", fillOf);

export interface OrderHistoryRow extends OrderRow {
	/** "open", "filled", "canceled", "triggered", "rejected", "marginCanceled"… */
	readonly status: string;
	readonly statusTimestamp: number;
}

function historyOf(v: unknown): OrderHistoryRow | null {
	const h = rec(v);
	const order = orderOf(h?.order);
	const status = str(h?.status);
	const statusTimestamp = int(h?.statusTimestamp);
	if (!order || !status || statusTimestamp === null) return null;
	return { ...order, status, statusTimestamp };
}

/** `userHistoricalOrders` data: one row per status an order went through. */
export const parseOrderHistory = (
	data: unknown,
): RowBatch<OrderHistoryRow> | null => batch(data, "orderHistory", historyOf);

export interface FundingRow {
	/** `<time>:<coin>`: funding is paid once an hour per coin. */
	readonly key: string;
	readonly time: number;
	readonly coin: string;
	/** Signed: negative was paid by the account, positive received. */
	readonly usdc: string;
	/** The position's signed size when it was charged. */
	readonly szi: string | null;
	readonly fundingRate: string | null;
}

function fundingOf(v: unknown): FundingRow | null {
	const top = rec(v);
	// the stream sends flat rows; the info endpoint wraps the same fields in `delta`
	const f = rec(top?.delta) ?? top;
	const time = int(top?.time) ?? int(f?.time);
	const coin = str(f?.coin);
	const usdc = amt(f?.usdc);
	if (!f || time === null || !coin || !usdc) return null;
	return {
		key: `${time}:${coin}`,
		time,
		coin,
		usdc,
		szi: amt(f.szi),
		fundingRate: amt(f.fundingRate),
	};
}

/** `userFundings` data. */
export const parseFundings = (data: unknown): RowBatch<FundingRow> | null =>
	batch(data, "fundings", fundingOf);

/**
 * in      arrived from another account
 * out     left for another account
 * within  moved between the account's own balances (spot ↔ perps, staking, a vault it deposits in)
 * other   anything else (a liquidation, a kind this code does not know)
 */
export type LedgerDirection = "in" | "out" | "within" | "other";

export interface LedgerRow {
	/** `<time>:<hash>:<type>`. */
	readonly key: string;
	readonly time: number;
	/** The transaction hash; the explorer's txDetails answers for it. */
	readonly hash: string;
	/** `delta.type` as sent: internalTransfer, spotTransfer, accountClassTransfer, send, deposit, withdraw… */
	readonly type: string;
	readonly direction: LedgerDirection;
	readonly token: string | null;
	/** Unsigned. */
	readonly amount: string | null;
	/** The other account (or vault), lowercased. */
	readonly counterparty: string | null;
	/** Balance it left and balance it reached: "spot", "perp" or a perp dex name. */
	readonly fromVenue: string | null;
	readonly toVenue: string | null;
	readonly fee: string | null;
	readonly feeToken: string | null;
	/** The delta as sent, for details. */
	readonly delta: Rec;
}

const venue = (dex: unknown): string | null =>
	typeof dex === "string" ? (dex === "" ? "perp" : dex) : null;

type LedgerShape = Pick<
	LedgerRow,
	| "direction"
	| "token"
	| "amount"
	| "counterparty"
	| "fromVenue"
	| "toVenue"
	| "fee"
	| "feeToken"
>;

const BLANK: LedgerShape = {
	direction: "other",
	token: null,
	amount: null,
	counterparty: null,
	fromVenue: null,
	toVenue: null,
	fee: null,
	feeToken: null,
};

/** Between two accounts: which way, seen from `account`. */
function between(
	account: string,
	d: Rec,
): Pick<LedgerShape, "direction" | "counterparty"> {
	const from = addr(d.user);
	const to = addr(d.destination);
	if (from === account && to === account)
		return { direction: "within", counterparty: null };
	if (from === account) return { direction: "out", counterparty: to };
	if (to === account) return { direction: "in", counterparty: from };
	return { direction: "other", counterparty: null };
}

function shapeOf(account: string, type: string, d: Rec): LedgerShape {
	switch (type) {
		case "deposit":
			return {
				...BLANK,
				direction: "in",
				token: "USDC",
				amount: amt(d.usdc),
				toVenue: "perp",
			};
		case "withdraw":
			return {
				...BLANK,
				direction: "out",
				token: "USDC",
				amount: amt(d.usdc),
				fromVenue: "perp",
				fee: amt(d.fee),
				feeToken: "USDC",
			};
		case "internalTransfer":
		case "subAccountTransfer":
			return {
				...BLANK,
				...between(account, d),
				token: "USDC",
				amount: amt(d.usdc),
				fromVenue: "perp",
				toVenue: "perp",
				fee: amt(d.fee),
				feeToken: d.fee === undefined ? null : "USDC",
			};
		case "spotTransfer":
			return {
				...BLANK,
				...between(account, d),
				token: str(d.token),
				amount: amt(d.amount),
				fromVenue: "spot",
				toVenue: "spot",
				fee: amt(d.fee),
				feeToken: str(d.feeToken) || null,
			};
		case "send":
			return {
				...BLANK,
				...between(account, d),
				token: str(d.token),
				amount: amt(d.amount),
				fromVenue: venue(d.sourceDex),
				toVenue: venue(d.destinationDex),
				fee: amt(d.fee),
				feeToken: str(d.feeToken) || null,
			};
		case "accountClassTransfer":
			return {
				...BLANK,
				direction: "within",
				token: "USDC",
				amount: amt(d.usdc),
				fromVenue: d.toPerp === true ? "spot" : "perp",
				toVenue: d.toPerp === true ? "perp" : "spot",
			};
		case "cStakingTransfer":
			return {
				...BLANK,
				direction: "within",
				token: str(d.token),
				amount: amt(d.amount),
				fromVenue: d.isDeposit === true ? "spot" : "staking",
				toVenue: d.isDeposit === true ? "staking" : "spot",
			};
		case "vaultCreate":
		case "vaultDeposit":
			return {
				...BLANK,
				direction: "within",
				token: "USDC",
				amount: amt(d.usdc),
				counterparty: addr(d.vault),
				fromVenue: "perp",
				toVenue: "vault",
				fee: amt(d.fee),
				feeToken: d.fee === undefined ? null : "USDC",
			};
		case "vaultWithdraw":
		case "vaultDistribution":
			return {
				...BLANK,
				direction: "within",
				token: "USDC",
				amount: amt(d.netWithdrawnUsd) ?? amt(d.usdc),
				counterparty: addr(d.vault),
				fromVenue: "vault",
				toVenue: "perp",
			};
		case "rewardsClaim":
		case "spotGenesis":
			return {
				...BLANK,
				direction: "in",
				token: str(d.token),
				amount: amt(d.amount),
				toVenue: "spot",
			};
		default:
			// liquidation, borrowLend, deployGasAuction, activateDexAbstraction and kinds added later:
			// shown by name, never guessed at
			return { ...BLANK, token: str(d.token), amount: amt(d.amount) };
	}
}

/** `userNonFundingLedgerUpdates` data, seen from `account` (the subscribed user). */
export function parseLedger(
	data: unknown,
	account: string,
): RowBatch<LedgerRow> | null {
	const me = account.toLowerCase();
	return batch(data, "nonFundingLedgerUpdates", (v): LedgerRow | null => {
		const u = rec(v);
		const d = rec(u?.delta);
		const time = int(u?.time);
		const hash = str(u?.hash);
		const type = str(d?.type);
		if (!d || time === null || !hash || !type) return null;
		return {
			key: `${time}:${hash}:${type}`,
			time,
			hash,
			type,
			...shapeOf(me, type, d),
			delta: d,
		};
	});
}

// ───────────────────────────── merging ─────────────────────────────

export interface MergeOptions<T> {
	/** Newest first, and total: two different rows never compare equal. */
	readonly compare: (a: T, b: T) => number;
	/** Rows kept; the oldest fall off. */
	readonly cap: number;
	/**
	 * For rows that change under one key (an order's status): whether `next`
	 * replaces `prev`. Left out, the first row seen under a key stays.
	 */
	readonly supersedes?: (next: T, prev: T) => boolean;
}

/**
 * Add rows to a table kept newest first: a snapshot, a stream message, or the
 * snapshot that follows a reconnect. Rows already present are not repeated, so
 * the order messages arrive in does not matter and merging twice changes
 * nothing. When nothing changes the same array comes back, so a re-render can
 * be skipped.
 */
export function mergeRows<T extends { readonly key: string }>(
	prev: readonly T[],
	incoming: readonly T[],
	options: MergeOptions<T>,
): readonly T[] {
	if (incoming.length === 0) return prev;
	const byKey = new Map<string, T>();
	for (const r of prev) byKey.set(r.key, r);
	let changed = false;
	for (const r of incoming) {
		const have = byKey.get(r.key);
		if (have === undefined || options.supersedes?.(r, have)) {
			byKey.set(r.key, r);
			changed = true;
		}
	}
	if (!changed) return prev;
	const next = [...byKey.values()]
		.sort(options.compare)
		.slice(0, Math.max(0, options.cap));
	// everything new was older than the cap keeps
	if (next.length === prev.length && next.every((r, i) => r === prev[i]))
		return prev;
	return next;
}

/**
 * After a reconnect the snapshot holds only the newest rows. True when it does
 * not reach back to what was already known: rows in between were missed.
 */
export function leavesGap<T extends { readonly key: string }>(
	prev: readonly T[],
	snapshot: readonly T[],
	timeOf: (row: T) => number,
): boolean {
	if (prev.length === 0 || snapshot.length === 0) return false;
	const known = new Set(prev.map((r) => r.key));
	if (snapshot.some((r) => known.has(r.key))) return false;
	const newestKnown = Math.max(...prev.map(timeOf));
	return Math.min(...snapshot.map(timeOf)) > newestKnown;
}

const byKeyAsc = (a: { key: string }, b: { key: string }) =>
	a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/** Rows a history table keeps in memory per kind. */
export const ACCOUNT_HISTORY_CAP = 500;

export const FILL_MERGE: MergeOptions<FillRow> = {
	compare: (a, b) => b.time - a.time || byKeyAsc(a, b),
	cap: ACCOUNT_HISTORY_CAP,
};

export const FUNDING_MERGE: MergeOptions<FundingRow> = {
	compare: (a, b) => b.time - a.time || byKeyAsc(a, b),
	cap: ACCOUNT_HISTORY_CAP,
};

export const LEDGER_MERGE: MergeOptions<LedgerRow> = {
	compare: (a, b) => b.time - a.time || byKeyAsc(a, b),
	cap: ACCOUNT_HISTORY_CAP,
};

/** "open" is where an order starts; any other status at the same instant came after it. */
const statusRank = (status: string) =>
	status === "open" ? 0 : status === "triggered" ? 1 : 2;

/** Positive when `a` is the later status of the two. Total, so merging does not depend on arrival order. */
function laterStatus(a: OrderHistoryRow, b: OrderHistoryRow): number {
	return (
		a.statusTimestamp - b.statusTimestamp ||
		statusRank(a.status) - statusRank(b.status) ||
		(a.status > b.status ? 1 : a.status < b.status ? -1 : 0)
	);
}

/** One row per order, showing the latest status it reached. */
export const ORDER_HISTORY_MERGE: MergeOptions<OrderHistoryRow> = {
	compare: (a, b) => b.statusTimestamp - a.statusTimestamp || byKeyAsc(a, b),
	cap: ACCOUNT_HISTORY_CAP,
	supersedes: (next, prev) => laterStatus(next, prev) > 0,
};

/**
 * Keep what did not change. The holdings channels send the full state every
 * few seconds: returns `prev` itself when `next` is equal, and otherwise a
 * copy of `next` whose unchanged parts are the objects `prev` already had.
 */
export function shareStructure<T>(prev: T, next: T): T {
	if (Object.is(prev, next)) return prev;
	if (Array.isArray(prev) && Array.isArray(next)) {
		const out = next.map((v, i) => shareStructure(prev[i], v));
		return prev.length === next.length && out.every((v, i) => v === prev[i])
			? prev
			: (out as T);
	}
	const a = rec(prev);
	const b = rec(next);
	if (!a || !b) return next;
	const keys = Object.keys(b);
	const out: Record<string, unknown> = {};
	let same = keys.length === Object.keys(a).length;
	for (const k of keys) {
		out[k] = k in a ? shareStructure(a[k], b[k]) : b[k];
		if (out[k] !== a[k] || !(k in a)) same = false;
	}
	return same ? prev : (out as T);
}
