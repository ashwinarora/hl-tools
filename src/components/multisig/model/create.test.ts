import { ERROR_CATALOG } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { TREASURY } from "#/test/keys";
import {
	type AccountFacts,
	accountLines,
	CREATE,
	REFUSAL_IDS,
	refusalText,
} from "./create";
import { HELP_JARGON } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

const NOW = 1_791_700_000_000;
const facts = (over: Partial<AccountFacts> = {}): AccountFacts => ({
	role: "user",
	multiSig: null,
	agents: [],
	positions: 0,
	orders: 0,
	now: NOW,
	...over,
});
const codes = (f: Partial<AccountFacts>) =>
	accountLines(facts(f)).lines.map((l) => l.code);

describe("accountLines: the account being converted", () => {
	it("an ordinary account with nothing open has nothing to say", () => {
		expect(accountLines(facts())).toEqual({ lines: [], blockedBy: null });
		// nothing read yet about positions: nothing claimed
		expect(codes({ positions: null, orders: null })).toEqual([]);
	});
	it("blocks an account Hyperliquid would refuse: never used, or a multi-sig already", () => {
		const never = accountLines(facts({ role: "missing" }));
		expect(never.lines.map((l) => [l.level, l.code])).toEqual([
			["blocked", "create.never_used"],
		]);
		expect(never.blockedBy).toContain("never received anything");
		const already = accountLines(
			facts({ multiSig: { threshold: 2, signers: 3 }, role: null }),
		);
		expect(already.lines[0]?.code).toBe("create.already");
		expect(already.blockedBy).toContain("already a 2-of-3 treasury");
	});
	it("warns about what comes along: positions, orders and API wallets", () => {
		const j = accountLines(
			facts({
				positions: 2,
				orders: 1,
				agents: [
					{ name: "bot", validUntil: NOW + 1 },
					{ name: "old", validUntil: NOW - 1 },
				],
			}),
		);
		expect(j.blockedBy).toBeNull();
		expect(j.lines.map((l) => [l.level, l.code])).toEqual([
			["warning", "create.open"],
			["warning", "create.agents"],
		]);
		expect(j.lines[0]?.text).toBe(
			"2 open positions and 1 open order. After converting, only an API wallet can trade or cancel for this account.",
		);
		expect(j.lines[1]?.text).toContain('1 API wallet ("bot") keeps acting');
		expect(j.lines[1]?.text).toContain("move it into vaults");
		expect(
			accountLines(facts({ orders: 3 })).lines[0]?.text.startsWith(
				"3 open orders.",
			),
		).toBe(true);
		const two = accountLines(
			facts({
				agents: [
					{ name: "a", validUntil: NOW + 1 },
					{ name: "", validUntil: NOW + 1 },
				],
			}),
		).lines[0]?.text;
		expect(two).toContain('2 API wallets ("a", "unnamed") keep acting');
		expect(two).toContain("they can trade");
	});
	it("says so when the API wallets could not be read, and for a wallet that is one itself", () => {
		expect(codes({ agents: null })).toEqual(["create.agents_unread"]);
		expect(codes({ role: "agent" })).toEqual(["create.is_agent"]);
	});
});

describe("the wizard's sentences", () => {
	const texts: string[] = [
		CREATE.title,
		CREATE.meta,
		CREATE.headline(TREASURY),
		CREATE.otherAccount,
		CREATE.signersNote,
		// every fixed sentence, whatever is added later
		...Object.values(CREATE).flatMap((v) =>
			typeof v === "string" ? [v] : Array.isArray(v) ? [...v] : [],
		),
		CREATE.pasted(2, 1, ["foo", "bar"]),
		CREATE.pasted(1, 0, []),
		CREATE.before(TREASURY, 2, 3),
		CREATE.before(TREASURY, 3, 3),
		CREATE.before(TREASURY, 1, 1),
		CREATE.button(TREASURY, 2, 3),
		CREATE.inWallet(2, 3),
		CREATE.inWallet(1, 1),
		CREATE.done(TREASURY, 2, 3),
		CREATE.switchNow,
		...REFUSAL_IDS.map((id) => refusalText(id, "")),
		...accountLines(
			facts({
				positions: 1,
				orders: 1,
				agents: [{ name: "bot", validUntil: NOW + 1 }],
				role: "agent",
			}),
		).lines.map((l) => l.text),
		accountLines(facts({ role: "missing" })).lines[0]?.text ?? "",
		accountLines(facts({ agents: null })).lines[0]?.text ?? "",
	];
	it("promise nothing the product does not provide", () => {
		for (const t of texts)
			for (const claim of FORBIDDEN_CLAIMS)
				expect(t, `${claim} in "${t}"`).not.toMatch(claim);
	});
	it("avoid the developer's words, except the one the reader asked for", () => {
		// "HyperCore" is named on purpose: the block says where the change applies
		const jargon = HELP_JARGON.filter((w) => !w.test("HyperCore"));
		for (const t of texts)
			for (const word of jargon)
				expect(t, `${word} in "${t}"`).not.toMatch(word);
	});
	it("say what a paste left out", () => {
		expect(CREATE.pasted(0, 0, [])).toBe("");
		expect(CREATE.pasted(1, 2, ["nope"])).toBe(
			"1 address was already in the list. 2 addresses were left out: a treasury has at most 10 signers. Not an address: nope.",
		);
		expect(CREATE.pasted(0, 0, ["a", "b", "c", "d", "e"])).toBe(
			"Not addresses: a, b, c and 2 more.",
		);
	});
	it("open with a sentence that also holds where nobody signs in", () => {
		// a build without a relay shows the same page for a merely connected wallet
		expect(CREATE.meta).not.toMatch(/sign(ed)? in/i);
		expect(CREATE.otherAccountNoRelay).not.toMatch(/sign (in|out)/i);
		expect(CREATE.switchNowNoRelay).not.toMatch(/sign (in|out)/i);
	});
	it("say what changes, with the numbers in them", () => {
		expect(CREATE.headline(TREASURY)).toContain("your own account, 0x");
		expect(CREATE.before(TREASURY, 2, 3)).toContain(
			"Any 2 of the 3 signers above can.",
		);
		expect(CREATE.before(TREASURY, 3, 3)).toContain(
			"Only all 3 signers above together can.",
		);
		expect(CREATE.before(TREASURY, 1, 1)).toContain(
			"The one signer above can.",
		);
		expect(CREATE.button(TREASURY, 2, 3)).toMatch(
			/^Convert 0x.* into a 2-of-3 treasury$/,
		);
		expect(CREATE.inWallet(2, 3)).toContain(
			"3 signer addresses and the threshold, 2",
		);
		expect(CREATE.inWallet(1, 1)).toContain("1 signer address and");
		expect(CREATE.info).toHaveLength(4);
		expect(CREATE.info[0]).toContain("HyperCore only");
		expect(CREATE.info[2]).toContain("Keep this account's key");
	});
});

describe("refusalText", () => {
	it("has a sentence for every refusal a conversion can meet, by the catalogue's id", () => {
		const ids = new Set(ERROR_CATALOG.map((e) => e.id));
		for (const id of REFUSAL_IDS) expect(ids.has(id), id).toBe(true);
		expect(refusalText("multisig-signer-kind", "")).toContain(
			"vault or a sub-account",
		);
	});
	it("quotes an answer it has no sentence for", () => {
		expect(refusalText("something-else", "Unexpected error")).toBe(
			'Hyperliquid answered: "Unexpected error".',
		);
	});
});
