import { describe, expect, it } from "vitest";
import {
	chainChoiceFor,
	chainIdToNumber,
	chainLabel,
	INNER_CHAINS,
	innerChain,
	knownChain,
	SIGNER_CHAINS,
} from "./chains";

describe("chains", () => {
	it("pairs every hex id with its number and viem chain", () => {
		expect(SIGNER_CHAINS.map((c) => [c.hex, c.id, c.chain.id])).toEqual([
			["0x3e7", 999, 999],
			["0x3e6", 998, 998],
			["0xa4b1", 42161, 42161],
			["0x66eee", 421614, 421614],
		]);
		for (const c of SIGNER_CHAINS) expect(chainIdToNumber(c.hex)).toBe(c.id);
		expect(innerChain("testnet", "hyperevm")).toBe(
			INNER_CHAINS.testnet.hyperevm,
		);
	});

	it("reads hex chain ids and refuses anything else", () => {
		expect(chainIdToNumber("0x3E6")).toBe(998);
		expect(chainIdToNumber("0x1")).toBe(1);
		for (const bad of ["998", "0x", "0xzz", "0x0", "", null, 998, undefined])
			expect(chainIdToNumber(bad)).toBeNull();
		expect(chainIdToNumber(`0x${"f".repeat(20)}`)).toBeNull();
	});

	it("labels known and unknown chains", () => {
		expect(chainLabel(998)).toBe("HyperEVM testnet (998)");
		expect(chainLabel(42161)).toBe("Arbitrum One (42161)");
		expect(chainLabel(1)).toBe("chain 1");
		expect(knownChain(999)?.label).toBe("HyperEVM");
		expect(knownChain(1)).toBeNull();
	});

	it("maps a stored id back to the offered choice on its network", () => {
		expect(chainChoiceFor("0x3e6", "testnet")).toBe("hyperevm");
		expect(chainChoiceFor("0x66EEE", "testnet")).toBe("arbitrum");
		expect(chainChoiceFor("0xa4b1", "mainnet")).toBe("arbitrum");
		expect(chainChoiceFor("0x3e7", "mainnet")).toBe("hyperevm");
		// a testnet id is not a choice on mainnet
		expect(chainChoiceFor("0x3e6", "mainnet")).toBeNull();
		expect(chainChoiceFor("0x1", "testnet")).toBeNull();
	});
});
