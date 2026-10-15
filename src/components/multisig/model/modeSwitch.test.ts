import { accountMode, type PlainObject } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { RECIPIENT, TREASURY } from "#/test/keys";
import {
	judgeSwitch,
	MODE_NAME,
	MODE_SWITCH,
	modeTargetOf,
	otherMode,
	type SwitchFacts,
} from "./modeSwitch";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

const MANUAL = accountMode("default");
const CHOSE_MANUAL = accountMode("disabled");
const UNIFIED = accountMode("unifiedAccount");
const facts = (over: Partial<SwitchFacts> = {}): SwitchFacts => ({
	mode: MANUAL,
	positions: 0,
	orders: 0,
	waiting: [],
	...over,
});
const USDC = "USDC:0xeb62eee3685fc4c43992febcd9e75443";
const usdSend: PlainObject = {
	type: "usdSend",
	destination: RECIPIENT,
	amount: "5",
	time: 1,
};
const fromSpot: PlainObject = {
	type: "sendAsset",
	destination: RECIPIENT,
	sourceDex: "spot",
	destinationDex: "spot",
	token: USDC,
	amount: "5",
	fromSubAccount: "",
	nonce: 1,
};
const fromPerps: PlainObject = { ...fromSpot, sourceDex: "" };

describe("which switch", () => {
	it("names each mode as Hyperliquid takes it", () => {
		expect(MODE_NAME).toEqual({
			unified: "unifiedAccount",
			manual: "disabled",
		});
		const set = (abstraction: unknown): PlainObject => ({
			type: "userSetAbstraction",
			user: TREASURY,
			abstraction: abstraction as string,
			nonce: 1,
		});
		expect(modeTargetOf(set("unifiedAccount"))).toBe("unified");
		expect(modeTargetOf(set("disabled"))).toBe("manual");
		// a mode with no measured switch, a letter, another action
		expect(modeTargetOf(set("portfolioMargin"))).toBeNull();
		expect(modeTargetOf(set("u"))).toBeNull();
		expect(modeTargetOf(set(7))).toBeNull();
		expect(
			modeTargetOf({ ...set("unifiedAccount"), type: "userDexAbstraction" }),
		).toBeNull();
	});

	it("offers the other of the two, and nothing for a mode it does not know", () => {
		expect(otherMode(MANUAL)).toBe("unified");
		expect(otherMode(CHOSE_MANUAL)).toBe("unified");
		expect(otherMode(UNIFIED)).toBe("manual");
		expect(otherMode(null)).toBeNull();
		expect(otherMode(undefined)).toBeNull();
		// taken from the docs, never tested: no switch is suggested
		expect(otherMode(accountMode("portfolioMargin"))).toBeNull();
		expect(otherMode(accountMode("dexAbstraction"))).toBeNull();
		expect(otherMode(accountMode("somethingNew"))).toBeNull();
	});
});

describe("judgeSwitch", () => {
	it("lets a switch to a unified account through with positions and orders open", () => {
		expect(judgeSwitch("unified", facts({ positions: 1, orders: 2 }))).toEqual({
			blocked: null,
			warnings: [],
		});
	});

	it("blocks a switch back to a manual account while anything is open", () => {
		const j = judgeSwitch(
			"manual",
			facts({ mode: UNIFIED, positions: 1, orders: 2 }),
		);
		expect(j.blocked).toBe(
			"Hyperliquid switches back to a manual account only when nothing is open, and this treasury has 1 open position and 2 open orders. Close them with an API wallet first.",
		);
		expect(
			judgeSwitch("manual", facts({ mode: UNIFIED, positions: 2, orders: 0 }))
				.blocked,
		).toContain("this treasury has 2 open positions. Close");
		expect(
			judgeSwitch("manual", facts({ mode: UNIFIED, positions: 0, orders: 1 }))
				.blocked,
		).toContain("this treasury has 1 open order. Close");
		// nothing open, or not read: nothing is assumed
		expect(judgeSwitch("manual", facts({ mode: UNIFIED })).blocked).toBeNull();
		expect(
			judgeSwitch(
				"manual",
				facts({ mode: UNIFIED, positions: null, orders: null }),
			).blocked,
		).toBeNull();
	});

	it("says in one line when the treasury is already in that mode, since Hyperliquid accepts it", () => {
		expect(judgeSwitch("manual", facts()).warnings).toEqual([
			"This treasury is already a manual account: Hyperliquid accepts this and nothing changes.",
		]);
		expect(judgeSwitch("unified", facts({ mode: UNIFIED })).warnings).toEqual([
			"This treasury is already a unified account: Hyperliquid accepts this and nothing changes.",
		]);
		expect(
			judgeSwitch("unified", facts({ mode: CHOSE_MANUAL })).warnings,
		).toEqual([]);
	});

	it("warns, and does not guess, when the mode is unread or one it was not tested with", () => {
		expect(judgeSwitch("unified", facts({ mode: null })).warnings).toEqual([
			"This treasury's account mode could not be read from Hyperliquid. If it is already a unified account, this changes nothing.",
		]);
		expect(
			judgeSwitch("unified", facts({ mode: accountMode("portfolioMargin") }))
				.warnings[0],
		).toContain('reports the mode "portfolioMargin"');
		// while it is on its way nothing is said
		expect(judgeSwitch("unified", facts({ mode: undefined })).warnings).toEqual(
			[],
		);
	});

	it("names the waiting proposals the new mode would refuse, in one line", () => {
		const waiting = [
			{ action: usdSend, title: "Pay the auditor" },
			{ action: fromPerps, title: "Send from perps" },
			// taken in either mode
			{ action: fromSpot, title: "Send from spot" },
			{ action: { type: "approveAgent" }, title: "Approve bot" },
		];
		expect(judgeSwitch("unified", facts({ waiting })).warnings).toEqual([
			"2 waiting proposals would be refused once this is carried out: “Pay the auditor”, “Send from perps”. Carry them out first, or propose them again afterwards.",
		]);
		expect(
			judgeSwitch("unified", facts({ waiting: waiting.slice(0, 1) }))
				.warnings[0],
		).toBe(
			"1 waiting proposal would be refused once this is carried out: “Pay the auditor”. Carry it out first, or propose it again afterwards.",
		);
		// a manual account refuses nothing a unified one takes
		expect(
			judgeSwitch("manual", facts({ mode: UNIFIED, waiting })).warnings,
		).toEqual([]);
		// what is refused already is not this switch's doing
		expect(
			judgeSwitch("unified", facts({ mode: UNIFIED, waiting })).warnings,
		).toEqual([
			"This treasury is already a unified account: Hyperliquid accepts this and nothing changes.",
		]);
	});

	it("says nothing the product does not provide", () => {
		const texts = [
			MODE_SWITCH.choose,
			MODE_SWITCH.changes.unified,
			MODE_SWITCH.changes.manual,
			MODE_SWITCH.now("unified account"),
			MODE_SWITCH.reading,
			...judgeSwitch("unified", facts({ mode: null })).warnings,
			judgeSwitch("manual", facts({ mode: UNIFIED, positions: 1 })).blocked ??
				"",
		];
		for (const text of texts)
			for (const pattern of FORBIDDEN_CLAIMS)
				expect(text, `${pattern}`).not.toMatch(pattern);
		expect(MODE_SWITCH.now("unified account")).toBe(
			"This treasury's mode now: unified account.",
		);
	});
});
