import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	explainExchangeError,
	orderMark,
	overtakenBy,
	wouldShutOut,
} from "../../src/multisig/index.ts";
import { ORDERED_ACTION_TYPES } from "../../src/rules/multisig.ts";

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
		expect(ORDERED_ACTION_TYPES).toEqual(["usdSend"]);
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
