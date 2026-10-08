import { describe, expect, it } from "vitest";
import { describeWalletError } from "./walletErrors";

const named = (name: string, extra: object = {}) =>
	Object.assign(new Error(name), { name, ...extra });

describe("describeWalletError", () => {
	it("recognises a rejection by code, name, message and nested cause", () => {
		for (const e of [
			{ code: 4001, message: "nope" },
			named("UserRejectedRequestError"),
			new Error("User rejected the request."),
			new Error("MetaMask Tx Signature: User denied transaction signature."),
			named("TransactionExecutionError", { cause: { code: 4001 } }),
		])
			expect(describeWalletError(e)).toEqual({
				kind: "rejected",
				message: "You declined in the wallet.",
			});
	});

	it("names the chain when a switch is not possible", () => {
		const e = describeWalletError(
			named("SwitchChainNotSupportedError"),
			"HyperEVM testnet (998)",
		);
		expect(e.kind).toBe("switch-unsupported");
		expect(e.message).toContain(
			"Switch to HyperEVM testnet (998) in the wallet",
		);
		expect(
			describeWalletError(named("SwitchChainNotSupportedError")).message,
		).toContain("Switch in the wallet");
		const unknown = describeWalletError({ code: 4902 }, "HyperEVM (999)");
		expect(unknown.kind).toBe("chain-unknown");
		expect(unknown.message).toContain("(HyperEVM (999))");
		expect(describeWalletError(named("ChainNotConfiguredError")).kind).toBe(
			"chain-unknown",
		);
	});

	it("falls back to the short message, the message, or the value", () => {
		expect(
			describeWalletError(named("X", { shortMessage: "short one" })).message,
		).toBe("short one");
		expect(describeWalletError(new Error("long one"))).toEqual({
			kind: "other",
			message: "long one",
		});
		expect(describeWalletError({ message: "plain object" }).message).toBe(
			"plain object",
		);
		expect(describeWalletError("just text").message).toBe("just text");
		expect(describeWalletError(null).message).toBe("null");
	});
});
