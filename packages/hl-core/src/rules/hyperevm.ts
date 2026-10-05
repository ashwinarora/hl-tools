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

/**
 * How tokens cross between HyperEVM and HyperCore, and how a crossing shows
 * up (or doesn't) on the Core side.
 */
export const EVM_CORE_TRANSFER_RULES = defineRuleSet({
	id: "evm-core-transfers",
	title: "HyperEVM ↔ HyperCore transfers",
	version: "1.0.0",
	verifiedAt: "2026-10-05",
	summary:
		"EVM → Core: an ERC-20 Transfer(from, to, value) emitted by a token's linked contract with to = the token's system address (0x20…<token index>; HYPE is native, sent to 0x2222…2222) credits the from address on HyperCore with value ÷ 10^(weiDecimals + evmExtraWeiDecimals). The credit lands in the same L1 block, right after the EVM block, and appears in the recipient's userNonFundingLedgerUpdates as a spotTransfer whose user is the system address. A transfer HyperCore does not credit leaves no record on either side: the EVM receipt still says success. Core → EVM: sendAsset to the system address; a system transaction mints on the EVM in the next EVM block.",
	sources: [
		docs(
			"for-developers/hyperevm/hypercore-less-than-greater-than-hyperevm-transfers",
			"HyperCore <> HyperEVM transfers",
		),
		docs("for-developers/hyperevm/interaction-timings", "Interaction timings"),
		docs(
			"for-developers/api/info-endpoint",
			"Info endpoint (userNonFundingLedgerUpdates)",
		),
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-10-05",
			note: "Initial encoding, from tracing CoreDepositWallet.depositFor payouts on testnet: credited transfers appear 0.001–0.141 s after the block; dropped ones leave no ledger entry. Native HYPE sent to 0x2222…2222 emits no Transfer log and is not detected.",
		},
	],
});
