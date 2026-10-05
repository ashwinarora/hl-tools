import { defineRuleSet, docs } from "./meta.ts";

export const PRECOMPILE_RULES = defineRuleSet({
	id: "precompiles",
	title: "HyperEVM read precompiles",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"Read precompiles at 0x…0800 upwards return HyperCore state as of EVM block construction. Inputs and outputs are raw ABI (no function selector). Gas = 2000 + 65 × (input_len + output_len); invalid inputs revert and consume all gas passed. Perp prices divide by 10^(6 − szDecimals), spot prices by 10^(8 − base szDecimals).",
	sources: [
		docs(
			"for-developers/hyperevm/interacting-with-hypercore",
			"Interacting with HyperCore (L1Read.sol)",
		),
		{
			label: "hyper-evm-lib PrecompileLib.sol",
			url: "https://github.com/hyperliquid-dev/hyper-evm-lib/blob/main/src/PrecompileLib.sol",
		},
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-09-28",
			note: "0x800–0x813. Addresses and output layouts verified by live eth_call on mainnet and testnet.",
		},
	],
});

export type PrecompileParamKind =
	| "address"
	| "perp"
	| "spot"
	| "token"
	| "asset"
	| "dex";

export interface PrecompileParam {
	readonly name: string;
	readonly type: string;
	readonly kind: PrecompileParamKind;
	readonly description: string;
}

export interface PrecompileOutputField {
	readonly name: string;
	readonly type: string;
	/** How to present the raw integer. */
	readonly unit?:
		| "perpPx"
		| "spotPx"
		| "usd6"
		| "tokenWei"
		| "hypeWei"
		| "szi"
		| "bps"
		| "ms"
		| "timestampMs";
	readonly description?: string;
}

export interface PrecompileSpec {
	readonly key: string;
	readonly name: string;
	readonly address: `0x${string}`;
	readonly params: readonly PrecompileParam[];
	/** Output is either a single tuple (struct) or a dynamic array of tuples. */
	readonly output:
		| {
				readonly kind: "tuple";
				readonly fields: readonly PrecompileOutputField[];
		  }
		| {
				readonly kind: "array";
				readonly fields: readonly PrecompileOutputField[];
		  };
	readonly description: string;
}

const p = (
	name: string,
	type: string,
	kind: PrecompileParamKind,
	description: string,
): PrecompileParam => ({ name, type, kind, description });

export const PRECOMPILES: readonly PrecompileSpec[] = [
	{
		key: "position",
		name: "Perp position",
		address: "0x0000000000000000000000000000000000000800",
		params: [
			p("user", "address", "address", "Account address."),
			p("perp", "uint16", "perp", "Perp index on the first perp dex."),
		],
		output: {
			kind: "tuple",
			fields: [
				{
					name: "szi",
					type: "int64",
					unit: "szi",
					description: "Signed size in szDecimals units.",
				},
				{
					name: "entryNtl",
					type: "uint64",
					unit: "usd6",
					description: "Entry notional × 10^6.",
				},
				{ name: "isolatedRawUsd", type: "int64", unit: "usd6" },
				{ name: "leverage", type: "uint32" },
				{ name: "isIsolated", type: "bool" },
			],
		},
		description:
			"Position of `user` in perp `perp` (first perp dex only; use position2 for HIP-3).",
	},
	{
		key: "spotBalance",
		name: "Spot balance",
		address: "0x0000000000000000000000000000000000000801",
		params: [
			p("user", "address", "address", "Account address."),
			p("token", "uint64", "token", "Token index."),
		],
		output: {
			kind: "tuple",
			fields: [
				{ name: "total", type: "uint64", unit: "tokenWei" },
				{ name: "hold", type: "uint64", unit: "tokenWei" },
				{ name: "entryNtl", type: "uint64", unit: "usd6" },
			],
		},
		description:
			"Spot balance of `token` for `user`, in the token's weiDecimals.",
	},
	{
		key: "vaultEquity",
		name: "Vault equity",
		address: "0x0000000000000000000000000000000000000802",
		params: [
			p("user", "address", "address", "Depositor address."),
			p("vault", "address", "address", "Vault address."),
		],
		output: {
			kind: "tuple",
			fields: [
				{ name: "equity", type: "uint64", unit: "usd6" },
				{ name: "lockedUntilTimestamp", type: "uint64", unit: "timestampMs" },
			],
		},
		description: "Equity of `user` in `vault`.",
	},
	{
		key: "withdrawable",
		name: "Withdrawable",
		address: "0x0000000000000000000000000000000000000803",
		params: [p("user", "address", "address", "Account address.")],
		output: {
			kind: "tuple",
			fields: [{ name: "withdrawable", type: "uint64", unit: "usd6" }],
		},
		description: "Perp withdrawable USDC × 10^6.",
	},
	{
		key: "delegations",
		name: "Delegations",
		address: "0x0000000000000000000000000000000000000804",
		params: [p("user", "address", "address", "Delegator address.")],
		output: {
			kind: "array",
			fields: [
				{ name: "validator", type: "address" },
				{ name: "amount", type: "uint64", unit: "hypeWei" },
				{ name: "lockedUntilTimestamp", type: "uint64", unit: "timestampMs" },
			],
		},
		description: "Staking delegations of `user`.",
	},
	{
		key: "delegatorSummary",
		name: "Delegator summary",
		address: "0x0000000000000000000000000000000000000805",
		params: [p("user", "address", "address", "Delegator address.")],
		output: {
			kind: "tuple",
			fields: [
				{ name: "delegated", type: "uint64", unit: "hypeWei" },
				{ name: "undelegated", type: "uint64", unit: "hypeWei" },
				{ name: "totalPendingWithdrawal", type: "uint64", unit: "hypeWei" },
				{ name: "nPendingWithdrawals", type: "uint64" },
			],
		},
		description: "Staking summary of `user`.",
	},
	{
		key: "markPx",
		name: "Mark price",
		address: "0x0000000000000000000000000000000000000806",
		params: [p("perp", "uint32", "perp", "Perp index.")],
		output: {
			kind: "tuple",
			fields: [{ name: "markPx", type: "uint64", unit: "perpPx" }],
		},
		description: "Mark price; divide by 10^(6 − szDecimals).",
	},
	{
		key: "oraclePx",
		name: "Oracle price",
		address: "0x0000000000000000000000000000000000000807",
		params: [p("perp", "uint32", "perp", "Perp index.")],
		output: {
			kind: "tuple",
			fields: [{ name: "oraclePx", type: "uint64", unit: "perpPx" }],
		},
		description: "Oracle price; divide by 10^(6 − szDecimals).",
	},
	{
		key: "spotPx",
		name: "Spot price",
		address: "0x0000000000000000000000000000000000000808",
		params: [p("spot", "uint32", "spot", "Spot pair index.")],
		output: {
			kind: "tuple",
			fields: [{ name: "spotPx", type: "uint64", unit: "spotPx" }],
		},
		description: "Spot price; divide by 10^(8 − base szDecimals).",
	},
	{
		key: "l1BlockNumber",
		name: "L1 block number",
		address: "0x0000000000000000000000000000000000000809",
		params: [],
		output: {
			kind: "tuple",
			fields: [{ name: "l1BlockNumber", type: "uint64" }],
		},
		description: "HyperCore (L1) block height at EVM block construction.",
	},
	{
		key: "perpAssetInfo",
		name: "Perp asset info",
		address: "0x000000000000000000000000000000000000080a",
		params: [p("perp", "uint32", "perp", "Perp index.")],
		output: {
			kind: "tuple",
			fields: [
				{ name: "coin", type: "string" },
				{ name: "marginTableId", type: "uint32" },
				{ name: "szDecimals", type: "uint8" },
				{ name: "maxLeverage", type: "uint8" },
				{ name: "onlyIsolated", type: "bool" },
			],
		},
		description: "Static metadata of a perp.",
	},
	{
		key: "spotInfo",
		name: "Spot pair info",
		address: "0x000000000000000000000000000000000000080b",
		params: [p("spot", "uint32", "spot", "Spot pair index.")],
		output: {
			kind: "tuple",
			fields: [
				{ name: "name", type: "string" },
				{ name: "tokens", type: "uint64[2]" },
			],
		},
		description: "Name and [base, quote] token indexes of a spot pair.",
	},
	{
		key: "tokenInfo",
		name: "Token info",
		address: "0x000000000000000000000000000000000000080c",
		params: [p("token", "uint32", "token", "Token index.")],
		output: {
			kind: "tuple",
			fields: [
				{ name: "name", type: "string" },
				{ name: "spots", type: "uint64[]" },
				{ name: "deployerTradingFeeShare", type: "uint64" },
				{ name: "deployer", type: "address" },
				{ name: "evmContract", type: "address" },
				{ name: "szDecimals", type: "uint8" },
				{ name: "weiDecimals", type: "uint8" },
				{ name: "evmExtraWeiDecimals", type: "int8" },
			],
		},
		description: "Token metadata including linked EVM contract.",
	},
	{
		key: "tokenSupply",
		name: "Token supply",
		address: "0x000000000000000000000000000000000000080d",
		params: [p("token", "uint32", "token", "Token index.")],
		output: {
			kind: "tuple",
			fields: [
				{ name: "maxSupply", type: "uint64", unit: "tokenWei" },
				{ name: "totalSupply", type: "uint64", unit: "tokenWei" },
				{ name: "circulatingSupply", type: "uint64", unit: "tokenWei" },
				{ name: "futureEmissions", type: "uint64", unit: "tokenWei" },
				{ name: "nonCirculatingUserBalances", type: "(address,uint64)[]" },
			],
		},
		description: "Supply figures of a token.",
	},
	{
		key: "bbo",
		name: "Best bid/offer",
		address: "0x000000000000000000000000000000000000080e",
		params: [
			p(
				"asset",
				"uint32",
				"asset",
				"Action asset ID (perp index or 10000 + spot).",
			),
		],
		output: {
			kind: "tuple",
			fields: [
				{ name: "bid", type: "uint64", unit: "perpPx" },
				{ name: "ask", type: "uint64", unit: "perpPx" },
			],
		},
		description: "Top of book for an asset.",
	},
	{
		key: "accountMarginSummary",
		name: "Account margin summary",
		address: "0x000000000000000000000000000000000000080f",
		params: [
			p("perpDexIndex", "uint32", "dex", "Perp dex index (0 = first dex)."),
			p("user", "address", "address", "Account address."),
		],
		output: {
			kind: "tuple",
			fields: [
				{ name: "accountValue", type: "int64", unit: "usd6" },
				{ name: "marginUsed", type: "uint64", unit: "usd6" },
				{ name: "ntlPos", type: "uint64", unit: "usd6" },
				{ name: "rawUsd", type: "int64", unit: "usd6" },
			],
		},
		description: "Margin summary of `user` on a perp dex.",
	},
	{
		key: "coreUserExists",
		name: "Core user exists",
		address: "0x0000000000000000000000000000000000000810",
		params: [p("user", "address", "address", "Address to check.")],
		output: { kind: "tuple", fields: [{ name: "exists", type: "bool" }] },
		description:
			"Whether `user` exists on HyperCore — the precondition for CoreWriter actions.",
	},
	{
		key: "position2",
		name: "Perp position (multi-dex)",
		address: "0x0000000000000000000000000000000000000813",
		params: [
			p("user", "address", "address", "Account address."),
			p(
				"perp",
				"uint32",
				"asset",
				"Perp asset ID, including HIP-3 (100000 + dex×10000 + index).",
			),
		],
		output: {
			kind: "tuple",
			fields: [
				{ name: "szi", type: "int64", unit: "szi" },
				{ name: "entryNtl", type: "uint64", unit: "usd6" },
				{ name: "isolatedRawUsd", type: "int64", unit: "usd6" },
				{ name: "leverage", type: "uint32" },
				{ name: "isIsolated", type: "bool" },
			],
		},
		description: "Position of `user` in any perp including HIP-3 dexes.",
	},
];

const BY_ADDRESS = new Map(
	PRECOMPILES.map((pc) => [pc.address.toLowerCase(), pc]),
);
const BY_KEY = new Map(PRECOMPILES.map((pc) => [pc.key, pc]));

export function precompileByAddress(
	address: string,
): PrecompileSpec | undefined {
	return BY_ADDRESS.get(address.toLowerCase());
}
export function precompileByKey(key: string): PrecompileSpec | undefined {
	return BY_KEY.get(key);
}

export function precompileGas(inputLen: number, outputLen: number): number {
	return 2000 + 65 * (inputLen + outputLen);
}
