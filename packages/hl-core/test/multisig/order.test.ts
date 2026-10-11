import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	explainExchangeError,
	orderFloor,
	orderMark,
	overtakenBy,
	wouldShutOut,
} from "../../src/multisig/index.ts";
import { ORDERED_ACTION_TYPES, SHUT_OUT_BY } from "../../src/rules/multisig.ts";

interface Sent {
	action: Record<string, unknown>;
	leader: string;
	nonce: number;
	answer: { status: string; response: unknown };
}
const recorded = JSON.parse(
	readFileSync(
		new URL("../../fixtures/multisig/send-order.json", import.meta.url),
		"utf8",
	),
) as { pairs: { label: string; first: Sent; then: Sent }[] };

const send = (time: unknown, over: Record<string, unknown> = {}) => ({
	type: "usdSend",
	hyperliquidChain: "Testnet",
	destination: "0x00000000000000000000000000000000000000aa",
	amount: "1",
	time,
	...over,
});

describe("what Hyperliquid did on testnet (recorded pairs: newer first, then older)", () => {
	it("holds the pairs the rule was read from", () => {
		expect(recorded.pairs).toHaveLength(12);
		// in every pair the second action's number is the older one and was sent second
		for (const p of recorded.pairs)
			expect(p.then.nonce, p.label).toBeLessThan(p.first.nonce);
	});
	it.each(
		recorded.pairs.map((p) => [p.label, p] as const),
	)("%s", (_label, p) => {
		// what was carried out before the second action was sent
		const done = p.first.answer.status === "ok" ? [p.first] : [];
		const predicted = overtakenBy(p.then.action, done) !== null;
		const refused =
			p.then.answer.status === "err" &&
			explainExchangeError(p.then.answer, 200).id === "nonce-used";
		expect(predicted).toBe(refused);
		// and nothing else went wrong with the older one
		if (!refused) expect(p.then.answer.status).toBe("ok");
	});
	it("was refused whoever led it", () => {
		const other = recorded.pairs.find((p) => p.first.leader !== p.then.leader);
		expect(other?.then.answer).toEqual({
			status: "err",
			response: "Nonce already used.",
		});
	});
});

interface Step {
	action: Record<string, unknown>;
	nonce: number;
	leader?: string;
	answer: { status: string; response: unknown };
}
interface Question {
	suite: string;
	account: string;
	label: string;
	before?: { action: Record<string, unknown> }[];
	steps: Step[];
}
const lab = JSON.parse(
	readFileSync(
		new URL("../../fixtures/multisig/nonce-order.json", import.meta.url),
		"utf8",
	),
) as { questions: Question[] };

/** Refusals of the signer's own number set: Hyperliquid checks it before the account's order. */
const NUMBER_SET = new Set(["nonce-duplicate", "nonce-low", "nonce-high"]);
const answerId = (a: Step["answer"]): string | null =>
	a.status === "err" ? explainExchangeError(a, 200).id : null;

describe("the order lab: every question asked of testnet, and what the rule says to each", () => {
	const kindsOf = (account: string) =>
		new Set(
			lab.questions
				.filter((q) => q.account === account)
				.flatMap((q) => q.steps.map((s) => String(s.action.type))),
		);
	it("asked a plain account and a multi-sig about every kind that could be run", () => {
		expect(lab.questions.length).toBeGreaterThanOrEqual(200);
		for (const type of [
			"usdSend",
			"withdraw3",
			"spotSend",
			"usdClassTransfer",
			"sendAsset",
			"approveAgent",
			"approveBuilderFee",
			"noop",
			"order",
			"cancel",
			"cancelByCloid",
			"modify",
			"updateLeverage",
			"evmUserModify",
			"spotUser",
		]) {
			expect(kindsOf("plain").has(type), `plain ${type}`).toBe(true);
			expect(kindsOf("multi-sig").has(type), `multi-sig ${type}`).toBe(true);
		}
		for (const type of [
			"cDeposit",
			"cWithdraw",
			"tokenDelegate",
			"userSetAbstraction",
			"userDexAbstraction",
			"twapOrder",
			"twapCancel",
			"batchModify",
			"reserveRequestWeight",
			"setDisplayName",
		])
			expect(kindsOf("plain").has(type), `plain ${type}`).toBe(true);
	});
	it.each(
		lab.questions.map(
			(q) => [`${q.suite} · ${q.account} · ${q.label}`, q] as const,
		),
	)("%s", (_name, q) => {
		// what the account had carried out before each request
		const done: { action: unknown }[] = [...(q.before ?? [])];
		for (const [i, s] of q.steps.entries()) {
			const predicted = overtakenBy(s.action, done) !== null;
			const id = answerId(s.answer);
			if (id === null || !NUMBER_SET.has(id))
				expect(id === "nonce-used", `step ${i + 1}: ${id}`).toBe(predicted);
			if (s.answer.status === "ok") done.push({ action: s.action });
		}
	});
	it('only a USDC send or a withdrawal was ever answered "Nonce already used."', () => {
		const refused = new Set(
			lab.questions.flatMap((q) =>
				q.steps
					.filter((s) => answerId(s.answer) === "nonce-used")
					.map((s) => String(s.action.type)),
			),
		);
		expect([...refused].sort()).toEqual(["usdSend", "withdraw3"]);
		expect(Object.keys(SHUT_OUT_BY).sort()).toEqual([...refused].sort());
	});
	it("a send that failed, or was only dated later and never carried out, shuts nothing out", () => {
		const failedThenOlder = lab.questions.filter((q) =>
			q.steps.some(
				(s, i) =>
					s.action.type === "usdSend" &&
					s.answer.status === "err" &&
					q.steps
						.slice(i + 1)
						.some(
							(t) =>
								t.action.type === "usdSend" &&
								t.nonce < s.nonce &&
								t.answer.status === "ok",
						),
			),
		);
		expect(failedThenOlder.length).toBeGreaterThanOrEqual(2);
	});
});

describe("orderMark", () => {
	it("marks a USDC send by its time, and nothing else", () => {
		expect(orderMark(send(1_791_000_000_000))).toEqual({
			kind: "usdSend",
			time: 1_791_000_000_000,
		});
		for (const type of [
			"usdClassTransfer",
			"spotSend",
			"approveAgent",
			"convertToMultiSigUser",
			"order",
		])
			expect(orderMark({ type, time: 5, nonce: 5 }), type).toBeNull();
		expect(ORDERED_ACTION_TYPES).toEqual(["usdSend", "withdraw3"]);
	});
	it("marks a bridge withdrawal too: a later send shuts it out", () => {
		expect(
			orderMark({
				type: "withdraw3",
				destination: "0xaa",
				amount: "5",
				time: 7,
			}),
		).toEqual({ kind: "withdraw3", time: 7 });
	});
	it("reads a time that arrives as a bigint, and refuses one that is not a whole number", () => {
		expect(orderMark(send(1_791_000_000_000n))?.time).toBe(1_791_000_000_000);
		for (const time of [
			"1791000000000",
			1.5,
			null,
			undefined,
			-1n,
			2n ** 60n,
			Number.MAX_SAFE_INTEGER + 2,
		])
			expect(orderMark(send(time)), String(time)).toBeNull();
	});
	it("is null for anything that is not an action", () => {
		for (const v of [null, undefined, "usdSend", 7, [], [send(1)], {}])
			expect(orderMark(v)).toBeNull();
		expect(orderMark({ type: 5, time: 5 })).toBeNull();
	});
});

describe("overtakenBy", () => {
	const done = (time: number, over: Record<string, unknown> = {}) => ({
		action: send(time, over),
		id: `done@${time}`,
	});
	it("is the later send that was carried out", () => {
		expect(overtakenBy(send(100), [done(200)])?.id).toBe("done@200");
		expect(overtakenBy(send(100), [done(50), done(99)])).toBeNull();
		expect(overtakenBy(send(100), [])).toBeNull();
	});
	it("does not depend on where the sends go or how much", () => {
		expect(
			overtakenBy(send(100), [
				done(200, {
					destination: "0x00000000000000000000000000000000000000bb",
					amount: "9",
				}),
			])?.id,
		).toBe("done@200");
	});
	it("counts a send with the same number: Hyperliquid wants a greater one", () => {
		expect(overtakenBy(send(100), [done(100)])?.id).toBe("done@100");
	});
	it("names the latest when several are later", () => {
		expect(overtakenBy(send(100), [done(150), done(300), done(200)])?.id).toBe(
			"done@300",
		);
	});
	it("leaves the other kinds alone, on either side", () => {
		const transfer = { type: "usdClassTransfer", nonce: 100, toPerp: true };
		expect(overtakenBy(transfer, [done(200)])).toBeNull();
		expect(
			overtakenBy(send(100), [
				{ action: { type: "approveAgent", nonce: 200 } },
				{ action: { type: "spotSend", time: 200 } },
				{ action: null },
			]),
		).toBeNull();
	});
});

describe("a withdrawal and the sends around it", () => {
	const withdrawal = (time: number) => ({
		type: "withdraw3",
		hyperliquidChain: "Testnet",
		destination: "0x00000000000000000000000000000000000000aa",
		amount: "5",
		time,
	});
	it("is shut out by a send with a number that is not smaller", () => {
		expect(
			overtakenBy(withdrawal(100), [{ action: send(200) }]),
		).not.toBeNull();
		expect(
			overtakenBy(withdrawal(100), [{ action: send(100) }]),
		).not.toBeNull();
		expect(overtakenBy(withdrawal(100), [{ action: send(99) }])).toBeNull();
	});
	it("is not said to shut a send, or another withdrawal, out: that was never measured", () => {
		expect(overtakenBy(send(100), [{ action: withdrawal(200) }])).toBeNull();
		expect(
			overtakenBy(withdrawal(100), [{ action: withdrawal(200) }]),
		).toBeNull();
		expect(wouldShutOut(withdrawal(300), [{ action: send(100) }])).toEqual([]);
	});
	it("a send about to be submitted is told about the older withdrawal it would shut out", () => {
		const older = { action: withdrawal(100), id: "w" };
		expect(wouldShutOut(send(300), [older])).toEqual([older]);
	});
});

describe("orderFloor", () => {
	const known = (...actions: unknown[]) =>
		actions.map((action) => ({ action }));
	const withdrawal = (time: number) => ({ type: "withdraw3", time });
	it("is one more than the highest number among the sends on record", () => {
		expect(orderFloor("usdSend", known(send(100), send(300), send(200)))).toBe(
			301,
		);
	});
	it("counts sends and withdrawals as one sequence, for either kind", () => {
		expect(orderFloor("withdraw3", known(send(500), withdrawal(900)))).toBe(
			901,
		);
		expect(orderFloor("usdSend", known(send(500), withdrawal(900)))).toBe(901);
	});
	it("ignores what Hyperliquid takes in any order, and what is not an action", () => {
		expect(
			orderFloor(
				"usdSend",
				known(
					{ type: "spotSend", time: 900 },
					{ type: "usdClassTransfer", nonce: 900 },
					null,
					send("900"),
				),
			),
		).toBeNull();
		expect(orderFloor("usdSend", [])).toBeNull();
	});
	it("is null for a kind Hyperliquid takes in any order", () => {
		for (const type of [
			"spotSend",
			"usdClassTransfer",
			"sendAsset",
			"approveAgent",
			"noop",
		])
			expect(orderFloor(type, known(send(100))), type).toBeNull();
	});
	it("so that carrying them out in the order they were made is never refused", () => {
		// a send dated ahead, then two more made "now": each is numbered after the one before
		const first = send(1_000_000 + 82_800_000);
		const second = send(orderFloor("usdSend", known(first)) as number);
		const third = send(orderFloor("usdSend", known(first, second)) as number);
		expect(overtakenBy(second, known(first))).toBeNull();
		expect(overtakenBy(third, known(first, second))).toBeNull();
		// while a send simply dated "now" would have been shut out
		expect(overtakenBy(send(1_000_500), known(first))).not.toBeNull();
	});
});

describe("wouldShutOut", () => {
	const pending = (time: number, type = "usdSend") => ({
		action: type === "usdSend" ? send(time) : { type, time, nonce: time },
		id: `${type}@${time}`,
	});
	it("lists the older pending sends, oldest first", () => {
		expect(
			wouldShutOut(send(300), [
				pending(200),
				pending(400),
				pending(100),
				pending(300),
				pending(150, "spotSend"),
			]).map((p) => p.id),
		).toEqual(["usdSend@100", "usdSend@200"]);
	});
	it("is empty for an action that is not ordered, and when nothing older waits", () => {
		expect(
			wouldShutOut({ type: "approveAgent", nonce: 300 }, [pending(100)]),
		).toEqual([]);
		expect(wouldShutOut(send(300), [pending(400)])).toEqual([]);
		expect(wouldShutOut(send(300), [])).toEqual([]);
	});
});
