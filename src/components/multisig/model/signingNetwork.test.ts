import { describe, expect, it } from "vitest";
import {
	SIGNING_CHAIN_HEX,
	SIGNING_CHAIN_ID,
	signingChainOf,
} from "./signingNetwork";

const HEAD = { signatureChainId: "0x3E6", hyperliquidChain: "Testnet" };

describe("the chain a wallet has to be on to sign an action", () => {
	it("is the one a readable action names for itself", () => {
		expect(
			signingChainOf({ type: "sendAsset", ...HEAD, destination: "0x1" }),
		).toEqual({ hex: "0x3e6", id: 998, label: "HyperEVM testnet (998)" });
		expect(
			signingChainOf({ type: "tokenDelegate", signatureChainId: "0xa4b1" }),
		).toEqual({ hex: "0xa4b1", id: 42161, label: "Arbitrum One (42161)" });
	});
	it("is the signing network for a code, whatever the action says", () => {
		expect([SIGNING_CHAIN_ID, SIGNING_CHAIN_HEX]).toEqual([1337, "0x539"]);
		const signing = {
			hex: "0x539",
			id: 1337,
			label: "the signing network (1337)",
		};
		expect(
			signingChainOf({
				type: "vaultTransfer",
				vaultAddress: "0x1",
				isDeposit: true,
				usd: 5_000_000,
			}),
		).toEqual(signing);
		// a field somebody added to it changes nothing: the code is signed under 1337
		expect(
			signingChainOf({ type: "vaultTransfer", signatureChainId: "0x3e6" }),
		).toEqual(signing);
		expect(signingChainOf({ type: "order", orders: [] })).toEqual(signing);
	});
	it("is unknown for a readable action that names none, and for an envelope", () => {
		expect(signingChainOf({ type: "sendAsset" })).toBeNull();
		expect(
			signingChainOf({ type: "usdSend", signatureChainId: "998" }),
		).toBeNull();
		expect(
			signingChainOf({ type: "multiSig", signatureChainId: "0x3e6" }),
		).toBeNull();
		expect(signingChainOf({})).toBeNull();
	});
});
