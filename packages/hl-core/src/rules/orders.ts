import { defineRuleSet, docs } from "./meta.ts";

export const ORDER_RULES = defineRuleSet({
	id: "orders",
	title: "Order types, grouping & limits",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"Limit TIFs (Gtc/Ioc/Alo), trigger orders (tp/sl, isMarket, triggerPx), grouping (na/normalTpsl/positionTpsl, priority {p}), reduce-only, cloid format, builder fee units, minimum notional, open-order limits and cancel `f` flag rules.",
	sources: [
		docs("for-developers/api/exchange-endpoint", "Exchange endpoint"),
		docs("trading/order-types", "Order types"),
		docs(
			"trading/take-profit-and-stop-loss-orders-tp-sl",
			"Take profit and stop loss orders",
		),
		docs("for-developers/api/priority-fees", "Priority fees"),
		docs("trading/builder-codes", "Builder codes"),
		docs("for-developers/api/error-responses", "Error responses"),
		docs(
			"for-developers/api/rate-limits-and-user-limits",
			"Rate limits and user limits (open-order limit)",
		),
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-09-28",
			note: "Initial encoding, including priority grouping and cancel `f` flag.",
		},
	],
});

export const TIFS = ["Gtc", "Ioc", "Alo"] as const;
export type Tif = (typeof TIFS)[number];

export const TIF_INFO: Readonly<
	Record<Tif, { label: string; behaviour: string }>
> = {
	Gtc: {
		label: "Good til canceled",
		behaviour: "Matches what it can, rests the remainder on the book.",
	},
	Ioc: {
		label: "Immediate or cancel",
		behaviour:
			"Matches what it can immediately; the unfilled remainder is canceled instead of resting.",
	},
	Alo: {
		label: "Add liquidity only (post-only)",
		behaviour:
			"Rests on the book; canceled instead of matching if it would cross the spread.",
	},
};

export const GROUPINGS = ["na", "normalTpsl", "positionTpsl"] as const;
export type NamedGrouping = (typeof GROUPINGS)[number];
export type Grouping = NamedGrouping | { readonly p: number };

export const GROUPING_INFO: Readonly<
	Record<NamedGrouping, { label: string; behaviour: string }>
> = {
	na: {
		label: "No grouping",
		behaviour: "Every order in the batch is independent.",
	},
	normalTpsl: {
		label: "Order-attached TP/SL",
		behaviour:
			"First order is the entry; following trigger orders are TP/SL children sized to the entry. Children only activate once the parent fills and are canceled if the parent is canceled.",
	},
	positionTpsl: {
		label: "Position TP/SL",
		behaviour:
			"Trigger orders attach to the whole position and resize with it; they are not tied to a specific entry order.",
	},
};

/** Priority grouping `{p}` rate is interpreted as p / 1e8 of notional. */
export const PRIORITY_RATE_DENOMINATOR = 100_000_000;

/** Cloid: 16 bytes as 0x-prefixed lowercase hex (34 chars total). */
export const CLOID_RE = /^0x[0-9a-fA-F]{32}$/;

/** Builder fee `f` is in tenths of a basis point. */
export const BUILDER_FEE_UNITS_PER_BPS = 10;
export const BUILDER_FEE_MAX_PERP_TENTHS_BPS = 100; // 0.1%
export const BUILDER_FEE_MAX_SPOT_TENTHS_BPS = 1000; // 1%

/** Minimum order notional in quote units (USDC for perps, quote token for spot). */
export const MIN_ORDER_NOTIONAL = "10";

/** Open-order limit before reduce-only and trigger orders get rejected. */
export const OPEN_ORDER_SOFT_LIMIT = 1000;
export const OPEN_ORDER_HARD_CAP = 5000;

/** TP/SL market orders use 10% slippage tolerance in the frontend. */
export const TPSL_MARKET_SLIPPAGE = "0.1";

/** scheduleCancel must be at least this far in the future. */
export const SCHEDULE_CANCEL_MIN_DELAY_MS = 5000;
export const SCHEDULE_CANCEL_MAX_TRIGGERS_PER_DAY = 10;

export const ORDER_STATUSES: Readonly<Record<string, string>> = {
	open: "Placed successfully",
	filled: "Filled",
	canceled: "Canceled by user",
	triggered: "Trigger order triggered",
	rejected: "Rejected at time of placement",
	marginCanceled: "Canceled because insufficient margin to fill",
	vaultWithdrawalCanceled:
		"Vaults only. Canceled due to a user's withdrawal from vault",
	openInterestCapCanceled:
		"Canceled due to order being too aggressive when open interest was at cap",
	selfTradeCanceled: "Canceled due to self-trade prevention",
	reduceOnlyCanceled:
		"Canceled reduced-only order that does not reduce position",
	siblingFilledCanceled:
		"TP/SL only. Canceled due to sibling ordering being filled",
	delistedCanceled: "Canceled due to asset delisting",
	liquidatedCanceled: "Canceled due to liquidation",
	scheduledCancel:
		"API only. Canceled due to exceeding scheduled cancel deadline (dead man's switch)",
	tickRejected: "Rejected due to invalid tick price",
	minTradeNtlRejected: "Rejected due to order notional below minimum",
	perpMarginRejected: "Rejected due to insufficient margin",
	reduceOnlyRejected: "Rejected due to reduce only",
	badAloPxRejected: "Rejected due to post-only immediate match",
	iocCancelRejected: "Rejected due to IOC not able to match",
	badTriggerPxRejected: "Rejected due to invalid TP/SL price",
	marketOrderNoLiquidityRejected:
		"Rejected due to lack of liquidity for market order",
	positionIncreaseAtOpenInterestCapRejected:
		"Rejected due to open interest cap",
	positionFlipAtOpenInterestCapRejected: "Rejected due to open interest cap",
	tooAggressiveAtOpenInterestCapRejected:
		"Rejected due to price too aggressive at open interest cap",
	openInterestIncreaseRejected: "Rejected due to open interest cap",
	insufficientSpotBalanceRejected: "Rejected due to insufficient spot balance",
	oracleRejected: "Rejected due to price too far from oracle",
	perpMaxPositionRejected:
		"Rejected due to exceeding margin tier limit at current leverage",
};
