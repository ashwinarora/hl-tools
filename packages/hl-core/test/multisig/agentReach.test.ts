import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explainExchangeError } from "../../src/multisig/index.ts";
import {
	API_WALLET_REACH,
	MULTISIG_FACTS,
	MULTISIG_RULES,
} from "../../src/rules/multisig.ts";
import { userSignedSpec } from "../../src/rules/signing.ts";

interface Run {
	about: string;
	signedBy: "own key" | "API wallet" | "signers";
	accountIs: "plain" | "multi-sig";
	account: string;
	action: { type: string; destination?: string };
	accepted: boolean;
	answer: { status: string; response?: unknown };
}
const reach = JSON.parse(
	readFileSync(
		new URL("../../fixtures/multisig/agent-reach.json", import.meta.url),
		"utf8",
	),
) as { runs: Run[] };
/** Deposits are locked for days: a withdrawal refused for that says nothing about who may ask. */
const LOCKED = /lockup/i;
const judged = reach.runs.filter(
	(r) => !LOCKED.test(String(r.answer.response ?? "")),
);

describe("what an API wallet reaches, as testnet answered", () => {
	it("was asked of a plain account and of a multi-sig, beside the own key and the signers", () => {
		expect(new Set(reach.runs.map((r) => r.signedBy))).toEqual(
			new Set(["own key", "API wallet", "signers"]),
		);
		expect(
			reach.runs.some(
				(r) => r.signedBy === "API wallet" && r.accountIs === "multi-sig",
			),
		).toBe(true);
		expect(judged.length).toBeGreaterThanOrEqual(9);
	});

	it.each(
		judged
			.filter((r) => r.signedBy === "API wallet")
			.map((r) => [`${r.accountIs} · ${r.about}`, r] as const),
	)("%s", (_name, r) => {
		const rule = API_WALLET_REACH[r.action.type];
		expect(rule, r.action.type).toBeDefined();
		const may =
			rule === "any" || (rule === "own" && r.action.destination === r.account);
		expect(r.accepted).toBe(may);
	});

	it("lets the account itself, and its signers, do what the API wallet did", () => {
		for (const r of judged.filter((x) => x.signedBy !== "API wallet"))
			expect(r.accepted, r.about).toBe(true);
	});

	it("refuses every user-signed way of moving money to an API wallet", () => {
		for (const [type, rule] of Object.entries(API_WALLET_REACH))
			if (userSignedSpec(type)) expect(rule, type).toBe("never");
		// the two it may sign are L1 actions
		expect(userSignedSpec("vaultTransfer")).toBeUndefined();
		expect(userSignedSpec("agentSendAsset")).toBeUndefined();
	});

	it("explains the refusals it met", () => {
		const out = reach.runs.find((r) => /another account/.test(r.about));
		expect(explainExchangeError(out?.answer, 200).id).toBe("agent-send-scope");
		const userSigned = reach.runs.find((r) => /user-signed/.test(r.about));
		expect(explainExchangeError(userSigned?.answer, 200).id).toBe(
			"must-deposit",
		);
	});

	it("is what the rule set says in words", () => {
		const fact = (id: string) =>
			MULTISIG_FACTS.find((f) => f.id === id)?.text ?? "";
		expect(fact("agent-bypass")).toMatch(/move it into vaults/);
		expect(fact("agent-bypass")).toMatch(/cannot send it to another account/);
		expect(fact("agent-reach")).toMatch(/vaultTransfer/);
		expect(fact("signer-kinds")).toMatch(/vault/);
		expect(fact("convert-own-key")).toMatch(/any signing chain/);
		expect(MULTISIG_RULES.version).toBe("1.3.0");
		expect(new Set(MULTISIG_FACTS.map((f) => f.id)).size).toBe(
			MULTISIG_FACTS.length,
		);
	});
});
