/**
 * Vaults, replayed offline. fixtures/multisig/vaults.json holds 17 requests
 * sent through 2-of-3 multi-sigs on testnet, what Hyperliquid reported about
 * the account and the vault before and after each, and its answers. The
 * module's judge has to give Hyperliquid's own answer from the facts read
 * before each request, and its "what a step leaves behind" what was read after.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	afterVaultStep,
	describeAction,
	explainExchangeError,
	isHlp,
	judgeVaultSteps,
	type PlainObject,
	parseVaultDetails,
	parseVaultEquities,
	planDeposit,
	riskFlags,
	usdcToUsd,
	usdToUsdc,
	type VaultFacts,
	type VaultStep,
	vaultActionOf,
	vaultFields,
	vaultLockup,
	vaultLockupLine,
	vaultLockupOf,
	vaultRefusal,
} from "../../src/multisig/index.ts";
import {
	HLP_VAULT,
	VAULT_LOCKUP,
	VAULT_MIN_DEPOSIT_USDC,
	VAULT_RULES,
} from "../../src/rules/vaults.ts";

interface Read {
	mode: string;
	perpsWithdrawable: string;
	spotUsdc: { total: string; hold: string };
	deposit: { equity: string; lockedUntil: number } | null;
	maxWithdrawable: number | null;
	vault: {
		known: boolean;
		isClosed: boolean | null;
		allowDeposits: boolean | null;
		name?: string;
		leader?: string;
	};
}
interface Step {
	about: string;
	account: "manual" | "unified";
	action: PlainObject;
	sentAt: number;
	before: Read;
	after: Read;
	answer: { status: string; response: unknown };
	ledger: { time: number; delta: Record<string, unknown> } | null;
}
const fx = JSON.parse(
	readFileSync(
		new URL("../../fixtures/multisig/vaults.json", import.meta.url),
		"utf8",
	),
) as {
	vaults: Record<string, string>;
	notes: {
		manualBefore: {
			perpsWithdrawable: string;
			spotUsdc: string;
			tried: string;
		};
	};
	steps: Step[];
};
const USER_VAULT = fx.vaults.USER_VAULT as string;
const HLP = fx.vaults.HLP as string;
const SIX = (n: number) => n.toFixed(6).replace(/\.?0+$/, "") || "0";

/** The step a recorded action is: the vault action, or the move to perps before it. */
function stepOf(action: PlainObject): VaultStep {
	const vault = vaultActionOf(action);
	if (vault) return vault;
	if (action.type === "usdClassTransfer" && action.toPerp === true)
		return { kind: "toPerps", amount: String(action.amount) };
	throw new Error(`not a vault step: ${String(action.type)}`);
}
/** The facts the page would have read before a request. */
function factsOf(read: Read, action: PlainObject): VaultFacts {
	const unified = read.mode === "unifiedAccount";
	const free = SIX(Number(read.spotUsdc.total) - Number(read.spotUsdc.hold));
	const vault = String(action.vaultAddress ?? USER_VAULT);
	return {
		unified,
		perps: unified ? free : read.perpsWithdrawable,
		spot: free,
		vault: read.vault.known
			? parseVaultDetails({
					name: read.vault.name ?? "A vault",
					vaultAddress: vault,
					leader: read.vault.leader ?? vault,
					isClosed: read.vault.isClosed,
					allowDeposits: read.vault.allowDeposits,
				})
			: { kind: "none" },
		deposit: read.deposit ? { vault, ...read.deposit } : "none",
		maxWithdrawable:
			read.maxWithdrawable === null ? null : SIX(read.maxWithdrawable),
	};
}
const refusalOf = (a: Step["answer"]): string | null =>
	a.status === "err" ? explainExchangeError(a, 200).id : null;
const near = (a: string | null | undefined, b: string, cents = 1) =>
	expect(Math.abs(Number(a) - Number(b)) * 100).toBeLessThan(cents);

describe("the vault lab (fixtures/multisig/vaults.json)", () => {
	it("covers a unified and a manual treasury, every refusal, and the lockup from both sides", () => {
		expect(fx.steps).toHaveLength(17);
		expect(new Set(fx.steps.map((s) => s.account))).toEqual(
			new Set(["unified", "manual"]),
		);
		expect(
			new Set(fx.steps.map((s) => refusalOf(s.answer)).filter(Boolean)),
		).toEqual(
			new Set([
				"vault-equity",
				"vault-min-deposit",
				"vault-closed",
				"vault-no-deposits",
				"vault-unregistered",
				"deposit-funds",
				"vault-lockup",
			]),
		);
		expect(fx.vaults.HLP).toBe(HLP_VAULT.testnet);
	});

	it.each(
		fx.steps.map((s, i) => [`${i}. ${s.about}`, s] as const),
	)("%s", (_name, s) => {
		const step = stepOf(s.action);
		const facts = factsOf(s.before, s.action);
		const said = refusalOf(s.answer);
		if (s.about === "withdraw everything that can be withdrawn") {
			// A deposit's worth moves with the vault: the request was for 22
			// millionths more than the read a moment before showed, and by the
			// time it arrived the deposit was worth that. From the stale read the
			// judge would stop it; from the worth it had, it does not.
			expect(said).toBeNull();
			const asked = step.amount;
			const read = (facts.deposit as { equity: string }).equity;
			expect(Number(asked) - Number(read)).toBeLessThan(0.0001);
			expect(vaultRefusal(step, facts, s.sentAt)).toBe("vault-equity");
			expect(
				vaultRefusal(
					step,
					{
						...facts,
						maxWithdrawable: asked,
						deposit: { vault: USER_VAULT, equity: asked, lockedUntil: 0 },
					},
					s.sentAt,
				),
			).toBeNull();
			return;
		}
		expect(vaultRefusal(step, facts, s.sentAt)).toBe(said);
		if (said) {
			// nothing moved
			expect(s.ledger).toBeNull();
			expect(s.after.deposit?.lockedUntil ?? null).toBe(
				s.before.deposit?.lockedUntil ?? null,
			);
			return;
		}
		// what the step leaves behind, at the moment Hyperliquid carried it out
		const at = (s.ledger as { time: number }).time;
		const left = afterVaultStep(facts, step, at, "testnet");
		const after = factsOf(s.after, s.action);
		near(left.perps, after.perps as string, s.account === "manual" ? 2 : 1);
		if (step.kind === "toPerps") {
			expect(left.spot).toBe(after.spot);
			expect(s.ledger?.delta).toMatchObject({
				type: "accountClassTransfer",
				toPerp: true,
			});
			return;
		}
		const held = left.deposit as { equity: string; lockedUntil: number };
		near(held.equity, (s.after.deposit as { equity: string }).equity);
		// a deposit, a first one or an addition, locks all of it from that moment; a withdrawal moves no lockup
		expect(held.lockedUntil).toBe(s.after.deposit?.lockedUntil);
		if (step.kind === "deposit") {
			expect(held.lockedUntil).toBe(at + VAULT_LOCKUP.user.testnet.ms);
			expect(s.ledger?.delta).toEqual({
				type: "vaultDeposit",
				vault: step.vault,
				usdc: `${Number(step.amount).toFixed(1)}`,
			});
		} else {
			expect(s.ledger?.delta).toMatchObject({
				type: "vaultWithdraw",
				vault: step.vault,
			});
			// Hyperliquid's row can say a millionth less than was asked: 3 USDC
			// asked for stands there as "2.999999"
			const recorded = Number(
				(s.ledger?.delta as { requestedUsd: string }).requestedUsd,
			);
			expect(recorded).toBeLessThanOrEqual(Number(step.amount));
			expect(Number(step.amount) - recorded).toBeLessThan(0.000002);
			// less the leader's share of the profit
			expect(
				Number(
					(s.ledger?.delta as { netWithdrawnUsd: string }).netWithdrawnUsd,
				),
			).toBeLessThanOrEqual(Number(step.amount));
		}
	});

	it("plans the manual treasury's deposit as two steps, which Hyperliquid then took", () => {
		const {
			perpsWithdrawable: perps,
			spotUsdc: spot,
			tried,
		} = fx.notes.manualBefore;
		// what was tried in one step was refused: more than perps could release
		const one = fx.steps.find((s) => s.account === "manual") as Step;
		expect(refusalOf(one.answer)).toBe("deposit-funds");
		const plan = planDeposit({
			amount: tried,
			vault: USER_VAULT,
			unified: false,
			perps,
			spot,
		});
		expect(plan).toEqual([
			{ kind: "toPerps", amount: "0.799535" },
			{ kind: "deposit", vault: USER_VAULT, amount: tried },
		]);
		// judged in order from what was read before the first: neither is refused
		const facts = factsOf(one.before, one.action);
		expect(judgeVaultSteps(plan, facts, one.sentAt, "testnet")).toBeNull();
		// the deposit alone is, as Hyperliquid said
		expect(
			judgeVaultSteps(plan.slice(1), facts, one.sentAt, "testnet"),
		).toEqual({ index: 0, refusal: "deposit-funds" });
		// and the recorded pair (3 to perps, then 5 in) went through in that order
		const pair = fx.steps.filter((s) => s.account === "manual").slice(1, 3);
		expect(pair.map((s) => s.answer.status)).toEqual(["ok", "ok"]);
		expect(pair.map((s) => stepOf(s.action).kind)).toEqual([
			"toPerps",
			"deposit",
		]);
	});

	it("held HLP's deposit for four days and the user vault's for 20 seconds", () => {
		const hlp = fx.steps.find((s) =>
			s.about.startsWith("withdraw from HLP"),
		) as Step;
		expect(hlp.action.vaultAddress).toBe(HLP);
		expect(refusalOf(hlp.answer)).toBe("vault-lockup");
		// still locked days after the request
		expect(
			(hlp.before.deposit as { lockedUntil: number }).lockedUntil - hlp.sentAt,
		).toBeGreaterThan(3 * 24 * 3_600_000);
		expect(vaultLockup(HLP, "testnet")).toEqual({
			ms: 4 * 24 * 3_600_000,
			measured: true,
		});
		expect(vaultLockup(USER_VAULT, "testnet")).toEqual({
			ms: 20_000,
			measured: true,
		});
		// mainnet's lengths are Hyperliquid's documentation, not a measurement
		expect(vaultLockup(HLP_VAULT.mainnet, "mainnet")).toEqual({
			ms: 4 * 24 * 3_600_000,
			measured: false,
		});
		expect(vaultLockup(USER_VAULT, "mainnet")).toEqual({
			ms: 24 * 3_600_000,
			measured: false,
		});
		expect(isHlp(HLP.toUpperCase().replace("0X", "0x"), "testnet")).toBe(true);
		// testnet's HLP is no HLP on mainnet
		expect(isHlp(HLP, "mainnet")).toBe(false);
		expect(VAULT_RULES.version).toBe("1.0.0");
	});
});

describe("amounts", () => {
	it("reads the action's integer as USDC", () => {
		expect(usdToUsdc(5_000_000)).toBe("5");
		expect(usdToUsdc(5_050_000)).toBe("5.05");
		expect(usdToUsdc(1)).toBe("0.000001");
		expect(usdToUsdc(8_011_514)).toBe("8.011514");
		for (const bad of [
			0,
			-1,
			1.5,
			"5000000",
			null,
			undefined,
			2 ** 60,
			Number.NaN,
		])
			expect(usdToUsdc(bad)).toBeNull();
	});
	it("writes USDC as the action's integer, exactly or not at all", () => {
		expect(usdcToUsd("5")).toBe(5_000_000);
		expect(usdcToUsd("5.05")).toBe(5_050_000);
		expect(usdcToUsd("0.000001")).toBe(1);
		expect(usdcToUsd("50000")).toBe(50_000_000_000);
		for (const bad of ["0", "-5", "0.0000001", "abc", "", "9999999999999"])
			expect(usdcToUsd(bad)).toBeNull();
		// there and back
		for (const usd of [1, 999_999, 5_000_000, 123_456_789])
			expect(usdcToUsd(usdToUsdc(usd) as string)).toBe(usd);
	});
});

describe("the action", () => {
	const deposit = {
		type: "vaultTransfer",
		vaultAddress: USER_VAULT,
		isDeposit: true,
		usd: 5_000_000,
	};
	it("is read both ways, in the field order Hyperliquid hashes", () => {
		expect(vaultActionOf(deposit)).toEqual({
			kind: "deposit",
			vault: USER_VAULT,
			amount: "5",
		});
		expect(vaultActionOf({ ...deposit, isDeposit: false })?.kind).toBe(
			"withdraw",
		);
		expect(
			vaultActionOf({
				...deposit,
				vaultAddress: USER_VAULT.toUpperCase().replace("0X", "0x"),
			})?.vault,
		).toBe(USER_VAULT);
		const fields = vaultFields({
			kind: "deposit",
			vault: USER_VAULT,
			amount: "5",
		});
		expect(fields).toEqual(deposit);
		expect(Object.keys(fields ?? {})).toEqual([
			"type",
			"vaultAddress",
			"isDeposit",
			"usd",
		]);
		expect(
			vaultFields({ kind: "withdraw", vault: USER_VAULT, amount: "1.5" }),
		).toMatchObject({ isDeposit: false, usd: 1_500_000 });
		expect(
			vaultFields({ kind: "deposit", vault: USER_VAULT, amount: "0.0000001" }),
		).toBeNull();
	});
	it("is nothing else", () => {
		for (const not of [
			null,
			"vaultTransfer",
			[deposit],
			{ ...deposit, type: "subAccountTransfer" },
			{ ...deposit, vaultAddress: "0x1234" },
			{ ...deposit, vaultAddress: 7 },
			{ ...deposit, usd: "5000000" },
			{ ...deposit, usd: 0 },
			{ ...deposit, isDeposit: "true" },
		])
			expect(vaultActionOf(not)).toBeNull();
	});
	it("is said in words, with its lockup and its risk, and marked as moving funds out", () => {
		const d = describeAction(deposit, { network: "testnet" });
		expect(d.headline).toBe(`Deposit 5 USDC into vault ${USER_VAULT}`);
		expect(d.lines).toEqual([
			"It cannot be withdrawn for 20 seconds after it is made or added to.",
			"A vault deposit can lose value: the vault's leader trades with it.",
			"It is taken from the perps balance, or from the one balance of a unified account.",
		]);
		expect(d.flags).toEqual(["funds_out"]);
		expect(d.parties).toEqual([{ role: "vault", address: USER_VAULT }]);
		// without the reader's network, both lengths
		expect(describeAction(deposit).lines[0]).toBe(
			"It cannot be withdrawn for 1 day after it is made or added to (20 seconds on testnet).",
		);
		expect(describeAction(deposit, { network: "mainnet" }).lines[0]).toBe(
			"It cannot be withdrawn for 1 day after it is made or added to.",
		);
		// HLP is known by its address, on either network
		const hlp = describeAction({ ...deposit, vaultAddress: HLP_VAULT.mainnet });
		expect(hlp.headline).toBe(
			`Deposit 5 USDC into HLP, Hyperliquid's own vault, ${HLP_VAULT.mainnet}`,
		);
		expect(hlp.lines[0]).toBe(
			"It cannot be withdrawn for 4 days after it is made or added to.",
		);
		expect(vaultLockupLine(HLP, null)).toContain("4 days");
		const w = describeAction({ ...deposit, isDeposit: false });
		expect(w.headline).toBe(`Withdraw 5 USDC from vault ${USER_VAULT}`);
		expect(w.lines[0]).toContain("until the deposit's lockup has ended");
		expect(w.lines[1]).toContain("less the leader's share of the profit");
		// money coming back is no money going out
		expect(w.flags).toEqual([]);
		expect(riskFlags({ type: "vaultTransfer" })).toEqual([]);
	});
});

describe("what Hyperliquid reports", () => {
	it("reads an account's deposits, leaving out a row it cannot read", () => {
		expect(
			parseVaultEquities([
				{
					vaultAddress: USER_VAULT.toUpperCase().replace("0X", "0x"),
					equity: "5.0",
					lockedUntilTimestamp: 1791836854652,
				},
				{ vaultAddress: HLP, equity: "10.000170", lockedUntilTimestamp: 5 },
				{ vaultAddress: "0x12", equity: "1", lockedUntilTimestamp: 5 },
				{ vaultAddress: HLP, equity: "much", lockedUntilTimestamp: 5 },
				{ vaultAddress: HLP, equity: "1", lockedUntilTimestamp: "soon" },
				null,
			]),
		).toEqual([
			{ vault: USER_VAULT, equity: "5", lockedUntil: 1791836854652 },
			{ vault: HLP, equity: "10.00017", lockedUntil: 5 },
		]);
		expect(parseVaultEquities([])).toEqual([]);
		for (const not of [null, undefined, {}, "[]"])
			expect(parseVaultEquities(not)).toBeNull();
	});

	const raw = {
		name: "Crazy Franck",
		vaultAddress: USER_VAULT,
		leader: "0x84014DCF12598d4760349ade2bfd35d815c18c46",
		description: "High leverage mean reversion strategy",
		portfolio: [
			[
				"day",
				{
					accountValueHistory: [
						[100, "142336.255125"],
						[200, "142444.19"],
						"not a point",
						["x", "1"],
						[300, "much"],
					],
				},
			],
			["week", { accountValueHistory: [[50, "1"]] }],
			[
				"allTime",
				{
					accountValueHistory: [
						[7, "10.0"],
						[200, "142000"],
					],
				},
			],
		],
		apr: -0.0201,
		followerState: {
			user: "0xf8365a35694f401a554e4ffa51b5afe3b203d148",
			vaultEquity: "0.0006535267",
			pnl: "-0.0000004733",
			allTimePnl: "0.0005885267",
			daysFollowing: 0,
			vaultEntryTime: 1791836834652,
			lockupUntil: 1791836854652,
		},
		leaderFraction: 0.157,
		leaderCommission: 0.1,
		maxWithdrawable: 0.000653,
		isClosed: false,
		relationship: { type: "normal" },
		allowDeposits: true,
		alwaysCloseOnWithdraw: true,
	};
	it("reads a vault's details as far as a depositor needs them", () => {
		expect(parseVaultDetails(raw)).toEqual({
			kind: "vault",
			vault: {
				address: USER_VAULT,
				name: "Crazy Franck",
				leader: "0x84014dcf12598d4760349ade2bfd35d815c18c46",
				commission: 0.1,
				apr: -0.0201,
				// the last point of the day's history, and the first of all time
				value: "142444.19",
				since: 7,
				closed: false,
				takesDeposits: true,
				relationship: "normal",
				mine: {
					equity: "0.0006535267",
					pnl: "0.0005885267",
					since: 1791836834652,
					lockedUntil: 1791836854652,
				},
				maxWithdrawable: "0.000653",
			},
		});
	});
	it("a vault's name is its leader's own word: what does not show is dropped", () => {
		const rlo = String.fromCodePoint(0x202e);
		const named = (name: string) => {
			const read = parseVaultDetails({ ...raw, name });
			return read.kind === "vault" ? read.vault.name : null;
		};
		expect(named(`HLP${rlo}`)).toBe("HLP");
		expect(named("x".repeat(200))).toBe(`${"x".repeat(80)}…`);
	});
	it("says so when there is no vault at the address, and when the answer is not one", () => {
		expect(parseVaultDetails(null)).toEqual({ kind: "none" });
		for (const not of [
			undefined,
			"vault",
			[],
			{},
			{ ...raw, vaultAddress: "0x12" },
			{ ...raw, leader: null },
			{ ...raw, name: 7 },
		])
			expect(parseVaultDetails(not)).toEqual({ kind: "unreadable" });
	});
	it("copes with what a vault may leave out", () => {
		const bare = parseVaultDetails({
			name: "HLP",
			vaultAddress: HLP,
			leader: HLP,
			portfolio: [
				["allTime", { accountValueHistory: [[9, "5"]] }],
				"junk",
				["day", {}],
			],
			followerState: null,
			maxWithdrawable: 0,
			isClosed: true,
			allowDeposits: false,
			relationship: { type: "parent", data: {} },
		});
		expect(bare).toMatchObject({
			kind: "vault",
			vault: {
				commission: null,
				apr: null,
				// no day history: the last point of all time
				value: "5",
				since: 9,
				closed: true,
				takesDeposits: false,
				relationship: "parent",
				mine: null,
				// nobody asked for an account
				maxWithdrawable: null,
			},
		});
		const none = parseVaultDetails({
			name: "x",
			vaultAddress: HLP,
			leader: HLP,
			relationship: { type: "odd" },
			followerState: { vaultEquity: "1", allTimePnl: 5, vaultEntryTime: "y" },
			maxWithdrawable: "1.5",
		});
		expect(none).toMatchObject({
			vault: {
				value: null,
				since: null,
				// nothing said against deposits
				takesDeposits: true,
				closed: false,
				relationship: null,
				mine: { equity: "1", pnl: "5", since: null, lockedUntil: null },
				maxWithdrawable: "1.5",
			},
		});
		expect(
			parseVaultDetails({ ...raw, portfolio: "none", followerState: {} }),
		).toMatchObject({ vault: { value: null, mine: null } });
		expect(
			parseVaultDetails({
				...raw,
				portfolio: [["day", { accountValueHistory: "x" }]],
			}),
		).toMatchObject({ vault: { value: null } });
	});
});

describe("planDeposit", () => {
	const plan = (over: Partial<Parameters<typeof planDeposit>[0]> = {}) =>
		planDeposit({
			amount: "50",
			vault: USER_VAULT,
			unified: false,
			perps: "100",
			spot: "0",
			...over,
		});
	const deposit = { kind: "deposit", vault: USER_VAULT, amount: "50" };
	it("is one step when perps can release it, and always in a unified account", () => {
		expect(plan()).toEqual([deposit]);
		expect(plan({ perps: "50" })).toEqual([deposit]);
		expect(plan({ unified: true, perps: "0", spot: "100" })).toEqual([deposit]);
	});
	it("moves the missing part from spot first in a manual account", () => {
		expect(plan({ perps: "20", spot: "100" })).toEqual([
			{ kind: "toPerps", amount: "30" },
			deposit,
		]);
		expect(plan({ perps: "0", spot: "50" })).toEqual([
			{ kind: "toPerps", amount: "50" },
			deposit,
		]);
		expect(plan({ perps: "49.999999", spot: "1" })[0]).toEqual({
			kind: "toPerps",
			amount: "0.000001",
		});
	});
	it("stays one step where spot cannot make up the difference, or a figure was not read", () => {
		expect(plan({ perps: "20", spot: "29.99" })).toEqual([deposit]);
		expect(plan({ perps: null, spot: "100" })).toEqual([deposit]);
		expect(plan({ perps: "20", spot: null })).toEqual([deposit]);
	});
});

describe("the judge", () => {
	const vault = parseVaultDetails({
		name: "V",
		vaultAddress: USER_VAULT,
		leader: USER_VAULT,
	});
	const facts = (over: Partial<VaultFacts> = {}): VaultFacts => ({
		unified: false,
		perps: "100",
		spot: "100",
		vault,
		deposit: { vault: USER_VAULT, equity: "40", lockedUntil: 1_000 },
		...over,
	});
	const dep = (amount: string): VaultStep => ({
		kind: "deposit",
		vault: USER_VAULT,
		amount,
	});
	const wd = (amount: string): VaultStep => ({
		kind: "withdraw",
		vault: USER_VAULT,
		amount,
	});

	it("refuses nothing it does not know", () => {
		const blind = facts({
			perps: null,
			spot: null,
			vault: null,
			deposit: null,
		});
		expect(vaultRefusal(dep("50"), blind, 0)).toBeNull();
		expect(vaultRefusal(wd("50"), blind, 0)).toBeNull();
		expect(
			vaultRefusal({ kind: "toPerps", amount: "50" }, blind, 0),
		).toBeNull();
		// an answer that could not be read is no "not a vault"
		expect(
			vaultRefusal(dep("50"), facts({ vault: { kind: "unreadable" } }), 0),
		).toBeNull();
	});

	it("names a deposit's refusals in a fixed order", () => {
		const closed = parseVaultDetails({
			name: "V",
			vaultAddress: USER_VAULT,
			leader: USER_VAULT,
			isClosed: true,
			allowDeposits: false,
		});
		const shut = parseVaultDetails({
			name: "V",
			vaultAddress: USER_VAULT,
			leader: USER_VAULT,
			allowDeposits: false,
		});
		expect(vaultRefusal(dep("1"), facts({ vault: { kind: "none" } }), 0)).toBe(
			"vault-unregistered",
		);
		expect(vaultRefusal(dep("1"), facts({ vault: closed }), 0)).toBe(
			"vault-closed",
		);
		expect(vaultRefusal(dep("1"), facts({ vault: shut }), 0)).toBe(
			"vault-no-deposits",
		);
		expect(vaultRefusal(dep("4.999999"), facts(), 0)).toBe("vault-min-deposit");
		expect(vaultRefusal(dep(VAULT_MIN_DEPOSIT_USDC), facts(), 0)).toBeNull();
		expect(vaultRefusal(dep("100.000001"), facts(), 0)).toBe("deposit-funds");
		expect(vaultRefusal(dep("100"), facts(), 0)).toBeNull();
	});

	it("holds a withdrawal back until the lockup has ended, then asks what is there", () => {
		expect(vaultRefusal(wd("1"), facts(), 999)).toBe("vault-lockup");
		expect(vaultRefusal(wd("1"), facts(), 1_000)).toBeNull();
		expect(vaultRefusal(wd("40.000001"), facts(), 1_000)).toBe("vault-equity");
		expect(vaultRefusal(wd("40"), facts(), 1_000)).toBeNull();
		// what Hyperliquid says can be taken out now is the limit when it said so
		expect(
			vaultRefusal(wd("40"), facts({ maxWithdrawable: "39" }), 1_000),
		).toBe("vault-equity");
		expect(vaultRefusal(wd("1"), facts({ deposit: "none" }), 0)).toBe(
			"vault-equity",
		);
		expect(
			vaultRefusal(wd("1"), facts({ vault: { kind: "none" } }), 1_000),
		).toBe("vault-unregistered");
		expect(
			vaultLockupOf(wd("1") as never, [
				{ vault: USER_VAULT, equity: "40", lockedUntil: 1_000 },
			]),
		).toBe(1_000);
		expect(vaultLockupOf(wd("1") as never, [])).toBeNull();
		expect(
			vaultLockupOf(dep("5") as never, [
				{ vault: USER_VAULT, equity: "40", lockedUntil: 1_000 },
			]),
		).toBeNull();
	});

	it("carries each step's result into the next", () => {
		const two: VaultStep[] = [{ kind: "toPerps", amount: "30" }, dep("50")];
		const short = facts({ perps: "20", spot: "30" });
		expect(judgeVaultSteps(two, short, 0, "testnet")).toBeNull();
		expect(
			judgeVaultSteps(two, facts({ perps: "20", spot: "29" }), 0, "testnet"),
		).toEqual({ index: 0, refusal: "transfer-balance" });
		expect(
			judgeVaultSteps(two, facts({ perps: "19", spot: "30" }), 0, "testnet"),
		).toEqual({ index: 1, refusal: "deposit-funds" });
		expect(judgeVaultSteps([], short, 0, "testnet")).toBeNull();
		// a first deposit, then one that would need more than is left
		expect(
			judgeVaultSteps(
				[dep("60"), dep("60")],
				facts({ deposit: "none" }),
				0,
				"testnet",
			),
		).toEqual({ index: 1, refusal: "deposit-funds" });
		// a deposit locks: a withdrawal right behind it is refused
		expect(
			judgeVaultSteps([dep("10"), wd("1")], facts(), 5_000, "testnet"),
		).toEqual({ index: 1, refusal: "vault-lockup" });
	});

	it("says what each step leaves behind", () => {
		const first = afterVaultStep(
			facts({ deposit: "none" }),
			dep("10"),
			5_000,
			"mainnet",
		);
		expect(first).toMatchObject({
			perps: "90",
			spot: "100",
			deposit: {
				vault: USER_VAULT,
				equity: "10",
				lockedUntil: 5_000 + 24 * 3_600_000,
			},
			maxWithdrawable: null,
		});
		expect(
			afterVaultStep(facts(), dep("10"), 5_000, "testnet").deposit,
		).toEqual({
			vault: USER_VAULT,
			equity: "50",
			lockedUntil: 25_000,
		});
		// a deposit that was not read stays unread
		expect(
			afterVaultStep(
				facts({ deposit: null, perps: null }),
				dep("10"),
				0,
				"testnet",
			),
		).toMatchObject({ deposit: null, perps: null });
		const part = afterVaultStep(facts(), wd("15"), 5_000, "testnet");
		expect(part).toMatchObject({
			perps: "115",
			deposit: { equity: "25", lockedUntil: 1_000 },
		});
		// a balance that was not read stays unread
		expect(
			afterVaultStep(facts({ perps: null }), wd("15"), 5_000, "testnet").perps,
		).toBeNull();
		// all of it: nothing is left in that vault
		expect(afterVaultStep(facts(), wd("40"), 5_000, "testnet").deposit).toBe(
			"none",
		);
		expect(
			afterVaultStep(facts({ deposit: "none" }), wd("1"), 0, "testnet").deposit,
		).toBe("none");
		expect(
			afterVaultStep(facts({ deposit: null }), wd("1"), 0, "testnet").deposit,
		).toBeNull();
		expect(
			afterVaultStep(facts(), { kind: "toPerps", amount: "30" }, 0, "testnet"),
		).toMatchObject({ perps: "130", spot: "70" });
	});
});
