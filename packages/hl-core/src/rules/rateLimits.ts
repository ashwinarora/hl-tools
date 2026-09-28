import { defineRuleSet, docs } from "./meta.ts";

export const RATE_LIMIT_RULES = defineRuleSet({
	id: "rate-limits",
	title: "Rate-limit classes",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"Per-IP REST weight budget of 1200/min (exchange weight 1 + floor(batch/40); info weight 2, 20 or 60 plus per-item surcharges), WebSocket connection/subscription caps, 100 req/min on the public HyperEVM RPC, and per-address action budgets tied to traded volume.",
	sources: [
		docs(
			"for-developers/api/rate-limits-and-user-limits",
			"Rate limits and user limits",
		),
	],
	changelog: [
		{ version: "1.0.0", date: "2026-09-28", note: "Initial encoding." },
	],
});

export const REST_WEIGHT_PER_MINUTE = 1200;

export type InfoWeightClass = "light" | "standard" | "heavy";

const LIGHT_INFO = new Set([
	"l2Book",
	"allMids",
	"clearinghouseState",
	"orderStatus",
	"spotClearinghouseState",
	"exchangeStatus",
]);
const HEAVY_INFO = new Set(["userRole"]);
/** Extra weight per 20 items returned. */
export const PER_20_ITEMS_INFO = new Set([
	"recentTrades",
	"historicalOrders",
	"userFills",
	"userFillsByTime",
	"fundingHistory",
	"userFunding",
	"nonUserFundingUpdates",
	"twapHistory",
	"userTwapSliceFills",
	"userTwapSliceFillsByTime",
	"delegatorHistory",
	"delegatorRewards",
	"validatorStats",
]);
/** Extra weight per 60 items returned. */
export const PER_60_ITEMS_INFO = new Set(["candleSnapshot"]);

export interface InfoWeight {
	readonly type: string;
	readonly weightClass: InfoWeightClass;
	readonly baseWeight: number;
	readonly surcharge: "per20items" | "per60items" | null;
}

export function infoRequestWeight(type: string): InfoWeight {
	const weightClass: InfoWeightClass = LIGHT_INFO.has(type)
		? "light"
		: HEAVY_INFO.has(type)
			? "heavy"
			: "standard";
	const baseWeight =
		weightClass === "light" ? 2 : weightClass === "heavy" ? 60 : 20;
	const surcharge = PER_20_ITEMS_INFO.has(type)
		? "per20items"
		: PER_60_ITEMS_INFO.has(type)
			? "per60items"
			: null;
	return { type, weightClass, baseWeight, surcharge };
}

/** IP weight of an exchange action with `batchLength` orders/cancels. */
export function exchangeRequestWeight(batchLength: number): number {
	return 1 + Math.floor(Math.max(0, batchLength) / 40);
}

export const WS_LIMITS = {
	maxConnections: 10,
	maxNewConnectionsPerMinute: 30,
	maxSubscriptions: 1000,
	maxUniqueUsersInUserSubscriptions: 10,
	maxMessagesPerMinute: 2000,
	maxInflightPosts: 100,
	/** Server closes a connection it hasn't sent to in this long. */
	idleTimeoutMs: 60_000,
} as const;

export const EVM_RPC_REQUESTS_PER_MINUTE = 100;

export const ADDRESS_LIMITS = {
	initialBuffer: 10_000,
	requestsPerUsdcTraded: 1,
	whenLimitedOneRequestEveryMs: 10_000,
	cancelLimit: (limit: number) => Math.min(limit + 100_000, limit * 2),
} as const;
