// Real CoreWriter payloads and transactions used as samples. Payloads come
// from fixtures/corewriter/cases.json (RawAction logs on mainnet/testnet).
import type { Network } from "../network.ts";

export interface CoreWriterSample {
	readonly id: string;
	readonly label: string;
	readonly network: Network;
	/** Raw action bytes, if the sample is decodable on its own. */
	readonly hex: string | null;
	/** HyperEVM transaction that emitted it, if any. */
	readonly txHash: string | null;
	readonly description: string;
}

export const COREWRITER_SAMPLES: readonly CoreWriterSample[] = [
	{
		id: "limit-order",
		label: "Limit order (mainnet tx)",
		network: "mainnet",
		hex: "0x01000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000003e1927a180000000000000000000000000000000000000000000000000000000000007a1200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000001a0e798df33f294ce1e316c6981",
		txHash:
			"0x4b65b9ab3d57b40a29103541b725773012266f2ffd73507077360e9d7d64d949",
		description:
			"IOC buy 0.005 ETH at 2667.1 with a cloid, sent by a contract on mainnet.",
	},
	{
		id: "usd-class-transfer",
		label: "usdClassTransfer (mainnet tx)",
		network: "mainnet",
		hex: "0x0100000700000000000000000000000000000000000000000000000000000000009896800000000000000000000000000000000000000000000000000000000000000000",
		txHash:
			"0x38bab5bcaaafcef72b84e5b68ef4dabe79fde8f53a653982d93e78e3073b0fb3",
		description: "Move 10 USDC perp \u2192 spot.",
	},
	{
		id: "send-asset",
		label: "sendAsset from Circle's CoreDepositWallet (mainnet tx)",
		network: "mainnet",
		hex: "0x0100000d000000000000000000000000d3ef7eb6dedb7f4f1a570cd64f3780f23aa849eb000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffff0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003591d6300",
		txHash:
			"0x619a2634e7f30f5ccf313b1ca476b397d342e31cc8925cc0faaf62e9398b124f",
		description: "USDC bridged from HyperEVM credited on HyperCore.",
	},
	{
		id: "testnet-limit-order",
		label: "Limit order without cloid (testnet tx)",
		network: "testnet",
		hex: null,
		txHash:
			"0xde61c56af261d27e07c9ebe5825cb2972f3503207c0a518a1adcfdd1f23716c9",
		description:
			"A testnet order matched by inference because it has no cloid.",
	},
	{
		id: "testnet-cancel",
		label: "Cancel by oid (testnet tx)",
		network: "testnet",
		hex: "0x0100000a0000000000000000000000000000000000000000000000000000000000002b1b0000000000000000000000000000000000000000000000000000000e43ed28f0",
		txHash:
			"0x8d206482cca89fc130e0ccc5c18362a5c90f1ad2d89ed86536d22ec100ef6158",
		description: "Decodes, but tracing cancels isn't supported yet.",
	},
	{
		id: "unknown-version",
		label: "Unknown encoding version",
		network: "mainnet",
		hex: "0x0200000700000000000000000000000000000000000000000000000000000000009896800000000000000000000000000000000000000000000000000000000000000000",
		txHash: null,
		description: "Version byte 0x02: returned as unknown, never guessed.",
	},
];
