import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type AccountInput,
	allApiWallets,
	assessAccount,
	formatHype,
	unnamedApiWallet,
} from "../../src/multisig/index.ts";
import { A, B, C, codes, NOW, POLICY, SPARE, TREASURY } from "./_helpers.ts";

const base = (over: Partial<AccountInput> = {}): AccountInput => ({
	address: TREASURY,
	policy: POLICY,
	role: null,
	agents: [],
	signerPolicies: { [A]: null, [B]: null, [C]: null },
	evmBalanceWei: 0n,
	now: NOW,
	...over,
});

describe("assessAccount: multi-sig accounts", () => {
	it("a healthy 2-of-3 has no flags and a plain summary", () => {
		const r = assessAccount(base());
		expect(r.isMultiSig).toBe(true);
		expect(r.threshold).toBe(2);
		expect(r.summary).toBe("2 of 3 authorized users must sign every action.");
		expect(r.signers.map((s) => s.nested)).toEqual([false, false, false]);
		expect(r.flags).toEqual([]);
	});
	it("lockout.all_keys_required when threshold equals the signer count (not for 1-of-1)", () => {
		expect(
			codes(assessAccount(base({ policy: { ...POLICY, threshold: 3 } })).flags),
		).toEqual(["lockout.all_keys_required"]);
		expect(
			codes(
				assessAccount(
					base({
						policy: { ...POLICY, authorizedUsers: [A], threshold: 1 },
						signerPolicies: { [A]: null },
					}),
				).flags,
			),
		).toEqual([]);
		expect(
			assessAccount(
				base({
					policy: { ...POLICY, authorizedUsers: [A], threshold: 1 },
					signerPolicies: { [A]: null },
				}),
			).summary,
		).toBe("1 of 1 authorized user must sign every action.");
	});
	it("account.single_signer for 1-of-n", () => {
		expect(
			codes(assessAccount(base({ policy: { ...POLICY, threshold: 1 } })).flags),
		).toEqual(["account.single_signer"]);
	});
	it("signers.at_max at ten signers", () => {
		const ten = Array.from(
			{ length: 10 },
			(_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as typeof A,
		);
		const r = assessAccount(
			base({
				policy: { ...POLICY, authorizedUsers: ten, threshold: 2 },
				signerPolicies: Object.fromEntries(ten.map((a) => [a, null])),
			}),
		);
		expect(codes(r.flags)).toEqual(["signers.at_max"]);
	});
	it("signers.nested when a signer is itself a multi-sig; unchecked signers are reported", () => {
		const r = assessAccount(
			base({ signerPolicies: { [A]: POLICY, [B]: null } }),
		);
		expect(r.signers.map((s) => s.nested)).toEqual(
			[A, B, C]
				.sort()
				.map((a) => (a === A ? true : a === B ? false : "unchecked")),
		);
		expect(codes(r.flags)).toEqual([
			"signers.nested",
			"signers.nested_unchecked",
		]);
		expect(r.flags[0]?.message).toContain(A);
		// a signer whose own policy is an empty (reverted) set is not nested
		expect(
			assessAccount(
				base({
					signerPolicies: {
						[A]: { authorizedUsers: [], threshold: 0, observedAt: 0 },
						[B]: null,
						[C]: null,
					},
				}),
			).signers[0]?.nested,
		).toBe(false);
	});
	it("agents: bypass warning for live ones, info for expired ones, warning when unknown", () => {
		const live = {
			name: "lab",
			address: SPARE.toUpperCase().replace("0X", "0x"),
			validUntil: NOW + 1,
		};
		const dead = { name: "", address: B, validUntil: NOW - 1 };
		const r = assessAccount(base({ agents: [live, dead] }));
		expect(r.agents).toEqual([
			{ ...live, address: SPARE, expired: false },
			{ ...dead, expired: true },
		]);
		expect(codes(r.flags)).toEqual([
			"account.agents_bypass",
			"account.agent_expired",
		]);
		expect(r.flags[0]?.message).toContain("lab");
		expect(r.flags[1]?.message).toContain("main");
		expect(codes(assessAccount(base({ agents: null })).flags)).toEqual([
			"account.agents_unknown",
		]);
		expect(
			assessAccount(
				base({ agents: [live, { ...live, name: "two", address: C }] }),
			).flags[0]?.message,
		).toContain("2 approved API wallets");
	});
	it("an unnamed live agent is called main; two nested signers are described in the plural", () => {
		const r = assessAccount(
			base({ agents: [{ name: "", address: SPARE, validUntil: NOW + 1 }] }),
		);
		expect(r.flags[0]?.message).toContain("(main)");
		const two = assessAccount(
			base({ signerPolicies: { [A]: POLICY, [B]: POLICY, [C]: null } }),
		);
		expect(two.flags[0]?.message).toContain("are themselves");
	});
	it("HyperEVM: unchecked info, zero is silent, a balance under the dead key warns", () => {
		expect(codes(assessAccount(base({ evmBalanceWei: null })).flags)).toEqual([
			"evm.unchecked",
		]);
		expect(codes(assessAccount(base({ evmBalanceWei: 0n })).flags)).toEqual([]);
		const r = assessAccount(
			base({ evmBalanceWei: 1_500_000_000_000_000_000n }),
		);
		expect(codes(r.flags)).toEqual(["account.evm_funds_under_dead_key"]);
		expect(r.flags[0]?.message).toContain("1.5 HYPE");
	});
	it("lowercases the address", () => {
		expect(
			assessAccount(
				base({
					address: TREASURY.toUpperCase().replace(
						"0X",
						"0x",
					) as typeof TREASURY,
				}),
			).address,
		).toBe(TREASURY);
	});
});

describe("assessAccount: not a multi-sig", () => {
	const roles = [
		[null, "Not a multi-sig user."],
		[{ role: "user" }, "A normal user"],
		[{ role: "agent", data: { user: A } }, `An API wallet (agent) of ${A}`],
		[{ role: "vault" }, "A vault"],
		[{ role: "subAccount", data: { master: A } }, `A sub-account of ${A}`],
		[{ role: "missing" }, "Never seen on Hyperliquid"],
	] as const;
	for (const [role, text] of roles) {
		it(`role ${role ? role.role : "unknown"}`, () => {
			const r = assessAccount(
				base({ policy: null, role: role as AccountInput["role"] }),
			);
			expect(r.isMultiSig).toBe(false);
			expect(r.threshold).toBeNull();
			expect(r.signers).toEqual([]);
			expect(r.summary).toContain(text);
			expect(r.flags[0]?.code).toBe("account.not_multisig");
			expect(r.flags[0]?.message).toContain(text);
		});
	}
	it("a reverted policy (empty set) counts as not multi-sig; agent flags still apply, EVM flags do not", () => {
		const r = assessAccount(
			base({
				policy: { authorizedUsers: [], threshold: 0, observedAt: NOW },
				role: { role: "user" },
				agents: [{ name: "lab", address: SPARE, validUntil: NOW + 1 }],
				evmBalanceWei: null,
			}),
		);
		expect(r.isMultiSig).toBe(false);
		expect(codes(r.flags)).toEqual([
			"account.not_multisig",
			"account.agents_bypass",
		]);
		// a balance under a normal user's key is that user's own business
		expect(
			codes(
				assessAccount(
					base({
						policy: null,
						role: { role: "user" },
						evmBalanceWei: 1_000_000_000_000_000_000n,
					}),
				).flags,
			),
		).toEqual(["account.not_multisig"]);
	});
});

describe("formatHype", () => {
	it("trims trailing zeros and keeps six decimals", () => {
		expect(formatHype(0n)).toBe("0");
		expect(formatHype(1_000_000_000_000_000_000n)).toBe("1");
		expect(formatHype(1_234_567_890_000_000_000n)).toBe("1.234567");
		expect(formatHype(500_000_000_000_000n)).toBe("0.0005");
	});
});

describe("the API wallet approved without a name (fixtures/multisig/agent-unnamed.json)", () => {
	interface Step {
		about: string;
		action: { agentAddress: string; agentName: string };
		answer: { status: string };
		after: {
			extraAgents: { name: string; address: string; validUntil: number }[];
			webData3: unknown;
			userRole: { role: string };
		};
	}
	const fx = JSON.parse(
		readFileSync(
			new URL("../../fixtures/multisig/agent-unnamed.json", import.meta.url),
			"utf8",
		),
	) as { steps: [Step, Step] };
	const [approved, removed] = fx.steps;

	it("is not in `extraAgents`, and is read from `webData3`", () => {
		expect(approved.answer.status).toBe("ok");
		expect(approved.action.agentName).toBe("");
		// the list of named wallets is the same before and after
		expect(approved.after.extraAgents).toEqual(removed.after.extraAgents);
		expect(approved.after.extraAgents.map((a) => a.address)).not.toContain(
			approved.action.agentAddress,
		);
		expect(unnamedApiWallet(approved.after.webData3)).toEqual({
			name: "",
			address: approved.action.agentAddress,
			validUntil: 1793047055525,
		});
		expect(approved.after.userRole.role).toBe("agent");
	});

	it("is listed first, before the named ones", () => {
		const all = allApiWallets(
			approved.after.extraAgents,
			approved.after.webData3,
		);
		expect(all?.map((a) => a.name)).toEqual(["", "lab", "rebalancer"]);
		expect(all?.[0]?.address).toBe(approved.action.agentAddress);
	});

	it("is gone after an approval of the zero address with no name", () => {
		expect(removed.answer.status).toBe("ok");
		expect(removed.action.agentAddress).toBe(`0x${"0".repeat(40)}`);
		expect(removed.action.agentName).toBe("");
		expect(unnamedApiWallet(removed.after.webData3)).toBeNull();
		expect(
			allApiWallets(removed.after.extraAgents, removed.after.webData3),
		).toEqual(removed.after.extraAgents);
		expect(removed.after.userRole.role).toBe("missing");
	});

	it("does not pass a list off as complete when the answer does not say", () => {
		const named = approved.after.extraAgents;
		for (const unreadable of [
			null,
			undefined,
			"webData3",
			{},
			{ userState: null },
			{ userState: {} },
			// the field is there, and is no address
			{ userState: { agentAddress: 7, agentValidUntil: 1 } },
			{ userState: { agentAddress: "0x1234", agentValidUntil: 1 } },
			// an address with no expiry
			{
				userState: {
					agentAddress: approved.action.agentAddress,
					agentValidUntil: null,
				},
			},
		]) {
			expect(unnamedApiWallet(unreadable)).toBeUndefined();
			expect(allApiWallets(named, unreadable)).toBeNull();
		}
	});

	it("reads an address in any case, and counts one key approved both ways once", () => {
		const upper = approved.action.agentAddress
			.toUpperCase()
			.replace("0X", "0x");
		const web = { userState: { agentAddress: upper, agentValidUntil: 5 } };
		expect(unnamedApiWallet(web)?.address).toBe(approved.action.agentAddress);
		const both = [{ name: "bot", address: upper, validUntil: 9 }];
		expect(allApiWallets(both, web)).toEqual(both);
		expect(allApiWallets([], web)).toEqual([
			{ name: "", address: approved.action.agentAddress, validUntil: 5 },
		]);
	});
});
