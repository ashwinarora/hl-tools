import { defineRuleSet, docs } from "./meta.ts";

export const HYPEREVM_RULES = defineRuleSet({
	id: "hyperevm-rpc",
	title: "HyperEVM JSON-RPC & timing",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"The default RPC (rpc.hyperliquid.xyz/evm) serves eth_call, eth_getCode, eth_getBalance, eth_getStorageAt, eth_getTransactionCount and eth_estimateGas at the latest block only; eth_getLogs allows up to 4 topics and 50 blocks per query. Custom methods: eth_bigBlockGasPrice, eth_usingBigBlocks, eth_getSystemTxsByBlockHash/Number. Dual blocks: 1 s / 3M gas small blocks and 1 min / 30M gas big blocks.",
	sources: [
		docs("for-developers/hyperevm/json-rpc", "JSON-RPC"),
		docs(
			"for-developers/hyperevm/dual-block-architecture",
			"Dual-block architecture",
		),
		docs("for-developers/hyperevm/interaction-timings", "Interaction timings"),
		docs("builder-tools/hyperevm-tools", "HyperEVM tools (RPC providers)"),
	],
	changelog: [
		{ version: "1.0.0", date: "2026-09-28", note: "Initial encoding." },
	],
});

export const DEFAULT_RPC_LIMITS = {
	getLogsMaxBlocks: 50,
	getLogsMaxTopics: 4,
	latestOnlyMethods: [
		"eth_call",
		"eth_estimateGas",
		"eth_getBalance",
		"eth_getCode",
		"eth_getStorageAt",
		"eth_getTransactionCount",
	],
	customMethods: [
		"eth_bigBlockGasPrice",
		"eth_usingBigBlocks",
		"eth_getSystemTxsByBlockHash",
		"eth_getSystemTxsByBlockNumber",
	],
	requestsPerMinute: 100,
	websocket: false,
} as const;

export const DUAL_BLOCKS = {
	small: { durationMs: 1000, gasLimit: 3_000_000 },
	big: { durationMs: 60_000, gasLimit: 30_000_000 },
	mempoolNextNonces: 8,
	mempoolPruneAfterMs: 24 * 60 * 60 * 1000,
} as const;

/** System addresses on HyperEVM. */
export const SYSTEM_ADDRESSES = {
	hype: "0x2222222222222222222222222222222222222222",
	coreWriter: "0x3333333333333333333333333333333333333333",
	/** Token system addresses are 0x20 followed by the big-endian token index. */
	tokenBase: "0x2000000000000000000000000000000000000000",
} as const;

/** 0x20…<index> system address for a HyperCore token index. */
export function tokenSystemAddress(tokenIndex: number): `0x${string}` {
	const hex = tokenIndex.toString(16).padStart(38, "0");
	return `0x20${hex}` as `0x${string}`;
}

export const PUBLIC_RPC_ENDPOINTS = [
	{
		label: "Hyperliquid (mainnet)",
		url: "https://rpc.hyperliquid.xyz/evm",
		network: "mainnet",
	},
	{
		label: "Hyperliquid (testnet)",
		url: "https://rpc.hyperliquid-testnet.xyz/evm",
		network: "testnet",
	},
] as const;
