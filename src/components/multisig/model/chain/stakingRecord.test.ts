import type { ExplorerTx, PlainObject, StakingEvent } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { NONCE, TREASURY } from "#/test/keys";
import type { Lookup } from "./match";
import { stakingCandidates, stepRecord } from "./stakingRecord";

const X = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
const Y = "0x0014b26bde5766c0c0f94130af5c4bf4551eeef6";
const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

const stake = (over: Record<string, unknown> = {}): PlainObject => ({
	type: "tokenDelegate",
	...HEAD,
	validator: X,
	wei: 10_000_000_000,
	isUndelegate: false,
	nonce: NONCE,
	...over,
});
const event = (
	hash: string,
	over: Partial<StakingEvent> = {},
): StakingEvent => ({
	time: NONCE + HOUR,
	hash,
	kind: "stake",
	amount: "100",
	validator: X,
	...over,
});
const tx = (action: unknown, over: Partial<ExplorerTx> = {}): ExplorerTx =>
	({
		hash: h(1),
		user: TREASURY,
		action,
		error: null,
		time: NONCE + HOUR,
		block: 1,
		...over,
	}) as ExplorerTx;
const found = (t: ExplorerTx): Lookup => ({ state: "found", tx: t });
const record = (
	events: StakingEvent[] | null,
	lookups: [string, Lookup][] = [],
	action = stake(),
) =>
	stepRecord({
		action,
		nonce: NONCE,
		account: TREASURY,
		events,
		lookups: new Map(lookups),
	});

describe("the steps in the staking history that could be a proposal's", () => {
	it("agree in kind, amount and validator, and lie where its number allows", () => {
		const events = [
			event(h(1)),
			event(h(2), { amount: "100.0" }),
			event(h(3), { amount: "99" }),
			event(h(4), { validator: Y }),
			event(h(5), { kind: "unstake" }),
			event(h(6), { time: NONCE - DAY - 1 }),
			event(h(7), { time: NONCE + 2 * DAY + 1 }),
			event(h(8), { time: NONCE + 2 * DAY }),
		];
		expect(
			stakingCandidates(stake(), NONCE, events).map((e) => e.hash),
		).toEqual([h(8), h(1), h(2)]);
	});
	it("each kind of step has its own row in the history", () => {
		const moveIn: PlainObject = {
			type: "cDeposit",
			...HEAD,
			wei: 5_000_000_000,
			nonce: NONCE,
		};
		const back: PlainObject = { ...moveIn, type: "cWithdraw" };
		const events = [
			event(h(1), { kind: "moveIn", amount: "50", validator: null }),
			event(h(2), { kind: "returnStarted", amount: "50", validator: null }),
			// a return that landed is Hyperliquid's own step: never a proposal's
			event(h(0), { kind: "returnLanded", amount: "50", validator: null }),
			event(h(3), { kind: "unstake" }),
		];
		expect(stakingCandidates(moveIn, NONCE, events).map((e) => e.hash)).toEqual(
			[h(1)],
		);
		expect(stakingCandidates(back, NONCE, events).map((e) => e.hash)).toEqual([
			h(2),
		]);
		expect(
			stakingCandidates(stake({ isUndelegate: true }), NONCE, events).map(
				(e) => e.hash,
			),
		).toEqual([h(3)]);
	});
	it("an action that is no staking step has none", () => {
		expect(
			stakingCandidates({ type: "usdSend", amount: "100" }, NONCE, [
				event(h(1)),
			]),
		).toEqual([]);
	});
});

describe("whether a staking step was carried out", () => {
	it("nothing is known before the history is read", () => {
		expect(record(null)).toEqual({ kind: "unread" });
	});
	it("no step like it: not carried out", () => {
		expect(record([])).toEqual({ kind: "none" });
		expect(record([event(h(1), { amount: "5" })])).toEqual({ kind: "none" });
	});
	it("a step like it is looked up before anything is said", () => {
		expect(record([event(h(1))])).toEqual({ kind: "checking" });
		expect(record([event(h(1))], [[h(1), { state: "pending" }]])).toEqual({
			kind: "checking",
		});
	});
	it("its transaction is this proposal's action: carried out", () => {
		expect(record([event(h(1))], [[h(1), found(tx(stake()))]])).toEqual({
			kind: "matched",
			hash: h(1),
			time: NONCE + HOUR,
		});
		// the explorer may order the fields differently: the number and the step decide
		const { nonce, ...rest } = stake();
		expect(
			record([event(h(1))], [[h(1), found(tx({ nonce, ...rest }))]]).kind,
		).toBe("matched");
	});
	it("the same step under another number is somebody else's", () => {
		// another proposal staked the same amount with the same validator
		expect(
			record([event(h(1))], [[h(1), found(tx(stake({ nonce: NONCE + 5 })))]]),
		).toEqual({ kind: "none" });
		// of two like it, the second is this one
		expect(
			record(
				[event(h(1)), event(h(2), { time: NONCE + 2 * HOUR })],
				[
					[h(1), found(tx(stake({ nonce: NONCE + 5 })))],
					[h(2), found(tx(stake()))],
				],
			),
		).toMatchObject({ kind: "matched", hash: h(2) });
	});
	it("another account's transaction, or one Hyperliquid rejected, is not it", () => {
		expect(
			record([event(h(1))], [[h(1), found(tx(stake(), { user: X }))]]),
		).toEqual({ kind: "none" });
		expect(
			record([event(h(1))], [[h(1), found(tx(stake(), { error: "refused" }))]]),
		).toEqual({ kind: "none" });
	});
	it("the explorer did not answer: one step like it is likely this one, never certainly", () => {
		for (const state of ["failed", "unknown-hash"] as const)
			expect(record([event(h(1))], [[h(1), { state }]])).toEqual({
				kind: "likely",
				hash: h(1),
				time: NONCE + HOUR,
			});
		// a transaction shown in a form that cannot be read decides nothing either
		expect(
			record([event(h(1))], [[h(1), found(tx({ type: "multiSig" }))]]).kind,
		).toBe("likely");
	});
	it("several like it and no answer: they are not told apart", () => {
		expect(
			record(
				[event(h(1)), event(h(2))],
				[
					[h(1), { state: "failed" }],
					[h(2), { state: "failed" }],
				],
			),
		).toEqual({ kind: "unchecked" });
		// one of the two turned out to be another proposal's: the other is the likely one
		expect(
			record(
				[event(h(1)), event(h(2))],
				[
					[h(1), found(tx(stake({ nonce: 7 })))],
					[h(2), { state: "failed" }],
				],
			),
		).toMatchObject({ kind: "likely", hash: h(2) });
	});
	it("while one look-up is still out, nothing is concluded from the others", () => {
		expect(
			record([event(h(1)), event(h(2))], [[h(1), { state: "failed" }]]),
		).toEqual({ kind: "checking" });
	});
});
