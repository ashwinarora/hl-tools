import type { PlainObject } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, OUTSIDER, RECIPIENT, TREASURY } from "#/test/keys";
import { checkBeforeSubmit, type SendReads } from "./sendCheck";

const USDC = "USDC:0xeb62eee3685fc4c43992febcd9e75443";
const asset = (sourceDex: string, amount = "5"): PlainObject => ({
	type: "sendAsset",
	destination: RECIPIENT,
	sourceDex,
	destinationDex: "",
	token: USDC,
	amount,
	fromSubAccount: "",
	nonce: 1,
});
const payload = (action: PlainObject) => ({
	network: "testnet" as const,
	multiSigUser: TREASURY,
	action,
});

/** Reads that answer from a table and remember what was asked. */
function reads(over: Partial<Record<keyof SendReads, unknown>> = {}) {
	const asked: string[] = [];
	const answer =
		<T>(name: keyof SendReads, value: T) =>
		async (who: string): Promise<T> => {
			asked.push(`${name} ${who === TREASURY ? "treasury" : "receiver"}`);
			const v = name in over ? over[name] : value;
			if (v instanceof Error) throw v;
			return (typeof v === "function" ? v(who) : v) as T;
		};
	const r: SendReads = {
		mode: answer("mode", "default"),
		withdrawable: answer("withdrawable", "100"),
		spot: answer("spot", [{ coin: "USDC", total: "100", hold: "0" }]),
		role: answer("role", { role: "user" }),
		signers: answer("signers", [A, B, C]),
	};
	return { r, asked };
}
const codes = async (action: PlainObject, over = {}) =>
	(await checkBeforeSubmit(payload(action), reads(over).r)).map((x) => x.code);

describe("checkBeforeSubmit", () => {
	it("reads the treasury and the receiver, once each, and lets a sound send through", async () => {
		const { r, asked } = reads();
		expect(await checkBeforeSubmit(payload(asset("")), r)).toEqual([]);
		expect(asked.sort()).toEqual([
			"mode receiver",
			"mode treasury",
			"role receiver",
			"spot treasury",
			"withdrawable treasury",
		]);
	});
	it("asks nothing about an action that moves no money", async () => {
		const { r, asked } = reads();
		expect(
			await checkBeforeSubmit(
				payload({ type: "approveAgent", agentAddress: RECIPIENT }),
				r,
			),
		).toEqual([]);
		expect(asked).toEqual([]);
	});
	it("does not look a receiver up for a move inside the account or a withdrawal", async () => {
		const inside: PlainObject[] = [
			{ type: "usdClassTransfer", amount: "1", toPerp: true },
			{ type: "withdraw3", destination: RECIPIENT, amount: "5", time: 1 },
		];
		for (const action of inside) {
			const { r, asked } = reads();
			expect(await checkBeforeSubmit(payload(action), r)).toEqual([]);
			expect(asked.some((a) => a.endsWith("receiver"))).toBe(false);
			expect(asked).toContain("withdrawable treasury");
		}
	});
	it("stops what the treasury's mode refuses now, whatever it was when proposed", async () => {
		expect(await codes(asset(""), { mode: "unifiedAccount" })).toEqual([
			"unified-spot-only",
		]);
		expect(
			await codes(
				{ type: "usdSend", destination: RECIPIENT, amount: "5", time: 1 },
				{ mode: "unifiedAccount" },
			),
		).toEqual(["unified-disabled"]);
		expect(await codes(asset("spot"), { mode: "unifiedAccount" })).toEqual([]);
	});
	it("stops a send the balances no longer cover, with the fee for a new address", async () => {
		expect(await codes(asset("", "5"), { withdrawable: "4" })).toEqual([
			"transfer-balance",
		]);
		const fresh = {
			role: { role: "missing" },
			withdrawable: "5.5",
			spot: [{ coin: "USDC", total: "0.5", hold: "0" }],
		};
		expect(await codes(asset("", "5"), fresh)).toEqual(["transfer-gas"]);
		expect(
			await codes(asset("", "5"), { ...fresh, withdrawable: "6" }),
		).toEqual([]);
		// a bridge withdrawal above what can leave perps
		expect(
			await codes(
				{ type: "withdraw3", destination: RECIPIENT, amount: "5", time: 1 },
				{ withdrawable: "4" },
			),
		).toEqual(["transfer-balance"]);
	});
	it("a read that fails stops nothing: the fact is simply not known", async () => {
		const down = new Error("offline");
		expect(
			await codes(asset("", "999"), {
				mode: down,
				withdrawable: down,
				spot: down,
				role: down,
			}),
		).toEqual([]);
		// the mode is known, the balances are not: the mode still speaks
		expect(
			await codes(asset(""), {
				mode: (who: string) =>
					who === TREASURY ? "unifiedAccount" : "default",
				withdrawable: down,
				spot: down,
			}),
		).toEqual(["unified-spot-only"]);
		// the receiver could not be read: no fee is assumed
		expect(
			await codes(asset("", "5"), {
				role: down,
				withdrawable: "5.5",
				spot: [],
			}),
		).toEqual([]);
		// an answer that is not a mode at all
		expect(await codes(asset("", "5"), { mode: 7 })).toEqual([]);
	});

	describe("a change of signers", () => {
		const change = (signers: string): PlainObject => ({
			type: "convertToMultiSigUser",
			signers,
			nonce: 1,
		});
		const set = (users: readonly string[], threshold = 2) =>
			JSON.stringify({ authorizedUsers: users, threshold });

		it("asks only about the signers that would be new, and lets a sound change through", async () => {
			const { r, asked } = reads();
			expect(
				await checkBeforeSubmit(payload(change(set([A, B, OUTSIDER]))), r),
			).toEqual([]);
			// the treasury's signers, then the one address that is not among them
			expect(asked).toEqual(["signers treasury", "role receiver"]);
		});

		it("stops a change that adds an address never used, or a vault", async () => {
			const never = await checkBeforeSubmit(
				payload(change(set([A, B, OUTSIDER]))),
				reads({ role: { role: "missing" } }).r,
			);
			expect(never.map((x) => x.code)).toEqual(["multisig-signer-missing"]);
			expect(never[0]?.message).toContain(OUTSIDER.slice(0, 6));
			expect(
				await codes(change(set([A, B, OUTSIDER])), { role: { role: "vault" } }),
			).toEqual(["multisig-signer-kind"]);
			expect(
				await codes(change(set([A, B, OUTSIDER])), {
					role: { role: "subAccount", data: { master: A } },
				}),
			).toEqual(["multisig-signer-kind"]);
		});

		it("lets an API wallet and an unread answer through: nothing is claimed", async () => {
			expect(
				await codes(change(set([A, B, OUTSIDER])), {
					role: { role: "agent", data: { user: A } },
				}),
			).toEqual([]);
			expect(
				await codes(change(set([A, B, OUTSIDER])), { role: new Error("429") }),
			).toEqual([]);
		});

		it("checks every signer when the treasury's own list could not be read", async () => {
			const { r, asked } = reads({ signers: new Error("timeout") });
			await checkBeforeSubmit(payload(change(set([A, B]))), r);
			expect(asked.filter((a) => a.startsWith("role"))).toHaveLength(2);
		});

		it("asks nothing for a change that only removes, or the conversion back", async () => {
			for (const signers of [set([A, B]), "null", "{not json"]) {
				const { r, asked } = reads();
				expect(await checkBeforeSubmit(payload(change(signers)), r)).toEqual(
					[],
				);
				expect(asked.filter((a) => a.startsWith("role"))).toEqual([]);
			}
		});
	});
});
