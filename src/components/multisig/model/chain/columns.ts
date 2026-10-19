/**
 * What the live tables sort by and how their cells read. Pure: amounts stay
 * the decimal strings Hyperliquid sent and are compared exactly, never as
 * floating-point numbers.
 */
import {
	Decimal,
	type FillRow,
	type LedgerRow,
	type Network,
	type OrderRow,
} from "@hl-tools/core";

const dec = (v: string | null | undefined): Decimal | null =>
	v === null || v === undefined ? null : Decimal.tryParse(v);

/** Ascending by value. A missing or unreadable amount comes after every number. */
export function compareAmount(
	a: string | null | undefined,
	b: string | null | undefined,
): number {
	const x = dec(a);
	const y = dec(b);
	if (!x || !y) return x ? -1 : y ? 1 : 0;
	return x.cmp(y);
}

export function compareNumber(
	a: number | null | undefined,
	b: number | null | undefined,
): number {
	const x = a ?? null;
	const y = b ?? null;
	if (x === null || y === null) return x !== null ? -1 : y !== null ? 1 : 0;
	return x < y ? -1 : x > y ? 1 : 0;
}

/** Ascending, letters before case: "btc" next to "BTC", the same on every machine. */
export function compareText(
	a: string | null | undefined,
	b: string | null | undefined,
): number {
	const x = a ?? "";
	const y = b ?? "";
	const lx = x.toLowerCase();
	const ly = y.toLowerCase();
	return lx < ly ? -1 : lx > ly ? 1 : x < y ? -1 : x > y ? 1 : 0;
}

/** -1, 0 or 1; 0 for what is not an amount. */
export function signOf(v: string | null | undefined): -1 | 0 | 1 {
	const d = dec(v);
	return !d || d.isZero() ? 0 : d.isNegative() ? -1 : 1;
}

/**
 * An amount for reading: thousands separated, no trailing zeros, and at most
 * `maxDecimals` places (rounded half-even) when given. "—" for what is missing.
 */
export function amountText(
	v: string | null | undefined,
	opts: { maxDecimals?: number; minDecimals?: number } = {},
): string {
	const d = dec(v);
	if (!d) return "—";
	// cut, never rounded: a figure shown is never larger than Hyperliquid's; one
	// the cut would turn to nothing is shown whole, never as a bare 0
	const cut =
		opts.maxDecimals !== undefined && d.decimalPlaces() > opts.maxDecimals
			? d.roundToDecimals(opts.maxDecimals, "down")
			: d;
	const shown = cut.isZero() && !d.isZero() ? d : cut;
	return shown.toDisplay({ minDecimals: opts.minDecimals });
}

/** The same with its sign spelled out: "+1.5", "−0.0012" (a real minus), "0". */
export function signedText(
	v: string | null | undefined,
	opts: { maxDecimals?: number; minDecimals?: number } = {},
): string {
	const d = dec(v);
	if (!d) return "—";
	const body = amountText(d.abs().toString(), opts);
	const zero = Decimal.tryParse(body.replaceAll(",", ""))?.isZero() ?? true;
	return zero ? body : `${d.isNegative() ? "−" : "+"}${body}`;
}

/** A rate per period as a percentage: "0.0000131" → "0.0013%". */
export function percentText(
	rate: string | null | undefined,
	decimals = 4,
): string {
	const d = dec(rate);
	if (!d) return "—";
	const pct = d
		.mul(Decimal.parse("100"))
		.roundToDecimals(decimals, "half-even");
	return `${pct.isNegative() ? "−" : ""}${pct.abs().toDisplay({ minDecimals: decimals })}%`;
}

export const positionSide = (szi: string): "Long" | "Short" =>
	signOf(szi) < 0 ? "Short" : "Long";

export const orderSide = (side: "B" | "A"): "Buy" | "Sell" =>
	side === "B" ? "Buy" : "Sell";

/** A size without its sign. */
export const sizeOf = (szi: string): string =>
	dec(szi)?.abs().toString() ?? szi;

/** "Limit", "Stop Market at 99", with "reduce only" where it applies. */
export function orderTypeText(o: OrderRow): string {
	const parts = [o.orderType ?? (o.isTrigger ? "Trigger" : "Limit")];
	if (o.isTrigger && o.triggerPx) parts.push(`at ${amountText(o.triggerPx)}`);
	return `${parts.join(" ")}${o.reduceOnly ? ", reduce only" : ""}`;
}

/** What a fill moved: price × size. */
export function fillValue(f: Pick<FillRow, "px" | "sz">): string | null {
	const px = dec(f.px);
	const sz = dec(f.sz);
	return px && sz ? px.mul(sz).toString() : null;
}

/** Whether a row of a table holds anything worth a line (a balance of zero does not). */
export const isNonZero = (v: string | null | undefined): boolean =>
	signOf(v) !== 0;

// ───────────────────────────── ledger ─────────────────────────────

const VENUE: Record<string, string> = {
	perp: "perps",
	spot: "spot",
	staking: "staking",
	vault: "vault",
};
const venueText = (v: string | null): string =>
	v === null ? "?" : (VENUE[v] ?? `the ${v} market`);

export interface LedgerWhat {
	/** "Sent to", "Received from", "Moved spot → perps"… */
	readonly text: string;
	/** The other account, to be shown after the text; null when there is none. */
	readonly party: string | null;
}

/** One ledger entry in plain words, seen from the account. */
export function ledgerWhat(r: LedgerRow): LedgerWhat {
	const party = r.counterparty;
	switch (r.type) {
		case "deposit":
			return { text: "Deposited from Arbitrum", party: null };
		case "withdraw":
			return { text: "Withdrawn to Arbitrum", party: null };
		case "accountClassTransfer":
		case "cStakingTransfer":
			return {
				text: `Moved ${venueText(r.fromVenue)} → ${venueText(r.toVenue)}`,
				party: null,
			};
		case "vaultCreate":
			return { text: "Created vault", party };
		case "vaultDeposit":
			return { text: "Deposited into vault", party };
		case "vaultWithdraw":
			return { text: "Withdrawn from vault", party };
		case "vaultDistribution":
			return { text: "Distribution from vault", party };
		case "rewardsClaim":
			return { text: "Claimed rewards", party: null };
		case "spotGenesis":
			return { text: "Token genesis", party: null };
		case "liquidation":
			return { text: "Liquidation", party: null };
	}
	if (r.direction === "out") return { text: "Sent to", party };
	if (r.direction === "in") return { text: "Received from", party };
	if (r.direction === "within")
		return {
			text: `Moved ${venueText(r.fromVenue)} → ${venueText(r.toVenue)}`,
			party: null,
		};
	// a kind this code does not know: its own name, nothing guessed
	return { text: r.type, party: null };
}

/** The fee this account paid on a ledger entry; null when it paid none (the sender pays). */
export const ledgerFeePaid = (r: LedgerRow): string | null =>
	r.direction === "in" ? null : r.fee;

/** The amount with the direction as its sign: out is negative, in positive, a move has none. */
export function ledgerAmount(r: LedgerRow): string | null {
	const d = dec(r.amount);
	if (!d) return null;
	const size = d.abs();
	return r.direction === "out" ? size.neg().toString() : size.toString();
}

// ───────────────────────────── links ─────────────────────────────

export const HL_APP: Record<Network, string> = {
	mainnet: "https://app.hyperliquid.xyz",
	testnet: "https://app.hyperliquid-testnet.xyz",
};

export type MoreKind =
	| "transferHistory"
	| "tradeHistory"
	| "historicalOrders"
	| "fundingHistory";

/** Hyperliquid's own page with the full list a table shows the start of. */
export function viewMoreUrl(
	network: Network,
	kind: MoreKind,
	address: string,
): string {
	return `${HL_APP[network]}/${kind}/${address.toLowerCase()}`;
}

/**
 * Text from Hyperliquid's feed as one path segment of a link. Half a
 * surrogate pair is dropped first: `encodeURIComponent` throws on one, and a
 * link must never be what stops a table from being drawn.
 */
const segment = (text: string): string =>
	encodeURIComponent(text.toLowerCase().replace(/\p{Cs}/gu, ""));

/** The account on Hyperliquid's explorer. */
export function explorerAccountUrl(network: Network, address: string): string {
	return `${HL_APP[network]}/explorer/address/${segment(address)}`;
}

/**
 * One transaction on Hyperliquid's explorer. The hash comes from Hyperliquid's
 * feed as it is, so it is written as one path segment whatever it holds: a
 * link made here leads to that page of the explorer and nowhere else.
 */
export function explorerTxUrl(network: Network, hash: string): string {
	return `${HL_APP[network]}/explorer/tx/${segment(hash)}`;
}
