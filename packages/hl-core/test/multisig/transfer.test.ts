import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	accountMode,
	activationCharge,
	explainExchangeError,
	landsIn,
	multiSigEvmRefusal,
	sendRefusal,
	sendShape,
	withdrawalFrom,
	withdrawalOutcome,
} from "../../src/multisig/index.ts";
import {
	isSystemAddress,
	SYSTEM_ADDRESSES,
	tokenSystemAddress,
} from "../../src/rules/hyperevm.ts";
import {
	ACCOUNT_MODES,
	MODE_KINDS,
	TRANSFER_RULES,
	WITHDRAWAL_FEE_USDC,
} from "../../src/rules/transfers.ts";

interface Change {
	perps: number;
	spotUsdc: number;
	spotHype: number;
}
interface Answer {
	status: string;
	response?: unknown;
}
const fixture = <T>(name: string): T =>
	JSON.parse(
		readFileSync(
			new URL(`../../fixtures/multisig/${name}.json`, import.meta.url),
			"utf8",
		),
	) as T;
const refusalOf = (a: Answer): string | null =>
	a.status === "err" ? explainExchangeError(a, 200).id : null;
/** The balance a pocket's change shows up in, for the token sent. */
const column = (pocket: unknown, token: string): keyof Change =>
	pocket === "perps" ? "perps" : token === "HYPE" ? "spotHype" : "spotUsdc";
const USDC = "USDC:0xeb62eee3685fc4c43992febcd9e75443";
const DEST = "0x00000000000000000000000000000000000000aa";
const asset = (
	sourceDex: string,
	destinationDex: string,
	amount = "5",
	token = USDC,
) => ({
	type: "sendAsset",
	destination: DEST,
	sourceDex,
	destinationDex,
	token,
	amount,
	fromSubAccount: "",
});
const usdSend = (amount = "5") => ({
	type: "usdSend",
	destination: DEST,
	amount,
});
const spotSend = (amount = "5", token = USDC) => ({
	type: "spotSend",
	destination: DEST,
	token,
	amount,
});

describe("accountMode", () => {
	it("reads what userAbstraction answers", () => {
		expect(accountMode("default")).toEqual({
			raw: "default",
			kind: "manual",
			verified: true,
		});
		expect(accountMode("disabled").kind).toBe("manual");
		expect(accountMode("unifiedAccount")).toEqual({
			raw: "unifiedAccount",
			kind: "unified",
			verified: true,
		});
		// taken from the docs, not measured
		expect(accountMode("portfolioMargin")).toEqual({
			raw: "portfolioMargin",
			kind: "unified",
			verified: false,
		});
		expect(accountMode("dexAbstraction")).toEqual({
			raw: "dexAbstraction",
			kind: "manual",
			verified: false,
		});
		expect(Object.keys(MODE_KINDS)).toEqual([...ACCOUNT_MODES]);
	});
	it("says so when it does not know the value", () => {
		for (const raw of ["somethingNew", "", null, undefined, 7, {}])
			expect(accountMode(raw).kind, String(raw)).toBe("unknown");
		expect(accountMode(7)).toEqual({
			raw: "",
			kind: "unknown",
			verified: false,
		});
	});
	it("belongs to a rule set with its sources", () => {
		expect(TRANSFER_RULES.id).toBe("transfers");
		expect(TRANSFER_RULES.sources.length).toBe(3);
	});
});

describe("sendShape", () => {
	it("names the pockets of each way of sending", () => {
		expect(sendShape(usdSend("1.5"))).toMatchObject({
			type: "usdSend",
			from: "perps",
			to: "perps",
			token: "USDC",
			destination: DEST,
		});
		expect(
			sendShape(spotSend("2", "HYPE:0x7317beb7cceed72ef0b346074cc8e7ab")),
		).toMatchObject({
			from: "spot",
			to: "spot",
			token: "HYPE",
		});
		expect(sendShape(asset("", "spot"))).toMatchObject({
			from: "perps",
			to: "spot",
			token: "USDC",
		});
		expect(sendShape(asset("spot", "xyz"))).toMatchObject({
			from: "spot",
			to: { dex: "xyz" },
		});
		expect(sendShape(usdSend("1.5"))?.amount?.toString()).toBe("1.5");
	});
	it("treats a move between the account's own balances as a send to nobody", () => {
		expect(
			sendShape({ type: "usdClassTransfer", amount: "3", toPerp: true }),
		).toMatchObject({ from: "spot", to: "perps", destination: null });
		expect(
			sendShape({ type: "usdClassTransfer", amount: "3", toPerp: false }),
		).toMatchObject({ from: "perps", to: "spot", destination: null });
	});
	it("lowercases the destination and tolerates missing fields", () => {
		expect(
			sendShape({
				type: "usdSend",
				destination: DEST.toUpperCase().replace("0X", "0x"),
			})?.destination,
		).toBe(DEST);
		expect(sendShape({ type: "sendAsset" })).toMatchObject({
			from: "perps",
			to: "perps",
			token: "",
			destination: "",
			amount: null,
		});
		expect(sendShape({ type: "spotSend", amount: "abc" })?.amount).toBeNull();
	});
	it("is null for what does not move money between Hyperliquid balances", () => {
		for (const v of [
			null,
			undefined,
			"usdSend",
			[],
			{},
			{ type: "withdraw3", destination: DEST, amount: "5" },
			{ type: "approveAgent" },
			{ type: 5 },
		])
			expect(sendShape(v)).toBeNull();
	});
});

interface ModeSend {
	about: string;
	senderMode: string;
	senderIs: string;
	receiverMode: string;
	toItself: boolean;
	action: Record<string, unknown>;
	answer: Answer;
	senderChange: Change;
	receiverChange: Change;
}
const modes = fixture<{
	sends: ModeSend[];
	switches: {
		from: string;
		to: string;
		reported: string;
		before: { perps: number; spotUsdc: number };
		after: { perps: number; spotUsdc: number };
	}[];
}>("send-modes");

describe("the mode matrix: every recorded send, and what the rules say to it", () => {
	it("covers three sender modes, three receiver modes and six ways of sending, plain and through a multi-sig", () => {
		const matrix = modes.sends.filter(
			(s) => s.about === "sender mode × receiver mode",
		);
		expect(matrix).toHaveLength(54);
		expect(new Set(matrix.map((s) => s.senderMode))).toEqual(
			new Set(["default", "disabled", "unifiedAccount"]),
		);
		expect(new Set(matrix.map((s) => s.receiverMode))).toEqual(
			new Set(["default", "disabled", "unifiedAccount"]),
		);
		expect(modes.sends.some((s) => s.senderIs === "multi-sig")).toBe(true);
	});
	it.each(
		modes.sends.map(
			(s, i) =>
				[
					`${i + 1} · ${s.senderIs} ${s.senderMode} → ${s.toItself ? "itself" : s.receiverMode} · ${s.action.type}${s.action.type === "sendAsset" ? ` "${s.action.sourceDex}"→"${s.action.destinationDex}"` : ""} ${String(s.action.token ?? "USDC").split(":")[0]}`,
					s,
				] as const,
		),
	)("%s", (_name, s) => {
		const sender = accountMode(s.senderMode);
		const receiver = accountMode(s.toItself ? s.senderMode : s.receiverMode);
		// the refusal, or none, is the one the sender's mode predicts
		expect(refusalOf(s.answer)).toBe(sendRefusal(sender, s.action));
		if (s.answer.status !== "ok") {
			expect(s.senderChange).toEqual({ perps: 0, spotUsdc: 0, spotHype: 0 });
			return;
		}
		const shape = sendShape(s.action);
		if (!shape) throw new Error("not a send");
		const amount = Number(s.action.amount);
		const lands = landsIn(receiver, s.action);
		const out = column(shape.from, shape.token);
		const into = column(lands === "balance" ? "spot" : lands, shape.token);
		if (s.toItself) {
			// one account: a unified one has a single balance, so nothing moves
			const moved = sender.kind === "unified" ? 0 : amount;
			expect(s.senderChange[out]).toBeCloseTo(-moved, 6);
			expect(s.senderChange[into]).toBeCloseTo(moved, 6);
			return;
		}
		expect(s.senderChange[out]).toBeCloseTo(-amount, 6);
		expect(s.receiverChange[into]).toBeCloseTo(amount, 6);
		// and nowhere else
		const total = (c: Change) => c.perps + c.spotUsdc + c.spotHype;
		expect(total(s.senderChange)).toBeCloseTo(-amount, 6);
		expect(total(s.receiverChange)).toBeCloseTo(amount, 6);
	});
	it("the receiver's mode never changed the answer: the same send got the same answer to all three", () => {
		const answers = new Map<string, Set<string>>();
		const receivers = new Map<string, Set<string>>();
		for (const s of modes.sends.filter(
			(x) => x.about === "sender mode × receiver mode",
		)) {
			const key = `${s.senderMode} ${s.action.type} ${s.action.sourceDex}→${s.action.destinationDex}`;
			answers.set(
				key,
				(answers.get(key) ?? new Set()).add(refusalOf(s.answer) ?? "ok"),
			);
			receivers.set(key, (receivers.get(key) ?? new Set()).add(s.receiverMode));
		}
		expect(answers.size).toBe(18);
		for (const [key, seen] of answers) {
			expect(receivers.get(key)?.size, key).toBe(3);
			expect(seen.size, key).toBe(1);
		}
	});
	it("switching to unified moves the perps USDC into the one balance, and switching back leaves it in spot", () => {
		const into = modes.switches.filter(
			(s) => s.to === "unifiedAccount" && s.before.perps > 0,
		);
		expect(into.length).toBeGreaterThanOrEqual(1);
		for (const s of into) {
			expect(s.after.perps).toBe(0);
			expect(s.after.spotUsdc).toBeCloseTo(
				s.before.perps + s.before.spotUsdc,
				6,
			);
		}
		for (const s of modes.switches.filter((x) => x.from === "unifiedAccount")) {
			expect(s.after).toEqual(s.before);
		}
		for (const s of modes.switches) expect(s.reported).toBe(s.to);
	});
});

describe("sends of an account to itself, as testnet answered them", () => {
	interface SelfSend {
		about: string;
		senderMode: string;
		senderIs: string;
		account: string;
		action: Record<string, unknown>;
		answer: Answer;
	}
	const self = fixture<{ sends: SelfSend[] }>("self-send");
	it("covers a plain account, a manual multi-sig and a unified one", () => {
		expect(self.sends).toHaveLength(8);
		expect(
			new Set(self.sends.map((s) => `${s.senderIs} ${s.senderMode}`)),
		).toEqual(
			new Set([
				"plain default",
				"multi-sig default",
				"multi-sig unifiedAccount",
			]),
		);
		for (const s of self.sends) expect(s.action.destination).toBe(s.account);
	});
	it.each(
		self.sends.map(
			(s) => [`${s.senderIs} ${s.senderMode} · ${s.about}`, s] as const,
		),
	)("%s", (_name, s) => {
		expect(refusalOf(s.answer)).toBe(
			sendRefusal(accountMode(s.senderMode), s.action, s.account),
		);
	});
	it("is asked only when the sender is given, and reads its address in any case", () => {
		const me = "0x00000000000000000000000000000000000000BB";
		const manual = accountMode("default");
		const toMe = { ...asset("", ""), destination: me.toLowerCase() };
		expect(sendRefusal(manual, toMe)).toBeNull();
		expect(sendRefusal(manual, toMe, me)).toBe("send-invalid");
		expect(
			sendRefusal(
				manual,
				{ ...asset("xyz", "xyz"), destination: me.toLowerCase() },
				me,
			),
		).toBe("send-invalid");
		expect(
			sendRefusal(
				manual,
				{ ...asset("xyz", "abc"), destination: me.toLowerCase() },
				me,
			),
		).toBeNull();
		expect(
			sendRefusal(
				manual,
				{ ...asset("", "spot"), destination: me.toLowerCase() },
				me,
			),
		).toBeNull();
		expect(
			sendRefusal(manual, { ...usdSend(), destination: me.toLowerCase() }, me),
		).toBe("self-transfer");
		expect(
			sendRefusal(manual, { ...spotSend(), destination: me.toLowerCase() }, me),
		).toBe("self-transfer");
		// somebody else: nothing to say
		expect(sendRefusal(manual, asset("", ""), me)).toBeNull();
		// a move between the account's own balances has no destination at all
		expect(
			sendRefusal(
				manual,
				{ type: "usdClassTransfer", amount: "1", toPerp: true },
				me,
			),
		).toBeNull();
		// the mode's own refusal comes first
		expect(
			sendRefusal(
				accountMode("unifiedAccount"),
				{ ...usdSend(), destination: me.toLowerCase() },
				me,
			),
		).toBe("unified-disabled");
	});
});

describe("sendRefusal", () => {
	const unified = accountMode("unifiedAccount");
	const manual = accountMode("default");
	it("a unified account sends only with sendAsset from spot", () => {
		expect(sendRefusal(unified, usdSend())).toBe("unified-disabled");
		expect(sendRefusal(unified, spotSend())).toBe("unified-disabled");
		expect(
			sendRefusal(unified, {
				type: "usdClassTransfer",
				amount: "1",
				toPerp: true,
			}),
		).toBe("unified-disabled");
		expect(sendRefusal(unified, asset("", ""))).toBe("unified-spot-only");
		expect(sendRefusal(unified, asset("xyz", "spot"))).toBe(
			"unified-spot-only",
		);
		expect(sendRefusal(unified, asset("spot", "spot"))).toBeNull();
		expect(sendRefusal(unified, asset("spot", ""))).toBeNull();
	});
	it("treats portfolio margin like unified, and an unknown mode like nothing is known", () => {
		expect(sendRefusal(accountMode("portfolioMargin"), usdSend())).toBe(
			"unified-disabled",
		);
		expect(sendRefusal(accountMode("who knows"), usdSend())).toBeNull();
	});
	it("a manual account can use every way", () => {
		for (const a of [
			usdSend(),
			spotSend(),
			asset("", ""),
			asset("", "spot"),
			asset("spot", "spot"),
			asset("spot", ""),
			{ type: "usdClassTransfer", amount: "1", toPerp: false },
		])
			expect(sendRefusal(manual, a), JSON.stringify(a)).toBeNull();
	});
	it("only the collateral goes into or out of perps, whatever the mode", () => {
		const hype = "HYPE:0x7317beb7cceed72ef0b346074cc8e7ab";
		expect(sendRefusal(manual, asset("spot", "", "1", hype))).toBe(
			"token-invalid",
		);
		expect(sendRefusal(manual, asset("", "spot", "1", hype))).toBe(
			"token-invalid",
		);
		expect(sendRefusal(unified, asset("spot", "", "1", hype))).toBe(
			"token-invalid",
		);
		expect(sendRefusal(manual, asset("spot", "spot", "1", hype))).toBeNull();
		expect(sendRefusal(manual, spotSend("1", hype))).toBeNull();
	});
	it("has nothing to say about what is not a send", () => {
		expect(sendRefusal(unified, { type: "approveAgent" })).toBeNull();
		expect(sendRefusal(unified, null)).toBeNull();
	});
});

describe("landsIn", () => {
	it("is the pocket named for a manual receiver, and the one balance for a unified one", () => {
		expect(landsIn(accountMode("default"), usdSend())).toBe("perps");
		expect(landsIn(accountMode("disabled"), asset("", "spot"))).toBe("spot");
		expect(landsIn(accountMode("unifiedAccount"), usdSend())).toBe("balance");
		expect(landsIn(accountMode("unifiedAccount"), asset("spot", "spot"))).toBe(
			"balance",
		);
		expect(landsIn(accountMode("unknown?"), spotSend())).toBe("spot");
	});
	it("keeps another perp dex as it is named, and is null for what sends nothing", () => {
		expect(
			landsIn(accountMode("unifiedAccount"), asset("spot", "xyz")),
		).toEqual({
			dex: "xyz",
		});
		expect(landsIn(accountMode("default"), { type: "noop" })).toBeNull();
	});
});

interface FeeSend {
	about: string;
	senderMode: string;
	senderIs: string;
	action: Record<string, unknown>;
	receiverWas: "never used" | "in use";
	senderHeld: { perps: number; spotUsdc: number } | null;
	answer: Answer;
	senderChange: Change;
	receiverChange: Change;
	ledgerFee: string | null;
}
const fees = fixture<{ sends: FeeSend[] }>("activation-fee");

describe("the activation fee: every recorded send, and what the rule says to it", () => {
	it("covers every method to a new address, a unified sender, a multi-sig, and addresses in use", () => {
		const fresh = fees.sends.filter((s) => s.receiverWas === "never used");
		expect(fresh.length).toBeGreaterThanOrEqual(20);
		expect(new Set(fresh.map((s) => s.action.type))).toEqual(
			new Set(["usdSend", "spotSend", "sendAsset"]),
		);
		expect(fresh.some((s) => s.senderMode === "unifiedAccount")).toBe(true);
		expect(fresh.some((s) => s.senderIs === "multi-sig")).toBe(true);
		expect(
			fees.sends.filter((s) => s.receiverWas === "in use").length,
		).toBeGreaterThanOrEqual(25);
	});
	it.each(
		fees.sends.map(
			(s, i) =>
				[
					`${i + 1} · ${s.about} · ${s.action.type}${s.action.type === "sendAsset" ? ` "${s.action.sourceDex}"→"${s.action.destinationDex}"` : ""} ${s.action.amount} ${String(s.action.token ?? "USDC").split(":")[0]}`,
					s,
				] as const,
		),
	)("%s", (_name, s) => {
		const charge = activationCharge({
			action: s.action,
			receiverNew: s.receiverWas === "never used",
			spotUsdc: s.senderHeld ? String(s.senderHeld.spotUsdc) : null,
			perpsUsdc: s.senderHeld ? String(s.senderHeld.perps) : null,
		});
		expect(refusalOf(s.answer)).toBe(charge.refusal);
		if (s.answer.status !== "ok") {
			expect(s.senderChange).toEqual({ perps: 0, spotUsdc: 0, spotHype: 0 });
			return;
		}
		const shape = sendShape(s.action);
		if (!shape) throw new Error("not a send");
		const amount = Number(s.action.amount);
		const fee = Number(charge.fee);
		// the ledger agrees on whether a fee was taken
		if (s.ledgerFee !== null) expect(Number(s.ledgerFee)).toBe(fee);
		// the receiver: a new account is in default mode, so the pocket named
		const into = column(shape.to, shape.token);
		expect(Number(charge.receiverGets?.toString())).toBeCloseTo(
			s.receiverChange[into],
			6,
		);
		// the sender: the amount from its pocket, and the fee from the balance the rule names
		const expected: Change = { perps: 0, spotUsdc: 0, spotHype: 0 };
		expected[column(shape.from, shape.token)] -= amount;
		if (charge.paidFrom === "spot") expected.spotUsdc -= fee;
		if (charge.paidFrom === "perps") expected.perps -= fee;
		for (const k of ["perps", "spotUsdc", "spotHype"] as const)
			expect(s.senderChange[k], k).toBeCloseTo(expected[k], 6);
		// a usdSend pays out of the amount: the receiver is the one who gets less
		if (charge.paidFrom === "amount")
			expect(s.receiverChange[into]).toBeCloseTo(amount - fee, 6);
	});
	it("nothing at all was charged for a send to an address in use", () => {
		for (const s of fees.sends.filter((x) => x.receiverWas === "in use")) {
			expect(s.answer.status).toBe("ok");
			expect(s.ledgerFee === null ? 0 : Number(s.ledgerFee)).toBe(0);
			const total = (c: Change) => c.perps + c.spotUsdc + c.spotHype;
			expect(total(s.senderChange) + total(s.receiverChange)).toBeCloseTo(0, 6);
		}
	});
});

describe("activationCharge", () => {
	const fresh = { receiverNew: true, spotUsdc: "10", perpsUsdc: "10" };
	it("is nothing for an address in use, for a move inside the account, and for what is not a send", () => {
		expect(
			activationCharge({ ...fresh, receiverNew: false, action: usdSend() }),
		).toMatchObject({
			fee: "0",
			paidFrom: null,
			refusal: null,
		});
		expect(
			activationCharge({
				...fresh,
				action: { type: "usdClassTransfer", amount: "3", toPerp: true },
			}).fee,
		).toBe("0");
		const none = activationCharge({ ...fresh, action: { type: "noop" } });
		expect(none).toEqual({
			fee: "0",
			paidFrom: null,
			receiverGets: null,
			refusal: null,
		});
	});
	it("a usdSend pays out of the amount, so it has to be more than the fee", () => {
		const five = activationCharge({ ...fresh, action: usdSend("5") });
		expect(five).toMatchObject({ fee: "1", paidFrom: "amount", refusal: null });
		expect(five.receiverGets?.toString()).toBe("4");
		for (const amount of ["1", "0.5"])
			expect(
				activationCharge({ ...fresh, action: usdSend(amount) }),
			).toMatchObject({
				paidFrom: "amount",
				receiverGets: null,
				refusal: "transfer-below-fee",
			});
		// an amount that cannot be read: nothing is claimed
		expect(
			activationCharge({ ...fresh, action: usdSend("abc") }),
		).toMatchObject({
			receiverGets: null,
			refusal: null,
		});
	});
	it("the others pay on top: from spot when what is left there covers it, else from perps", () => {
		const of = (action: unknown, spotUsdc: string, perpsUsdc: string) =>
			activationCharge({ action, receiverNew: true, spotUsdc, perpsUsdc });
		expect(of(asset("", ""), "5", "10")).toMatchObject({
			fee: "1",
			paidFrom: "spot",
		});
		expect(of(asset("", ""), "0.2", "10").paidFrom).toBe("perps");
		expect(of(asset("spot", "spot", "2"), "3", "0").paidFrom).toBe("spot");
		expect(of(asset("spot", "spot", "2"), "2.5", "10").paidFrom).toBe("perps");
		expect(of(spotSend("2"), "2.5", "10").paidFrom).toBe("perps");
		expect(of(asset("", "", "5"), "0.2", "5.5")).toMatchObject({
			paidFrom: null,
			refusal: "transfer-gas",
		});
		expect(of(asset("", "", "5"), "0.2", "6").paidFrom).toBe("perps");
		// another token: the amount is not taken from USDC, the fee still is
		const hype = "HYPE:0x7317beb7cceed72ef0b346074cc8e7ab";
		expect(of(spotSend("3", hype), "1", "0").paidFrom).toBe("spot");
		expect(of(spotSend("3", hype), "0.9", "1").paidFrom).toBe("perps");
		expect(of(asset("spot", "spot", "3", hype), "0", "0").refusal).toBe(
			"transfer-gas",
		);
		expect(
			of(asset("spot", "spot", "2"), "3", "0").receiverGets?.toString(),
		).toBe("2");
	});
	it("says it cannot tell which balance pays when a balance or the amount is not known", () => {
		for (const input of [
			{ action: asset("", ""), spotUsdc: null, perpsUsdc: "5" },
			{ action: asset("", ""), spotUsdc: "5", perpsUsdc: null },
			{ action: asset("", ""), spotUsdc: "x", perpsUsdc: "5" },
			{ action: asset("", "", "abc"), spotUsdc: "5", perpsUsdc: "5" },
		])
			expect(activationCharge({ ...input, receiverNew: true })).toMatchObject({
				fee: "1",
				paidFrom: "unknown",
				refusal: null,
			});
	});
});

describe("withdrawalFrom: the balance a bridge withdrawal is taken from", () => {
	const recorded = fixture<{
		mode: string;
		action: { amount: string };
		answer: { status: string };
		before: { perpsWithdrawable: string; spotUsdc: string };
		after: { perpsWithdrawable: string; spotUsdc: string };
		ledger: { usdc: string; fee: string; nonce: number };
	}>("unified-withdrawal");

	it("takes a unified account's out of its one balance, as measured on mainnet", () => {
		expect(withdrawalFrom(accountMode(recorded.mode))).toBe("balance");
		expect(recorded.answer.status).toBe("ok");
		const left = (k: "perpsWithdrawable" | "spotUsdc") =>
			Number(recorded.before[k]) - Number(recorded.after[k]);
		// the whole amount, the fee within it, left spot; nothing left perps
		expect(left("spotUsdc")).toBe(Number(recorded.action.amount));
		expect(left("perpsWithdrawable")).toBe(0);
	});

	it("takes a manual account's out of perps, and so any mode with no rule", () => {
		for (const raw of ["default", "disabled", "somethingNew"])
			expect(withdrawalFrom(accountMode(raw))).toBe("perps");
		expect(withdrawalFrom(null)).toBe("perps");
	});

	it("records what arrives and the fee, which add up to what was asked", () => {
		const { usdc, fee } = recorded.ledger;
		expect(Number(usdc) + Number(fee)).toBe(Number(recorded.action.amount));
		expect(
			withdrawalOutcome({
				type: "withdraw3",
				amount: "2",
			})?.arrives?.toString(),
		).toBe(String(Number(usdc)));
	});
});

describe("withdrawalOutcome", () => {
	const withdraw = (amount: unknown) => ({
		type: "withdraw3",
		destination: "0x00000000000000000000000000000000000000aa",
		amount,
		time: 1,
	});

	it("delivers the amount less the bridge's 1 USDC, as seen on mainnet and testnet", () => {
		// 2 withdrawn through a multi-sig, 1 arrived on Arbitrum (2026-10-12)
		const two = withdrawalOutcome(withdraw("2"));
		expect(two?.refusal).toBeNull();
		expect(two?.arrives?.toString()).toBe("1");
		expect(withdrawalOutcome(withdraw("12.5"))?.arrives?.toString()).toBe(
			"11.5",
		);
		expect(withdrawalOutcome(withdraw("1.000001"))?.arrives?.toString()).toBe(
			"0.000001",
		);
	});

	it("is refused when the amount is not more than the fee", () => {
		// exactly the fee was answered "Withdrawal is smaller than fee." on testnet
		expect(withdrawalOutcome(withdraw("1"))).toEqual({
			arrives: null,
			refusal: "withdrawal-below-fee",
		});
		expect(withdrawalOutcome(withdraw("1.0"))?.refusal).toBe(
			"withdrawal-below-fee",
		);
		expect(withdrawalOutcome(withdraw("0.5"))?.refusal).toBe(
			"withdrawal-below-fee",
		);
		expect(WITHDRAWAL_FEE_USDC).toBe("1");
	});

	it("says nothing about what is not a withdrawal with a readable amount", () => {
		expect(withdrawalOutcome(withdraw(""))).toBeNull();
		expect(withdrawalOutcome(withdraw("abc"))).toBeNull();
		expect(withdrawalOutcome(withdraw(2))).toBeNull();
		expect(
			withdrawalOutcome({ type: "usdSend", amount: "2", destination: "0x" }),
		).toBeNull();
		expect(withdrawalOutcome(null)).toBeNull();
		expect(withdrawalOutcome("withdraw3")).toBeNull();
	});
});

describe("a send to HyperEVM from a multi-sig (fixtures/multisig/evm-transfer.json)", () => {
	interface EvmSend {
		about: string;
		action: Record<string, unknown>;
		answer: string;
	}
	const evm = fixture<{
		tokens: Record<string, { index: number; system: string }>;
		sends: EvmSend[];
	}>("evm-transfer");
	const own = (action: Record<string, unknown>): string =>
		evm.tokens[String(action.token).replace(/:.*$/, "")]?.system ?? "";

	it("covers both ways of sending, the token's own system address and another token's", () => {
		expect(evm.sends).toHaveLength(7);
		expect(new Set(evm.sends.map((s) => s.action.type))).toEqual(
			new Set(["spotSend", "sendAsset"]),
		);
		expect(evm.tokens.HYPE?.system).toBe(SYSTEM_ADDRESSES.hype);
		expect(evm.tokens.USDC?.system).toBe(tokenSystemAddress(0));
	});

	it.each(
		evm.sends.map((s) => [s.about, s] as const),
	)("%s: refused, and known to be before it is sent", (_name, s) => {
		expect(multiSigEvmRefusal(s.action)).toBe("evm-multisig");
		// the answer is in the catalogue: the multi-sig one at the token's own address, the other elsewhere
		expect(
			explainExchangeError({ status: "err", response: s.answer }, 200).id,
		).toBe(
			s.action.destination === own(s.action)
				? "evm-multisig"
				: "evm-unconfigured",
		);
	});

	it("says nothing about a send to an account, or about what sends nothing", () => {
		expect(multiSigEvmRefusal(asset("spot", "spot"))).toBeNull();
		expect(multiSigEvmRefusal(usdSend())).toBeNull();
		// perps USDC to USDC's system address: not measured for usdSend, taken to be refused the same way
		expect(
			multiSigEvmRefusal({
				...usdSend(),
				destination: SYSTEM_ADDRESSES.tokenBase,
			}),
		).toBe("evm-multisig");
		expect(
			multiSigEvmRefusal({
				type: "usdClassTransfer",
				amount: "5",
				toPerp: true,
			}),
		).toBeNull();
		expect(
			multiSigEvmRefusal({
				type: "withdraw3",
				destination: SYSTEM_ADDRESSES.hype,
				amount: "5",
			}),
		).toBeNull();
		expect(multiSigEvmRefusal(null)).toBeNull();
	});

	it("knows a system address from an address that only begins like one", () => {
		expect(isSystemAddress(SYSTEM_ADDRESSES.hype)).toBe(true);
		expect(
			isSystemAddress(SYSTEM_ADDRESSES.hype.toUpperCase().replace("0X", "0x")),
		).toBe(true);
		expect(isSystemAddress(tokenSystemAddress(0))).toBe(true);
		// a token index above 255: HYPE on testnet is 1105
		expect(isSystemAddress(tokenSystemAddress(1105))).toBe(true);
		expect(isSystemAddress("0x2000000000000000000000000000000000000451")).toBe(
			true,
		);
		expect(isSystemAddress(tokenSystemAddress(0xffffffff))).toBe(true);
		// an account whose address begins with 0x20
		expect(isSystemAddress("0x20a5b6f2154b4836de8c8b80fb90feacc236bd07")).toBe(
			false,
		);
		expect(isSystemAddress("0x2000000000000000000000000000000100000000")).toBe(
			false,
		);
		// CoreWriter's address is not a token's
		expect(isSystemAddress(SYSTEM_ADDRESSES.coreWriter)).toBe(false);
		expect(isSystemAddress("0x2222")).toBe(false);
		expect(isSystemAddress("")).toBe(false);
	});
});
