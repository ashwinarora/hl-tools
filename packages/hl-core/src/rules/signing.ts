import { defineRuleSet, docs, PYTHON_SDK } from "./meta.ts";

export const SIGNING_RULES = defineRuleSet({
	id: "signing",
	title: "Signing schemes",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"Two schemes. L1 actions: keccak256(msgpack(action) ‖ nonce(u64 BE) ‖ vault marker [‖ vault address] [‖ 0x00 ‖ expiresAfter(u64 BE)]) becomes `connectionId` of an EIP-712 `Agent{source,connectionId}` message in domain Exchange/1/chainId 1337. User-signed actions: the action fields themselves are an EIP-712 `HyperliquidTransaction:*` message in domain HyperliquidSignTransaction/1/chainId = signatureChainId. Nonces must be within (T − 2 days, T + 1 day) and unique among the signer's 100 highest.",
	sources: [
		docs("for-developers/api/signing", "Signing"),
		docs("for-developers/api/nonces-and-api-wallets", "Nonces and API wallets"),
		docs(
			"for-developers/api/exchange-endpoint",
			"Exchange endpoint (expiresAfter)",
		),
		PYTHON_SDK,
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-09-28",
			note: "L1 + 16 user-signed action types; vectors checked against hyperliquid-python-sdk 0.24.0.",
		},
	],
});

export const L1_DOMAIN = {
	name: "Exchange",
	version: "1",
	chainId: 1337,
	verifyingContract: "0x0000000000000000000000000000000000000000",
} as const;

export const L1_TYPES = {
	Agent: [
		{ name: "source", type: "string" },
		{ name: "connectionId", type: "bytes32" },
	],
} as const;

export const USER_SIGNED_DOMAIN_NAME = "HyperliquidSignTransaction";
export const DEFAULT_SIGNATURE_CHAIN_ID = "0x66eee";

export interface Eip712Field {
	readonly name: string;
	readonly type: string;
}

export interface UserSignedSpec {
	/** `type` field of the action. */
	readonly actionType: string;
	/** EIP-712 primary type. */
	readonly primaryType: string;
	readonly fields: readonly Eip712Field[];
	/** Field holding the nonce that must equal the outer request nonce. */
	readonly nonceField: "nonce" | "time";
	readonly description: string;
}

const HC = { name: "hyperliquidChain", type: "string" } as const;

function spec(
	actionType: string,
	primary: string,
	fields: Eip712Field[],
	description: string,
): UserSignedSpec {
	const nonceField = fields.some((f) => f.name === "time") ? "time" : "nonce";
	return {
		actionType,
		primaryType: `HyperliquidTransaction:${primary}`,
		fields: [HC, ...fields],
		nonceField,
		description,
	};
}

export const USER_SIGNED_SPECS: readonly UserSignedSpec[] = [
	spec(
		"usdSend",
		"UsdSend",
		[
			{ name: "destination", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "time", type: "uint64" },
		],
		"Send perp USDC to another address.",
	),
	spec(
		"spotSend",
		"SpotSend",
		[
			{ name: "destination", type: "string" },
			{ name: "token", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "time", type: "uint64" },
		],
		"Send a spot token to another address.",
	),
	spec(
		"withdraw3",
		"Withdraw",
		[
			{ name: "destination", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "time", type: "uint64" },
		],
		"Withdraw USDC to Arbitrum via the bridge.",
	),
	spec(
		"usdClassTransfer",
		"UsdClassTransfer",
		[
			{ name: "amount", type: "string" },
			{ name: "toPerp", type: "bool" },
			{ name: "nonce", type: "uint64" },
		],
		"Move USDC between the spot and perp balances.",
	),
	spec(
		"sendAsset",
		"SendAsset",
		[
			{ name: "destination", type: "string" },
			{ name: "sourceDex", type: "string" },
			{ name: "destinationDex", type: "string" },
			{ name: "token", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "fromSubAccount", type: "string" },
			{ name: "nonce", type: "uint64" },
		],
		"Move a token between dexes and/or accounts.",
	),
	spec(
		"approveAgent",
		"ApproveAgent",
		[
			{ name: "agentAddress", type: "address" },
			{ name: "agentName", type: "string" },
			{ name: "nonce", type: "uint64" },
		],
		"Approve an API (agent) wallet to sign L1 actions for this account.",
	),
	spec(
		"approveBuilderFee",
		"ApproveBuilderFee",
		[
			{ name: "maxFeeRate", type: "string" },
			{ name: "builder", type: "address" },
			{ name: "nonce", type: "uint64" },
		],
		"Approve a maximum builder fee rate for a builder address.",
	),
	spec(
		"tokenDelegate",
		"TokenDelegate",
		[
			{ name: "validator", type: "address" },
			{ name: "wei", type: "uint64" },
			{ name: "isUndelegate", type: "bool" },
			{ name: "nonce", type: "uint64" },
		],
		"Delegate or undelegate HYPE stake.",
	),
	spec(
		"cDeposit",
		"CDeposit",
		[
			{ name: "wei", type: "uint64" },
			{ name: "nonce", type: "uint64" },
		],
		"Move HYPE from spot into staking.",
	),
	spec(
		"cWithdraw",
		"CWithdraw",
		[
			{ name: "wei", type: "uint64" },
			{ name: "nonce", type: "uint64" },
		],
		"Move HYPE from staking back to spot.",
	),
	spec(
		"linkStakingUser",
		"LinkStakingUser",
		[
			{ name: "user", type: "address" },
			{ name: "isFinalize", type: "bool" },
			{ name: "nonce", type: "uint64" },
		],
		"Link a staking account to a trading account.",
	),
	spec(
		"sendToEvmWithData",
		"SendToEvmWithData",
		[
			{ name: "token", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "sourceDex", type: "string" },
			{ name: "destinationRecipient", type: "string" },
			{ name: "addressEncoding", type: "string" },
			{ name: "destinationChainId", type: "uint32" },
			{ name: "gasLimit", type: "uint64" },
			{ name: "data", type: "bytes" },
			{ name: "nonce", type: "uint64" },
		],
		"Send a token to HyperEVM with calldata.",
	),
	spec(
		"userDexAbstraction",
		"UserDexAbstraction",
		[
			{ name: "user", type: "address" },
			{ name: "enabled", type: "bool" },
			{ name: "nonce", type: "uint64" },
		],
		"Enable or disable HIP-3 dex abstraction.",
	),
	spec(
		"userSetAbstraction",
		"UserSetAbstraction",
		[
			{ name: "user", type: "address" },
			{ name: "abstraction", type: "string" },
			{ name: "nonce", type: "uint64" },
		],
		"Set the account abstraction mode.",
	),
	spec(
		"userPortfolioMargin",
		"UserPortfolioMargin",
		[
			{ name: "user", type: "address" },
			{ name: "enabled", type: "bool" },
			{ name: "nonce", type: "uint64" },
		],
		"Enable or disable portfolio margin.",
	),
	spec(
		"convertToMultiSigUser",
		"ConvertToMultiSigUser",
		[
			{ name: "signers", type: "string" },
			{ name: "nonce", type: "uint64" },
		],
		"Convert the account to a multi-sig user.",
	),
];

const BY_TYPE = new Map(USER_SIGNED_SPECS.map((s) => [s.actionType, s]));

export function userSignedSpec(actionType: string): UserSignedSpec | undefined {
	return BY_TYPE.get(actionType);
}

/** Action types that are out of scope for the inspector. */
export const MULTISIG_ACTION_TYPES = new Set(["multiSig"]);

/** Nonce validity window relative to the block timestamp T. */
export const NONCE_WINDOW = {
	pastMs: 2 * 24 * 60 * 60 * 1000,
	futureMs: 1 * 24 * 60 * 60 * 1000,
	storedHighest: 100,
} as const;

export type SigningFamily = "l1" | "user-signed" | "multisig";

export function signingFamilyFor(actionType: string): SigningFamily {
	if (MULTISIG_ACTION_TYPES.has(actionType)) return "multisig";
	return BY_TYPE.has(actionType) ? "user-signed" : "l1";
}
