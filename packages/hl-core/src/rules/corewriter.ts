import { defineRuleSet, docs, type RuleSource } from "./meta.ts";

const HYPER_EVM_LIB: RuleSource = {
	label: "hyper-evm-lib (HLConstants.sol, CoreWriterLib.sol)",
	url: "https://github.com/hyperliquid-dev/hyper-evm-lib",
};

export const COREWRITER_RULES = defineRuleSet({
	id: "corewriter",
	title: "CoreWriter action encoding",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"sendRawAction(bytes) on 0x3333…3333. Byte 0 = encoding version (only 1 is defined), bytes 1–3 = big-endian action ID, remaining bytes = raw ABI encoding of the action's field tuple. The contract emits RawAction(address indexed user, bytes data); HyperCore processes it after the EVM block (orders and vault transfers are delayed a few seconds).",
	sources: [
		docs(
			"for-developers/hyperevm/interacting-with-hypercore",
			"Interacting with HyperCore",
		),
		docs("for-developers/hyperevm/interaction-timings", "Interaction timings"),
		HYPER_EVM_LIB,
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-09-28",
			note: "Version 1 actions 1–13, 15–17. Units for limitPx/sz (1e8) and usdClassTransfer ntl (1e6) confirmed against live mainnet transactions.",
		},
	],
});

export const COREWRITER_ADDRESS = "0x3333333333333333333333333333333333333333";
/** keccak256("RawAction(address,bytes)") */
export const RAW_ACTION_TOPIC =
	"0x8c7f585fb295f7eb1e6aeb8fba61b23a4fe60beda405f0045073b185c74412e3";
export const SEND_RAW_ACTION_SELECTOR = "0x17938e13";
export const SUPPORTED_ENCODING_VERSIONS = [1] as const;

/** Approximate gas the CoreWriter burns before emitting its log. */
export const COREWRITER_BURN_GAS = 25_000;
export const COREWRITER_TYPICAL_GAS = 47_000;

export type FieldUnit =
	| { readonly kind: "raw" }
	| { readonly kind: "address" }
	| { readonly kind: "bool" }
	| { readonly kind: "string" }
	/** Action asset ID (perp index / 10000+spot / HIP-3 / outcome). */
	| { readonly kind: "asset" }
	/** HyperCore token index. */
	| { readonly kind: "token" }
	/** Fixed-point with a constant scale, e.g. 1e8 for limitPx. */
	| {
			readonly kind: "fixed";
			readonly decimals: number;
			readonly symbol?: string;
	  }
	/** Token amount in the token's weiDecimals; `tokenField` names the field holding the token index, or a constant token. */
	| {
			readonly kind: "tokenWei";
			readonly tokenField?: string;
			readonly fixedToken?: "HYPE";
	  }
	| { readonly kind: "enum"; readonly values: Readonly<Record<string, string>> }
	/** 128-bit client order id; 0 = none. */
	| { readonly kind: "cloid" }
	/** Perp dex index; uint32 max = spot. */
	| { readonly kind: "dex" }
	/** Builder fee rate in tenths of a basis point. */
	| { readonly kind: "decibps" };

export interface CoreWriterField {
	readonly name: string;
	readonly type: string;
	readonly unit: FieldUnit;
	readonly description: string;
}

export interface CoreWriterActionSpec {
	readonly id: number;
	readonly name: string;
	readonly key: string;
	readonly fields: readonly CoreWriterField[];
	readonly notes?: string;
	/** Delayed onchain before HyperCore execution (orders + vault transfers). */
	readonly delayed: boolean;
	/** Equivalent HyperCore exchange action type. */
	readonly coreActionType: string;
}

const f = (
	name: string,
	type: string,
	unit: FieldUnit,
	description: string,
): CoreWriterField => ({ name, type, unit, description });

export const TIF_ENCODING: Readonly<Record<string, string>> = {
	"1": "Alo",
	"2": "Gtc",
	"3": "Ioc",
};

export const UINT32_MAX = 4294967295;

export const COREWRITER_ACTIONS: readonly CoreWriterActionSpec[] = [
	{
		id: 1,
		name: "Limit order",
		key: "limitOrder",
		delayed: true,
		coreActionType: "order",
		fields: [
			f("asset", "uint32", { kind: "asset" }, "Action asset ID."),
			f("isBuy", "bool", { kind: "bool" }, "true = buy / long."),
			f(
				"limitPx",
				"uint64",
				{ kind: "fixed", decimals: 8 },
				"Limit price × 10^8.",
			),
			f("sz", "uint64", { kind: "fixed", decimals: 8 }, "Size × 10^8."),
			f("reduceOnly", "bool", { kind: "bool" }, "Reduce-only flag."),
			f(
				"encodedTif",
				"uint8",
				{ kind: "enum", values: TIF_ENCODING },
				"1 = Alo, 2 = Gtc, 3 = Ioc.",
			),
			f("cloid", "uint128", { kind: "cloid" }, "Client order ID; 0 = none."),
		],
		notes:
			"Price and size are always 1e8-scaled regardless of the market's szDecimals; HyperCore still applies tick/lot rules after scaling back.",
	},
	{
		id: 2,
		name: "Vault transfer",
		key: "vaultTransfer",
		delayed: true,
		coreActionType: "vaultTransfer",
		fields: [
			f("vault", "address", { kind: "address" }, "Vault address."),
			f(
				"isDeposit",
				"bool",
				{ kind: "bool" },
				"true = deposit, false = withdraw.",
			),
			f(
				"usd",
				"uint64",
				{ kind: "fixed", decimals: 6, symbol: "USDC" },
				"USD amount × 10^6.",
			),
		],
	},
	{
		id: 3,
		name: "Token delegate",
		key: "tokenDelegate",
		delayed: false,
		coreActionType: "tokenDelegate",
		fields: [
			f("validator", "address", { kind: "address" }, "Validator address."),
			f(
				"wei",
				"uint64",
				{ kind: "tokenWei", fixedToken: "HYPE" },
				"HYPE amount in wei (weiDecimals 8).",
			),
			f("isUndelegate", "bool", { kind: "bool" }, "true = undelegate."),
		],
	},
	{
		id: 4,
		name: "Staking deposit",
		key: "stakingDeposit",
		delayed: false,
		coreActionType: "cDeposit",
		fields: [
			f(
				"wei",
				"uint64",
				{ kind: "tokenWei", fixedToken: "HYPE" },
				"HYPE amount in wei (weiDecimals 8).",
			),
		],
	},
	{
		id: 5,
		name: "Staking withdraw",
		key: "stakingWithdraw",
		delayed: false,
		coreActionType: "cWithdraw",
		fields: [
			f(
				"wei",
				"uint64",
				{ kind: "tokenWei", fixedToken: "HYPE" },
				"HYPE amount in wei (weiDecimals 8).",
			),
		],
	},
	{
		id: 6,
		name: "Spot send",
		key: "spotSend",
		delayed: false,
		coreActionType: "spotSend",
		fields: [
			f("destination", "address", { kind: "address" }, "Recipient."),
			f("token", "uint64", { kind: "token" }, "Token index."),
			f(
				"wei",
				"uint64",
				{ kind: "tokenWei", tokenField: "token" },
				"Amount in the token's weiDecimals.",
			),
		],
	},
	{
		id: 7,
		name: "USD class transfer",
		key: "usdClassTransfer",
		delayed: false,
		coreActionType: "usdClassTransfer",
		fields: [
			f(
				"ntl",
				"uint64",
				{ kind: "fixed", decimals: 6, symbol: "USDC" },
				"USDC amount × 10^6.",
			),
			f(
				"toPerp",
				"bool",
				{ kind: "bool" },
				"true = spot → perp, false = perp → spot.",
			),
		],
	},
	{
		id: 8,
		name: "Finalize EVM contract",
		key: "finalizeEvmContract",
		delayed: false,
		coreActionType: "finalizeEvmContract",
		fields: [
			f("token", "uint64", { kind: "token" }, "Token index."),
			f(
				"encodedFinalizeEvmContractVariant",
				"uint8",
				{
					kind: "enum",
					values: {
						"1": "Create",
						"2": "FirstStorageSlot",
						"3": "CustomStorageSlot",
					},
				},
				"1 = Create, 2 = FirstStorageSlot, 3 = CustomStorageSlot.",
			),
			f(
				"createNonce",
				"uint64",
				{ kind: "raw" },
				"Deployer nonce (Create variant only).",
			),
		],
	},
	{
		id: 9,
		name: "Add API wallet",
		key: "addApiWallet",
		delayed: false,
		coreActionType: "approveAgent",
		fields: [
			f("apiWallet", "address", { kind: "address" }, "API wallet address."),
			f(
				"apiWalletName",
				"string",
				{ kind: "string" },
				"Empty name makes it the main (unnamed) agent.",
			),
		],
	},
	{
		id: 10,
		name: "Cancel order by oid",
		key: "cancelByOid",
		delayed: false,
		coreActionType: "cancel",
		fields: [
			f("asset", "uint32", { kind: "asset" }, "Action asset ID."),
			f("oid", "uint64", { kind: "raw" }, "Order ID."),
		],
	},
	{
		id: 11,
		name: "Cancel order by cloid",
		key: "cancelByCloid",
		delayed: false,
		coreActionType: "cancelByCloid",
		fields: [
			f("asset", "uint32", { kind: "asset" }, "Action asset ID."),
			f("cloid", "uint128", { kind: "cloid" }, "Client order ID."),
		],
	},
	{
		id: 12,
		name: "Approve builder fee",
		key: "approveBuilderFee",
		delayed: false,
		coreActionType: "approveBuilderFee",
		fields: [
			f(
				"maxFeeRate",
				"uint64",
				{ kind: "decibps" },
				"Max fee in tenths of a basis point (10 = 0.01%).",
			),
			f("builder", "address", { kind: "address" }, "Builder address."),
		],
	},
	{
		id: 13,
		name: "Send asset",
		key: "sendAsset",
		delayed: false,
		coreActionType: "sendAsset",
		fields: [
			f("destination", "address", { kind: "address" }, "Recipient."),
			f(
				"subAccount",
				"address",
				{ kind: "address" },
				"Source sub-account; zero address = the sender itself.",
			),
			f(
				"sourceDex",
				"uint32",
				{ kind: "dex" },
				"Source dex; uint32 max = spot.",
			),
			f(
				"destinationDex",
				"uint32",
				{ kind: "dex" },
				"Destination dex; uint32 max = spot.",
			),
			f("token", "uint64", { kind: "token" }, "Token index."),
			f(
				"wei",
				"uint64",
				{ kind: "tokenWei", tokenField: "token" },
				"Amount in the token's weiDecimals.",
			),
		],
	},
	{
		id: 15,
		name: "Borrow/lend operation",
		key: "borrowLend",
		delayed: false,
		coreActionType: "borrowLend",
		fields: [
			f(
				"encodedOperation",
				"uint8",
				{ kind: "enum", values: { "0": "Supply", "1": "Withdraw" } },
				"0 = Supply, 1 = Withdraw.",
			),
			f("token", "uint64", { kind: "token" }, "Token index."),
			f(
				"wei",
				"uint64",
				{ kind: "tokenWei", tokenField: "token" },
				"Amount in weiDecimals; 0 = maximal.",
			),
		],
	},
	{
		id: 16,
		name: "Set abstraction",
		key: "setAbstraction",
		delayed: false,
		coreActionType: "userSetAbstraction",
		fields: [
			f("user", "address", { kind: "address" }, "Master user or sub-account."),
			f(
				"abstraction",
				"uint8",
				{
					kind: "enum",
					values: {
						"1": "disabled",
						"2": "unifiedAccount",
						"3": "portfolioMargin",
					},
				},
				"1 = disabled, 2 = unifiedAccount, 3 = portfolioMargin.",
			),
		],
	},
	{
		id: 17,
		name: "Outcome operation",
		key: "outcomeOperation",
		delayed: false,
		coreActionType: "outcome",
		fields: [
			f(
				"encodedOperation",
				"uint8",
				{
					kind: "enum",
					values: {
						"0": "SplitOutcome",
						"1": "MergeOutcome",
						"2": "MergeQuestion",
						"3": "NegateOutcome",
					},
				},
				"0 = Split, 1 = MergeOutcome, 2 = MergeQuestion, 3 = Negate.",
			),
			f(
				"question",
				"uint32",
				{ kind: "raw" },
				"Question ID (must be 0 when unused).",
			),
			f(
				"outcome",
				"uint32",
				{ kind: "raw" },
				"Outcome ID (must be 0 when unused).",
			),
			f(
				"wei",
				"uint64",
				{ kind: "raw" },
				"Amount; must be a multiple of size. 0 = maximal for merges.",
			),
		],
		notes: "Payloads with non-zero unused fields are dropped.",
	},
];

const BY_ID = new Map(COREWRITER_ACTIONS.map((a) => [a.id, a]));
const BY_KEY = new Map(COREWRITER_ACTIONS.map((a) => [a.key, a]));

export function coreWriterActionById(
	id: number,
): CoreWriterActionSpec | undefined {
	return BY_ID.get(id);
}
export function coreWriterActionByKey(
	key: string,
): CoreWriterActionSpec | undefined {
	return BY_KEY.get(key);
}

/** Rules that cause CoreWriter actions to be dropped without an EVM revert. */
export const SILENT_REJECTION_RULES = [
	{
		id: "account-must-exist",
		title: "Sender must already exist on HyperCore",
		detail:
			"The contract (or EOA) calling CoreWriter must be a HyperCore user before the EVM block is built. An EVM → Core transfer that would create the account in the same block is processed first but still too late: the action is rejected.",
	},
	{
		id: "ordering",
		title: "Order within an L1 block",
		detail:
			"L1 block → EVM block → EVM→Core transfers → CoreWriter actions. Funds bridged from EVM in the same block are available to the action; Core→EVM transfers are only visible in the next EVM block.",
	},
	{
		id: "delay",
		title: "Orders and vault transfers are delayed",
		detail:
			"To remove any latency edge over the L1 mempool, limit orders and vault transfers from CoreWriter are enqueued and executed a few seconds later. They appear twice in the L1 explorer (enqueue, then execution). Market state can move in between.",
	},
	{
		id: "no-evm-revert",
		title: "HyperCore validation happens after the EVM transaction succeeds",
		detail:
			"The EVM transaction only emits a log. Insufficient margin, bad tick size, unknown asset or a non-zero unused field are rejected on HyperCore; the EVM receipt still says success.",
	},
] as const;
