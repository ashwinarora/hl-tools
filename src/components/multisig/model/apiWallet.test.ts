import { MULTISIG_FACTS } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { ACTION_KINDS } from "./actions";
import {
	API_WALLET_CAN,
	API_WALLET_CANNOT,
	API_WALLET_PROPOSE,
	API_WALLET_ROW,
	API_WALLET_SENTENCE,
} from "./apiWallet";
import { HELP } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

describe("what the screens say an API wallet can do", () => {
	const texts = [
		API_WALLET_SENTENCE,
		API_WALLET_PROPOSE,
		API_WALLET_ROW,
		HELP.apiWallet.body,
		ACTION_KINDS.find((k) => k.kind === "approveAgent")?.description ?? "",
	];
	it("names the vaults, and what it cannot do", () => {
		expect(API_WALLET_SENTENCE).toContain(API_WALLET_CAN);
		expect(API_WALLET_SENTENCE).toContain(API_WALLET_CANNOT);
		expect(HELP.apiWallet.body).toMatch(/vaults/);
		expect(HELP.apiWallet.body).toMatch(/cannot send funds to another account/);
		expect(texts[4]).toMatch(/vaults/);
	});
	it("agrees with the rule it rests on", () => {
		const fact =
			MULTISIG_FACTS.find((f) => f.id === "agent-bypass")?.text ?? "";
		expect(fact).toMatch(/move it into vaults/);
		expect(fact).toMatch(/cannot send it to another account or withdraw it/);
	});
	it("promises nothing the product does not provide", () => {
		for (const t of texts) {
			expect(t.length).toBeGreaterThan(20);
			for (const claim of FORBIDDEN_CLAIMS) expect(t).not.toMatch(claim);
		}
	});
});
