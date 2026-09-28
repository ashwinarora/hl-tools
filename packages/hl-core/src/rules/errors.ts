import { defineRuleSet, docs } from "./meta.ts";

export const ERROR_RULES = defineRuleSet({
	id: "errors",
	title: "Exchange error catalog",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"Documented order/cancel error strings with their historical-status codes, signing/deposit errors, HTTP-level failures (422 deserialisation, 429 rate limiting) and a small number of pattern-matched messages that are not in the docs (flagged as undocumented).",
	sources: [
		docs("for-developers/api/error-responses", "Error responses"),
		docs("for-developers/api/signing", "Signing (common errors)"),
		docs(
			"for-developers/api/info-endpoint",
			"Info endpoint (order status values)",
		),
		docs(
			"for-developers/api/rate-limits-and-user-limits",
			"Rate limits and user limits",
		),
	],
	changelog: [
		{ version: "1.0.0", date: "2026-09-28", note: "Initial catalog." },
	],
});

export type ErrorCategory =
	| "precision"
	| "margin"
	| "matching"
	| "limits"
	| "signing"
	| "account"
	| "payload"
	| "transport";

export interface ErrorEntry {
	readonly id: string;
	/** Case-insensitive regex tested against the error string. */
	readonly pattern: RegExp;
	/** Documented example text, if the docs publish one. */
	readonly example: string;
	/** Historical order status this corresponds to, if any. */
	readonly status?: string;
	readonly category: ErrorCategory;
	readonly cause: string;
	readonly fix: string;
	/** true if the exact wording is in the official docs. */
	readonly documented: boolean;
	/** Whether the whole batch was rejected in pre-validation. */
	readonly preValidation?: boolean;
}

export const ERROR_CATALOG: readonly ErrorEntry[] = [
	{
		id: "tick",
		pattern: /price must be divisible by tick size/i,
		example: "Price must be divisible by tick size.",
		status: "tickRejected",
		category: "precision",
		cause:
			"The price has more than 5 significant figures (and is not an integer) or more than MAX_DECIMALS − szDecimals decimal places.",
		fix: "Run the price through the precision linter and use the rounded wire value.",
		documented: true,
	},
	{
		id: "min-notional-perp",
		pattern: /minimum value of \$10/i,
		example: "Order must have minimum value of $10.",
		status: "minTradeNtlRejected",
		category: "limits",
		cause: "price × size is below $10 for a perp order.",
		fix: "Increase size so that notional ≥ 10 USDC (reduce-only closes of smaller positions are allowed at market).",
		documented: true,
	},
	{
		id: "min-notional-spot",
		pattern: /minimum value of 10 \S+/i,
		example: "Order must have minimum value of 10 USDC.",
		status: "minTradeNtlRejected",
		category: "limits",
		cause:
			"price × size is below 10 units of the quote token for a spot order.",
		fix: "Increase size so that notional ≥ 10 quote units.",
		documented: true,
	},
	{
		id: "perp-margin",
		pattern: /insufficient margin to place order/i,
		example: "Insufficient margin to place order.",
		status: "perpMarginRejected",
		category: "margin",
		cause:
			"Initial margin for the new order exceeds available cross (or isolated) margin at the current leverage.",
		fix: "Reduce size, raise leverage (updateLeverage), or add collateral. Check the account abstraction mode: unified/portfolio margin draw from spot balances.",
		documented: true,
	},
	{
		id: "reduce-only",
		pattern: /reduce only order would increase position/i,
		example: "Reduce only order would increase position.",
		status: "reduceOnlyRejected",
		category: "matching",
		cause:
			"`r: true` but there is no position, or the order is on the same side as the position.",
		fix: "Use the opposite side of the open position, or set r to false.",
		documented: true,
	},
	{
		id: "bad-alo",
		pattern: /post only order would have immediately matched/i,
		example:
			"Post only order would have immediately matched, bbo was 1.2345@1.2346.",
		status: "badAloPxRejected",
		category: "matching",
		cause:
			"An Alo (post-only) order was priced through the opposite side of the book.",
		fix: "Price a buy below the best ask (or a sell above the best bid), or switch to Gtc.",
		documented: true,
	},
	{
		id: "ioc-cancel",
		pattern: /could not immediately match against any resting orders/i,
		example: "Order could not immediately match against any resting orders.",
		status: "iocCancelRejected",
		category: "matching",
		cause: "An Ioc order found nothing to match at its limit price.",
		fix: "Make the limit price more aggressive (market orders are Ioc at a slippage-adjusted price) or use Gtc.",
		documented: true,
	},
	{
		id: "bad-trigger",
		pattern: /invalid tp\/sl price/i,
		example: "Invalid TP/SL price.",
		status: "badTriggerPxRejected",
		category: "matching",
		cause:
			"The trigger price is on the wrong side of the mark price for the TP/SL direction (e.g. a long's stop-loss above mark).",
		fix: "For a long: TP trigger above mark, SL trigger below mark. For a short, the reverse.",
		documented: true,
	},
	{
		id: "no-liquidity",
		pattern: /no liquidity available for market order/i,
		example: "No liquidity available for market order.",
		status: "marketOrderNoLiquidityRejected",
		category: "matching",
		cause: "The book had no resting liquidity on the opposite side.",
		fix: "Retry later or rest a limit order.",
		documented: true,
	},
	{
		id: "missing-order",
		pattern: /order was never placed, already canceled, or filled/i,
		example: "Order was never placed, already canceled, or filled.",
		category: "matching",
		cause:
			"The oid/cloid does not correspond to a resting order for this account and asset.",
		fix: "Check the asset ID and that you query the account that owns the order (not the agent). Use orderStatus to see what happened.",
		documented: true,
	},
	{
		id: "oi-cap",
		pattern: /open interest (while open interest is capped|too quickly)/i,
		example: "Order would increase open interest while open interest is capped",
		status: "positionIncreaseAtOpenInterestCapRejected",
		category: "limits",
		cause: "The asset is at its open-interest cap (or OI is growing too fast).",
		fix: "Only reducing orders are accepted until OI drops; retry later.",
		documented: true,
	},
	{
		id: "oi-cap-aggressive",
		pattern: /more aggressive than oracle while at open interest cap/i,
		example:
			"Order rejected due to price more aggressive than oracle while at open interest cap",
		status: "tooAggressiveAtOpenInterestCapRejected",
		category: "limits",
		cause: "At the OI cap, orders priced through the oracle are rejected.",
		fix: "Price the order no more aggressively than the oracle price.",
		documented: true,
	},
	{
		id: "spot-balance",
		pattern: /insufficient spot balance/i,
		example: "Order has insufficient spot balance to trade",
		status: "insufficientSpotBalanceRejected",
		category: "margin",
		cause:
			"Not enough of the token being sold (or the quote token for a buy) in the spot balance.",
		fix: "Transfer funds into spot (usdClassTransfer toPerp: false) or reduce size.",
		documented: true,
	},
	{
		id: "oracle",
		pattern: /price too far from oracle/i,
		example: "Order price too far from oracle",
		status: "oracleRejected",
		category: "limits",
		cause:
			"The limit price is outside the allowed band around the oracle price.",
		fix: "Move the price closer to the oracle/mark price.",
		documented: true,
	},
	{
		id: "max-position",
		pattern: /exceed margin tier limit/i,
		example:
			"Order would cause position to exceed margin tier limit at current leverage",
		status: "perpMaxPositionRejected",
		category: "limits",
		cause:
			"The resulting position is larger than the margin tier allows at this leverage.",
		fix: "Lower leverage (higher tiers allow larger notional at lower leverage) or reduce size.",
		documented: true,
	},
	{
		id: "signer-missing",
		pattern: /user or api wallet 0x[0-9a-f]+ does not exist/i,
		example: "L1 error: User or API Wallet 0x0123… does not exist.",
		category: "signing",
		cause:
			"The recovered signer is not a known user or approved agent. Almost always the signature was computed over different bytes than the server hashes (field order, trailing zeros, uppercase address, wrong scheme or network), so a different address was recovered.",
		fix: "Paste the action into the Signing Inspector with your signature and compare the recovered address with your wallet. The recovered address changes when the payload changes.",
		documented: true,
	},
	{
		id: "must-deposit",
		pattern: /must deposit before performing actions/i,
		example: "Must deposit before performing actions. User: 0x123…",
		category: "account",
		cause:
			"Either the account genuinely has never deposited, or (more commonly while developing) the signature recovers to an unexpected, empty address.",
		fix: "If the address in the message is not yours, debug the signature in the Signing Inspector. Otherwise deposit first.",
		documented: true,
	},
	{
		id: "rate-limit-address",
		pattern: /too many cumulative requests/i,
		example:
			"Too many cumulative requests sent (…) for cumulative volume traded $…",
		category: "limits",
		cause:
			"Address-based action budget exhausted (1 request per 1 USDC traded, 10,000 initial buffer).",
		fix: "Trade volume to free budget, batch orders, or buy capacity with reserveRequestWeight. Cancels have a larger budget.",
		documented: false,
	},
	{
		id: "nonce",
		pattern: /nonce/i,
		example: "Invalid nonce …",
		category: "signing",
		cause:
			"Nonces must be unique per signer, larger than the smallest of the signer's 100 highest nonces, and within (T − 2 days, T + 1 day) of the block time. Agents and the master account have separate nonce sets.",
		fix: "Use a millisecond-timestamp counter per signer; don't reuse nonces across processes sharing an API wallet.",
		documented: false,
	},
	{
		id: "reference-price",
		pattern: /away from the reference price/i,
		example:
			"Order price cannot be more than 80% away from the reference price",
		category: "limits",
		cause: "Pre-validation rejected a price far from the reference price.",
		fix: "Use a price close to the current mark.",
		documented: false,
		preValidation: true,
	},
	{
		id: "expired",
		pattern: /expired|expiresAfter/i,
		example: "… expired",
		category: "payload",
		cause:
			"The action's expiresAfter is in the past. Stale expiresAfter cancels consume 5× the address rate limit.",
		fix: "Set expiresAfter a few seconds in the future at signing time.",
		documented: false,
	},
	{
		id: "deserialize",
		pattern: /failed to deserialize/i,
		example: "Failed to deserialize the JSON body into the target type: …",
		category: "payload",
		cause:
			"HTTP 422: the request body does not match the action schema (misspelled field, number where a string is expected, missing `type`, extra wrapper).",
		fix: "Compare against a generated payload in the Order Composer; prices and sizes must be strings, asset IDs numbers.",
		documented: false,
	},
];

export function matchError(message: string): ErrorEntry | undefined {
	return ERROR_CATALOG.find((e) => e.pattern.test(message));
}

export const HTTP_STATUS_NOTES: Readonly<Record<number, string>> = {
	200: "Request accepted by the API server. The action may still have failed: inspect `status` and each entry of `response.data.statuses`.",
	400: "Bad request — usually malformed JSON.",
	422: "Unprocessable entity — the JSON parsed but doesn't deserialize into the action schema.",
	429: "Rate limited (IP weight budget of 1200/min exceeded).",
	500: "Server error — retry with backoff.",
};
