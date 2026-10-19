import { describeAction, type PlainObject } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	joinParts,
	labelledLine,
	type Part,
	part,
	partsText,
	say,
} from "./parts";

const A = `0x${"a".repeat(40)}`;
const who: Part = { text: "0xaaaa…aaaa", who: A };
const when: Part = { text: "2026-10-12 21:04 UTC", when: 1_791_839_040_000 };

describe("say", () => {
	it("builds a sentence from fixed text and parts, keeping what each part is", () => {
		expect(say`Withdrawn by ${who} until ${when}.`).toEqual([
			{ text: "Withdrawn by " },
			who,
			{ text: " until " },
			when,
			{ text: "." },
		]);
	});
	it("merges neighbouring plain text, and drops what is empty", () => {
		expect(say`a${"b"}c${""}d`).toEqual([{ text: "abcd" }]);
		expect(say`${who}`).toEqual([who]);
		expect(say``).toEqual([]);
	});
	it("splices a list of parts in, and never merges a strong or quiet part away", () => {
		const strong: Part = { text: "Send 1 USDC", strong: true };
		const quiet: Part = { text: " (title)", quiet: true };
		expect(
			say`${[strong, quiet]} was withdrawn${[part(" by "), who]}.`,
		).toEqual([
			strong,
			quiet,
			{ text: " was withdrawn by " },
			who,
			{ text: "." },
		]);
	});
	it("reads the same as the plain text, whatever a screen does with the parts", () => {
		expect(partsText(say`Withdrawn by ${who} until ${when}.`)).toBe(
			"Withdrawn by 0xaaaa…aaaa until 2026-10-12 21:04 UTC.",
		);
		expect(partsText([])).toBe("");
	});
});

describe("joinParts", () => {
	it("joins like Array.join", () => {
		expect(partsText(joinParts([[who], [part("you")], [who]], ", "))).toBe(
			"0xaaaa…aaaa, you, 0xaaaa…aaaa",
		);
		expect(joinParts([], ", ")).toEqual([]);
		expect(joinParts([[who]], ", ")).toEqual([who]);
	});
});

describe("labelledLine", () => {
	it("takes a field and its value apart", () => {
		expect(labelledLine("leverage: 5")).toEqual({
			label: "leverage",
			value: "5",
		});
		expect(labelledLine("91490942: buy 1 BTC at 60000")).toEqual({
			label: "91490942",
			value: "buy 1 BTC at 60000",
		});
	});
	it("never cuts a sentence at its colon", () => {
		for (const line of [
			"A vault deposit can lose value: the vault's leader trades with it.",
			"The bridge keeps 1 USDC of it as its fee: 4 USDC arrives.",
			"Dead man's switch: every open order is cancelled at that time unless rescheduled.",
			"No colon here.",
			": nothing before it",
		])
			expect(labelledLine(line)).toBeNull();
	});
	it("leaves every sentence the core writes about a guided action whole", () => {
		const treasury = `0x${"1".repeat(40)}`;
		const head = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
		const actions: PlainObject[] = [
			{ type: "vaultTransfer", vaultAddress: A, isDeposit: true, usd: 5e6 },
			{ type: "vaultTransfer", vaultAddress: A, isDeposit: false, usd: 5e6 },
			{
				type: "approveAgent",
				...head,
				agentAddress: A,
				agentName: "",
				nonce: 1,
			},
			{
				type: "approveAgent",
				...head,
				agentAddress: `0x${"0".repeat(40)}`,
				agentName: "",
				nonce: 1,
			},
			{
				type: "userSetAbstraction",
				...head,
				user: treasury,
				abstraction: "unifiedAccount",
				nonce: 1,
			},
			{
				type: "userSetAbstraction",
				...head,
				user: treasury,
				abstraction: "disabled",
				nonce: 1,
			},
			{ type: "withdraw3", ...head, destination: A, amount: "5", time: 1 },
		];
		for (const action of actions) {
			const { lines } = describeAction(action, { network: "testnet" });
			expect(lines.length).toBeGreaterThan(0);
			for (const line of lines) expect(labelledLine(line)).toBeNull();
		}
	});
});
