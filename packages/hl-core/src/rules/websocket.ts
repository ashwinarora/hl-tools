import { defineRuleSet, docs } from "./meta.ts";

export const WEBSOCKET_RULES = defineRuleSet({
	id: "websocket",
	title: "WebSocket channels & semantics",
	version: "1.1.0",
	verifiedAt: "2026-09-28",
	summary:
		"Subscribe with {method:'subscribe', subscription:{type,…}}; the server acks on channel 'subscriptionResponse'. No channel carries a sequence number or resume cursor: after a reconnect you re-subscribe and rebuild state from the next snapshot. Streaming user channels send a first message with isSnapshot: true. The server closes connections idle for 60 s; send {method:'ping'} to keep alive.",
	sources: [
		docs("for-developers/api/websocket/subscriptions", "Subscriptions"),
		docs(
			"for-developers/api/websocket/timeouts-and-heartbeats",
			"Timeouts and heartbeats",
		),
		docs(
			"for-developers/api/rate-limits-and-user-limits",
			"Rate limits (WebSocket caps)",
		),
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-09-28",
			note: "Initial encoding of 20 channels.",
		},
		{
			version: "1.1.0",
			date: "2026-09-28",
			note: "trades: the first message replays recent trades without an isSnapshot flag (observed on mainnet, not in the docs); modelled as snapshot-then-deltas.",
		},
	],
});

export type WsParamKind = "coin" | "user" | "interval" | "dex" | "int" | "bool";

export interface WsParamSpec {
	readonly name: string;
	readonly kind: WsParamKind;
	readonly required: boolean;
	readonly description: string;
}

/**
 * How a channel's messages relate to each other:
 * - `snapshot`: every message is the complete current state (replace).
 * - `snapshot-then-deltas`: first message has isSnapshot: true with history,
 *   later messages append new items (dedupe by a unique id).
 * - `events`: no snapshot; each message is new events only.
 */
export type WsSemantics = "snapshot" | "snapshot-then-deltas" | "events";

export interface WsChannelSpec {
	readonly type: string;
	/** `channel` value on data messages (differs from type for userEvents). */
	readonly channel: string;
	readonly label: string;
	readonly params: readonly WsParamSpec[];
	readonly semantics: WsSemantics;
	/** Field(s) usable to dedupe/merge items, if any. */
	readonly identity: string | null;
	/** Human explanation of ordering/cursor semantics. */
	readonly ordering: string;
	readonly userSpecific: boolean;
	readonly description: string;
}

const coin: WsParamSpec = {
	name: "coin",
	kind: "coin",
	required: true,
	description: "Info/WS coin string (resolve with the Asset Resolver).",
};
const user: WsParamSpec = {
	name: "user",
	kind: "user",
	required: true,
	description: "Master or sub-account address (not an agent address).",
};
const dexOpt: WsParamSpec = {
	name: "dex",
	kind: "dex",
	required: false,
	description: "Perp dex name; empty = first perp dex.",
};

export const CANDLE_INTERVALS = [
	"1m",
	"3m",
	"5m",
	"15m",
	"30m",
	"1h",
	"2h",
	"4h",
	"8h",
	"12h",
	"1d",
	"3d",
	"1w",
	"1M",
] as const;

const NO_SEQ =
	"No sequence number. Messages arrive in block order on a single connection; after reconnect there is no way to request missed messages.";

export const WS_CHANNELS: readonly WsChannelSpec[] = [
	{
		type: "allMids",
		channel: "allMids",
		label: "All mids",
		params: [dexOpt],
		semantics: "snapshot",
		identity: null,
		ordering: `${NO_SEQ} Each message is the full mid map; the latest message wins.`,
		userSpecific: false,
		description:
			"Mid price of every coin on a perp dex (spot mids only on the first dex).",
	},
	{
		type: "l2Book",
		channel: "l2Book",
		label: "L2 book",
		params: [
			coin,
			{
				name: "nSigFigs",
				kind: "int",
				required: false,
				description: "Aggregate to 2–5 significant figures.",
			},
			{
				name: "mantissa",
				kind: "int",
				required: false,
				description: "1, 2 or 5 (only with nSigFigs 5).",
			},
		],
		semantics: "snapshot",
		identity: "time",
		ordering: `${NO_SEQ} Full book snapshot pushed on blocks at least 0.5 s apart; \`time\` is the block time and increases monotonically — use it to discard stale snapshots.`,
		userSpecific: false,
		description: "Aggregated order book levels (20 per side).",
	},
	{
		type: "trades",
		channel: "trades",
		label: "Trades",
		params: [coin],
		semantics: "snapshot-then-deltas",
		identity: "tid",
		ordering: `${NO_SEQ} The first message after subscribing replays recent trades (30 observed on mainnet) without an isSnapshot flag; later messages carry only new trades. \`tid\` is a 50-bit hash of the two oids; dedupe by (time, coin, tid).`,
		userSpecific: false,
		description: "Public trades on a coin.",
	},
	{
		type: "bbo",
		channel: "bbo",
		label: "Best bid/offer",
		params: [coin],
		semantics: "snapshot",
		identity: "time",
		ordering: `${NO_SEQ} Sent only on blocks where the BBO changed; silence means unchanged, not stale.`,
		userSpecific: false,
		description: "Top of book.",
	},
	{
		type: "candle",
		channel: "candle",
		label: "Candles",
		params: [
			coin,
			{
				name: "interval",
				kind: "interval",
				required: true,
				description: "Candle interval.",
			},
		],
		semantics: "snapshot",
		identity: "t",
		ordering: `${NO_SEQ} Each message is the current state of the open candle; key by open time \`t\`. A new \`t\` means the previous candle closed.`,
		userSpecific: false,
		description: "Streaming OHLCV for the open candle.",
	},
	{
		type: "activeAssetCtx",
		channel: "activeAssetCtx",
		label: "Active asset context",
		params: [coin],
		semantics: "snapshot",
		identity: null,
		ordering: `${NO_SEQ} Latest context replaces the previous one. Spot coins arrive on channel activeSpotAssetCtx.`,
		userSpecific: false,
		description: "Mark/oracle/funding/OI context for a coin.",
	},
	{
		type: "userFills",
		channel: "userFills",
		label: "User fills",
		params: [
			user,
			{
				name: "aggregateByTime",
				kind: "bool",
				required: false,
				description: "Merge partial fills of one order in the same block.",
			},
		],
		semantics: "snapshot-then-deltas",
		identity: "tid",
		ordering: `${NO_SEQ} First message has isSnapshot: true with recent fills; afterwards only new fills. Dedupe by (hash, tid) when re-subscribing.`,
		userSpecific: true,
		description: "Fills for a user.",
	},
	{
		type: "orderUpdates",
		channel: "orderUpdates",
		label: "Order updates",
		params: [user],
		semantics: "events",
		identity: "order.oid",
		ordering: `${NO_SEQ} Status transitions only, no initial snapshot — fetch openOrders via REST after (re)subscribing. Key by oid; the latest statusTimestamp wins.`,
		userSpecific: true,
		description: "Order status changes for a user.",
	},
	{
		type: "userEvents",
		channel: "user",
		label: "User events",
		params: [user],
		semantics: "events",
		identity: null,
		ordering: `${NO_SEQ} Fills, funding, liquidations and non-user cancels. Note the channel name is "user".`,
		userSpecific: true,
		description: "Non-order user events.",
	},
	{
		type: "userFundings",
		channel: "userFundings",
		label: "User fundings",
		params: [user],
		semantics: "snapshot-then-deltas",
		identity: "time",
		ordering: `${NO_SEQ} Snapshot then hourly funding payments.`,
		userSpecific: true,
		description: "Funding payments.",
	},
	{
		type: "userNonFundingLedgerUpdates",
		channel: "userNonFundingLedgerUpdates",
		label: "Ledger updates",
		params: [user],
		semantics: "snapshot-then-deltas",
		identity: "hash",
		ordering: `${NO_SEQ} Snapshot then deposits, withdrawals, transfers, liquidations.`,
		userSpecific: true,
		description: "Non-funding ledger updates.",
	},
	{
		type: "clearinghouseState",
		channel: "clearinghouseState",
		label: "Clearinghouse state",
		params: [user, dexOpt],
		semantics: "snapshot",
		identity: null,
		ordering: `${NO_SEQ} Full perp account state each message.`,
		userSpecific: true,
		description: "Perp positions and margin.",
	},
	{
		type: "openOrders",
		channel: "openOrders",
		label: "Open orders",
		params: [user, dexOpt],
		semantics: "snapshot",
		identity: null,
		ordering: `${NO_SEQ} Full open-order list each message.`,
		userSpecific: true,
		description: "Open orders.",
	},
	{
		type: "spotState",
		channel: "spotState",
		label: "Spot state",
		params: [user],
		semantics: "snapshot",
		identity: null,
		ordering: `${NO_SEQ} Full spot balances each message.`,
		userSpecific: true,
		description: "Spot balances.",
	},
	{
		type: "webData3",
		channel: "webData3",
		label: "Web data v3",
		params: [user],
		semantics: "snapshot",
		identity: null,
		ordering: `${NO_SEQ} Frontend aggregate; undocumented fields may be removed.`,
		userSpecific: true,
		description: "Frontend aggregate user data.",
	},
	{
		type: "activeAssetData",
		channel: "activeAssetData",
		label: "Active asset data",
		params: [user, coin],
		semantics: "snapshot",
		identity: null,
		ordering: `${NO_SEQ} Perps only.`,
		userSpecific: true,
		description: "Leverage and max trade sizes for a user on a coin.",
	},
	{
		type: "twapStates",
		channel: "twapStates",
		label: "TWAP states",
		params: [user, dexOpt],
		semantics: "snapshot",
		identity: null,
		ordering: NO_SEQ,
		userSpecific: true,
		description: "Running TWAPs.",
	},
	{
		type: "notification",
		channel: "notification",
		label: "Notifications",
		params: [user],
		semantics: "events",
		identity: null,
		ordering: NO_SEQ,
		userSpecific: true,
		description: "Frontend notifications.",
	},
	{
		type: "allDexsAssetCtxs",
		channel: "allDexsAssetCtxs",
		label: "All dex asset contexts",
		params: [],
		semantics: "snapshot",
		identity: null,
		ordering: NO_SEQ,
		userSpecific: false,
		description: "Asset contexts across every perp dex.",
	},
	{
		type: "outcomeMetaUpdates",
		channel: "outcomeMetaUpdates",
		label: "Outcome meta updates",
		params: [],
		semantics: "events",
		identity: null,
		ordering: `${NO_SEQ} Created/settled outcome and question events (HIP-4).`,
		userSpecific: false,
		description: "HIP-4 outcome lifecycle events.",
	},
];

const BY_TYPE = new Map(WS_CHANNELS.map((c) => [c.type, c]));

export function wsChannel(type: string): WsChannelSpec | undefined {
	return BY_TYPE.get(type);
}
