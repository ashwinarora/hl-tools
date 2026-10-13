/**
 * Hyperliquid's record against this page's own forms. A transfer is tied to
 * its proposal by comparing the action the form built with the action
 * Hyperliquid's explorer lists, field by field and in the same order of
 * fields. If the explorer ever wrote an action another way than the form
 * does, every row would read "none on record". So the comparison is run here
 * on answers recorded from the explorer (the core's
 * fixtures/explorer/testnet-userdetails.json), not on actions made up to fit.
 */
import { readFileSync } from "node:fs";
import {
	accountMode,
	type ExplorerTx,
	type Hex,
	type PlainObject,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { type ActionForm, buildAction, DEFAULT_FORM } from "../actions";
import { stakingActions } from "../staking";
import { judgeTx, type MatchCandidate, sameAction } from "./match";

const recorded = (
	JSON.parse(
		readFileSync(
			new URL(
				"../../../../../packages/hl-core/fixtures/explorer/testnet-userdetails.json",
				import.meta.url,
			),
			"utf8",
		),
	) as {
		answers: { name: string; user: string; body: { txs?: ExplorerTx[] } }[];
	}
).answers.find((a) => a.name === "busy-account");
const ACCOUNT = recorded?.user as string;
const txs = recorded?.body.txs ?? [];
const one = (type: string, error: "none" | "some" = "none") => {
	const tx = txs.find(
		(t) => t.action.type === type && (t.error === null) === (error === "none"),
	);
	if (!tx) throw new Error(`no recorded ${type}`);
	return tx;
};
const candidate = (action: PlainObject, n = 1): MatchCandidate => ({
	digest: `0x${n.toString(16).padStart(64, "0")}` as Hex,
	action,
	nonce: Number(action.nonce ?? action.time ?? 0),
	finaliser: ACCOUNT,
});
const HEAD = { signatureChainId: "0x66eee", hyperliquidChain: "Testnet" };

describe("the explorer's list, as recorded, against what the forms build", () => {
	it("the list holds what the tests below need", () => {
		expect(txs.length).toBeGreaterThan(0);
		expect(new Set(txs.map((t) => t.user))).toEqual(new Set([ACCOUNT]));
	});

	it("a move between perps and spot is tied to the proposal the form makes", () => {
		const tx = one("usdClassTransfer");
		const built = buildAction(
			{
				...DEFAULT_FORM,
				kind: "usdClassTransfer",
				amount: String(tx.action.amount),
				toPerp: tx.action.toPerp ? "perp" : "spot",
			} as ActionForm,
			{
				network: "testnet",
				multiSigUser: ACCOUNT,
				nonce: tx.action.nonce as number,
				signatureChainId: "0x66eee",
				mode: accountMode("default"),
			},
		);
		expect(built.action).not.toBeNull();
		// the same fields in the same order, as Hyperliquid has them
		expect(JSON.stringify(built.action)).toBe(JSON.stringify(tx.action));
		expect(
			judgeTx(tx, ACCOUNT, [candidate(built.action as PlainObject)]),
		).toEqual({
			kind: "matched",
			digest: candidate(built.action as PlainObject).digest,
		});
		// the same move with another number is another proposal
		const other = { ...(built.action as PlainObject), nonce: 1 };
		expect(judgeTx(tx, ACCOUNT, [candidate(other)])).toEqual({ kind: "none" });
	});

	it("a staking step is tied to the step the staking form makes", () => {
		const tx = one("tokenDelegate");
		const [built] = stakingActions(
			[
				{
					kind: tx.action.isUndelegate ? "unstake" : "stake",
					validator: tx.action.validator as string,
					// 8 decimals: the recorded step is in wei
					amount: (Number(tx.action.wei) / 1e8).toFixed(8),
				},
			],
			HEAD,
			tx.action.nonce as number,
		);
		expect(JSON.stringify(built)).toBe(JSON.stringify(tx.action));
		expect(judgeTx(tx, ACCOUNT, [candidate(built as PlainObject)]).kind).toBe(
			"matched",
		);
	});

	it("an attempt Hyperliquid refused is never a proposal carried out", () => {
		const tx = one("userSetAbstraction", "some");
		expect(judgeTx(tx, ACCOUNT, [candidate(tx.action as PlainObject)])).toEqual(
			{ kind: "failed", error: tx.error },
		);
	});

	it("a mode switch is listed with its one-letter code, not as it was proposed", () => {
		// Known, and on no path today: a mode switch leaves no row in the
		// ledger, so nothing looks its transaction up. Whoever ties one by the
		// explorer's list has to translate the letter first.
		const tx = one("userSetAbstraction");
		expect(tx.action.abstraction).toBe("u");
		const proposed = { ...tx.action, abstraction: "unifiedAccount" };
		expect(sameAction(proposed, tx.action)).toBe(false);
	});
});
