import { describe, expect, it } from "vitest";
import { amountIn } from "./headline";

const A = `0x${"4b".repeat(20)}`;

describe("the amount a sentence about an action names", () => {
	it("is the figure right after the verb, the words kept exactly", () => {
		expect(amountIn(`Send 1 USDC to ${A}`)).toEqual({
			before: "Send",
			figure: "1",
			unit: "USDC",
			after: `to ${A}`,
		});
		expect(
			amountIn(`Withdraw 1,250.5 USDC to ${A} on Arbitrum Sepolia`),
		).toMatchObject({ figure: "1,250.5", unit: "USDC" });
		expect(amountIn("Stake 100 HYPE with 0x946b…5b21")).toMatchObject({
			before: "Stake",
			figure: "100",
			unit: "HYPE",
		});
		// a summary that opens with its figure
		expect(amountIn("2.01 USDC in 1 vault")).toEqual({
			before: "",
			figure: "2.01",
			unit: "USDC",
			after: "in 1 vault",
		});
	});

	it("never takes a figure from words somebody else wrote", () => {
		// an API wallet's name is quoted, and moves no money
		expect(
			amountIn(`Approve API wallet ${A} named "pay 50 USDC daily"`),
		).toBeNull();
		expect(amountIn(`Approve API wallet named "pay 50 USDC daily"`)).toBeNull();
		// a validator's or a vault's own name, in curly quotes
		expect(amountIn("Stake with “Earn 500 HYPE now”")).toBeNull();
		// the action's own amount still counts when a quoted name follows it
		expect(
			amountIn("Stake 10 HYPE with “Earn 500 HYPE now” (0x946b…5b21)"),
		).toMatchObject({ figure: "10", unit: "HYPE" });
	});

	it("takes a figure as a pasted action writes it, and a token name in any case", () => {
		expect(amountIn(`Send .01 USDC (perps) to ${A}`)).toMatchObject({
			figure: ".01",
			unit: "USDC",
		});
		expect(amountIn(`Send +0.01 USDC to ${A}`)).toMatchObject({
			figure: "+0.01",
		});
		expect(amountIn(`Send 1 TestPascal1 to ${A}`)).toMatchObject({
			figure: "1",
			unit: "TestPascal1",
		});
		expect(amountIn(`Send 2 kHYPE to ${A}`)).toMatchObject({ unit: "kHYPE" });
		// a word after a figure is no unit
		expect(amountIn(`Send 5 to ${A}`)).toBeNull();
	});

	it("is not a figure deep in the sentence, or one without a unit", () => {
		expect(amountIn(`Remove the API wallet named bot 50 USDC`)).toBeNull();
		expect(amountIn("Change signers to 2 of 3")).toBeNull();
		expect(amountIn("Convert back to a normal user")).toBeNull();
	});
});
