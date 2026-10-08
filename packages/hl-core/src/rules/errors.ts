import { defineRuleSet, docs } from "./meta.ts";

export const ERROR_RULES = defineRuleSet({
	id: "errors",
	title: "Exchange error catalog",
	version: "1.1.0",
	verifiedAt: "2026-10-07",
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
		{
			version: "1.1.0",
			date: "2026-10-07",
			note: "Multi-sig errors (threshold, inner/outer signer, leader, signer-set rules, revert shape), nonce window messages with extracted bounds, network signature mismatch and unregistered vault — all recorded on testnet.",
		},
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
		id: "multisig-required",
		pattern: /^multi-sig required/i,
		example: "Multi-sig required",
		category: "account",
		cause:
			"The account is a multi-sig user: its own key (and any single-signer request) can no longer send. Every action must be wrapped in a `multiSig` envelope submitted by an authorized leader.",
		fix: 'Build a proposal, collect `threshold` signatures from authorized users and submit the envelope from the leader. To use the key directly again, revert with `signers: "null"` via the multi-sig.',
		documented: true,
	},
	{
		id: "multisig-threshold",
		pattern: /multi-sig threshold not met/i,
		example: "Multi-sig threshold not met",
		category: "signing",
		cause:
			"Fewer distinct authorized signers than the threshold. Duplicate signatures from one signer count once; signatures from non-authorized or removed signers are rejected earlier.",
		fix: "Collect signatures from more authorized users over the exact same payload, nonce and leader, then resubmit.",
		documented: true,
	},
	{
		id: "multisig-inner-signer",
		pattern: /invalid multi-sig inner signer/i,
		example: "Invalid multi-sig inner signer",
		category: "signing",
		cause:
			"An inner signature does not recover to an authorized user. Either the signer is not authorized (stranger, the multi-sig user itself, an API wallet), or it signed different bytes: another nonce, action, leader, multi-sig user, vault address, expiry, or the other network's domain.",
		fix: "Verify each signature locally against the canonical digest and compare with the signer list; re-sign the one that diverged with identical inputs.",
		documented: true,
	},
	{
		id: "multisig-outer-signer",
		pattern: /invalid multi-sig outer signer/i,
		example: "Invalid multi-sig outer signer",
		category: "signing",
		cause:
			"The envelope signature does not recover to an authorized leader. Common causes: the leader is not an authorized user, the `outerSigner` field names someone else, or an inner signature was sent with leading zero bytes (the chain trims them before re-hashing the envelope).",
		fix: "Make the leader an authorized user, set `outerSigner` to the leader's address, trim inner r/s, then sign the envelope last.",
		documented: true,
	},
	{
		id: "multisig-leader-not-user",
		pattern: /multi-sig outer signer must be an l1 user/i,
		example: "Multi-sig outer signer must be an L1 user.",
		category: "account",
		cause:
			"The leader address has never deposited on Hyperliquid. An API wallet of an authorized user can lead only once the agent address itself holds funds.",
		fix: "Lead with an authorized user's own key, or send a small deposit to the agent address first.",
		documented: true,
	},
	{
		id: "multisig-not-multisig",
		pattern: /invalid multi-sig user/i,
		example: "Invalid multi-sig user",
		category: "account",
		cause:
			"`payload.multiSigUser` is not a multi-sig user (never converted, or reverted to a normal user).",
		fix: "Check `userToMultiSigSigners`; a normal user sends actions directly.",
		documented: true,
	},
	{
		id: "multisig-threshold-invalid",
		pattern: /invalid multi-sig threshold/i,
		example: "Invalid multi-sig threshold",
		category: "payload",
		cause:
			"`threshold` is 0, larger than the number of authorized users, or the list is empty.",
		fix: 'Use 1 ≤ threshold ≤ signers. To revert to a normal user send `"signers": "null"`, not an empty list.',
		documented: true,
	},
	{
		id: "multisig-signer-missing",
		pattern: /multi-sig authorized user must exist/i,
		example: "Multi-sig authorized user must exist on L1",
		category: "account",
		cause:
			"An address in `authorizedUsers` has never received funds on Hyperliquid, so it is not a user yet. This check runs before the 10-signer limit.",
		fix: "Send each new signer a small deposit (the first transfer to a fresh address costs 1 USDC) and retry.",
		documented: true,
	},
	{
		id: "multisig-self",
		pattern: /cannot register self as multi-sig authorized user/i,
		example: "Cannot register self as multi-sig authorized user",
		category: "payload",
		cause: "The account listed its own address among the authorized users.",
		fix: "Remove the account's own address from the list.",
		documented: true,
	},
	{
		id: "multisig-too-many",
		pattern: /too many multi-sig signers/i,
		example: "Too many multi-sig signers",
		category: "payload",
		cause: "More than 10 authorized users.",
		fix: "Keep the list to at most 10 addresses.",
		documented: true,
	},
	{
		id: "nonce-mismatch",
		pattern: /^nonce mismatch/i,
		example: "Nonce mismatch.",
		category: "signing",
		cause:
			"A user-signed action's own `nonce`/`time` field differs from the request nonce (for a multi-sig envelope: from the envelope nonce).",
		fix: "Set the action's `nonce` or `time` to the same millisecond value as the envelope nonce before signing.",
		documented: true,
	},
	{
		id: "nonce-low",
		pattern: /nonce too low (\d+) < (\d+)/i,
		example: "Invalid nonce: nonce too low 1791140676851 < 1791227196699",
		category: "signing",
		cause:
			"The nonce is older than the allowed window (about 2 days before block time), or not above the smallest of the signer's 100 highest nonces.",
		fix: "Create a fresh proposal with a current nonce; every signer must sign again.",
		documented: true,
	},
	{
		id: "nonce-high",
		pattern: /nonce too high (\d+) > (\d+)/i,
		example: "Invalid nonce: nonce too high 1791572677029 > 1791486156858",
		category: "signing",
		cause: "The nonce is more than about 1 day ahead of block time.",
		fix: "Use a nonce no further than 1 day in the future.",
		documented: true,
	},
	{
		id: "nonce-duplicate",
		pattern: /duplicate nonce (\d+)/i,
		example: "Invalid nonce: duplicate nonce 1791399877207",
		category: "signing",
		cause:
			"The leader already used this nonce (the same envelope was submitted twice, or two proposals share a nonce). Nonce sets are per leader.",
		fix: "If the first submission succeeded, nothing to do. Otherwise re-propose with a new nonce.",
		documented: true,
	},
	{
		id: "network-signature",
		pattern: /mainnet and testnet require different signature/i,
		example: "Mainnet and testnet require different signature.",
		category: "signing",
		cause:
			'A user-signed action carried `hyperliquidChain` for the other network ("Mainnet" sent to testnet or vice versa).',
		fix: "Set `hyperliquidChain` to the network you are sending to and sign again.",
		documented: true,
	},
	{
		id: "revert-shape",
		pattern: /unexpected error \(code=148\)/i,
		example: "Unexpected error (code=148)",
		category: "payload",
		cause:
			"`convertToMultiSigUser.signers` did not deserialise: typically `authorizedUsers` is missing.",
		fix: 'Send `{"authorizedUsers":[…],"threshold":n}` as a JSON string, or the literal string `"null"` to revert.',
		documented: true,
	},
	{
		id: "vault-unregistered",
		pattern: /vault not registered: (0x[0-9a-f]+)/i,
		example: "Vault not registered: 0x1111…",
		category: "account",
		cause: "`vaultAddress` is not a vault or sub-account.",
		fix: "Check the address; for a sub-account use its `subAccountUser` address.",
		documented: true,
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
