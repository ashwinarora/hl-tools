import {
	type PlainObject,
	parseVaultDetails,
	type Validator,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, OUTSIDER, RECIPIENT, TREASURY } from "#/test/keys";
import {
	checkBeforeSubmit,
	checkMoveBeforeSubmit,
	type SendReads,
} from "./sendCheck";

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

const X = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
const Y = "0x0014b26bde5766c0c0f94130af5c4bf4551eeef6";
const LOCKED_UNTIL = 1_000;
/** 50 HYPE unstaked in the staking balance, 1,000 staked with X. */
const STAKING = {
	summary: {
		delegated: "1000",
		undelegated: "50",
		pendingTotal: "0",
		pendingReturns: 0,
	},
	delegations: [{ validator: X, amount: "1000", lockedUntil: LOCKED_UNTIL }],
};
const HYPE = 100_000_000;
const VAULT = "0x49d05977597b22e3c73d654c351adde9d9920e18";
const vaultStep = (usdc: number, isDeposit = true): PlainObject => ({
	type: "vaultTransfer",
	vaultAddress: VAULT,
	isDeposit,
	usd: usdc * 1_000_000,
});
const toPerps = (amount: string): PlainObject => ({
	type: "usdClassTransfer",
	amount,
	toPerp: true,
	nonce: 1,
});
const moveIn = (hype: number): PlainObject => ({
	type: "cDeposit",
	wei: hype * HYPE,
	nonce: 1,
});
const back = (hype: number): PlainObject => ({
	type: "cWithdraw",
	wei: hype * HYPE,
	nonce: 1,
});
const stake = (
	hype: number,
	validator = X,
	isUndelegate = false,
): PlainObject => ({
	type: "tokenDelegate",
	validator,
	wei: hype * HYPE,
	isUndelegate,
	nonce: 1,
});
const unstake = (hype: number, validator = X) => stake(hype, validator, true);

/** Reads that answer from a table and remember what was asked. */
function reads(over: Partial<Record<keyof SendReads, unknown>> = {}) {
	const asked: string[] = [];
	const answer =
		<T>(name: keyof SendReads, value: T) =>
		async (who?: string): Promise<T> => {
			asked.push(
				who === undefined
					? name
					: `${name} ${who === TREASURY ? "treasury" : "receiver"}`,
			);
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
		staking: answer("staking", STAKING),
		validators: answer("validators", [
			{ address: X },
			{ address: Y },
		] as Validator[]),
		clock: answer("clock", null),
		agents: answer("agents", [{ name: "lab" }, { name: "" }]),
		open: answer("open", { positions: 0, orders: 0 }),
		vaultDeposits: answer("vaultDeposits", [
			{ vault: VAULT, equity: "40", lockedUntil: LOCKED_UNTIL },
		]),
		vault: answer(
			"vault",
			parseVaultDetails({ name: "V", vaultAddress: VAULT, leader: VAULT }),
		),
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

	it("stops a switch back to a manual account while anything is open, and reads nothing for the other way", async () => {
		const to = (abstraction: string): PlainObject => ({
			type: "userSetAbstraction",
			user: TREASURY,
			abstraction,
			nonce: 1,
		});
		// to a unified account nothing stands in the way: Hyperliquid took it with a position open
		const unified = reads({ open: { positions: 1, orders: 2 } });
		expect(
			await checkBeforeSubmit(payload(to("unifiedAccount")), unified.r),
		).toEqual([]);
		expect(unified.asked).toEqual([]);
		// back to manual: only with nothing open
		const quiet = reads();
		expect(await checkBeforeSubmit(payload(to("disabled")), quiet.r)).toEqual(
			[],
		);
		expect(quiet.asked).toEqual(["open treasury"]);
		expect(
			await checkBeforeSubmit(
				payload(to("disabled")),
				reads({ open: { positions: 1, orders: 2 } }).r,
			),
		).toEqual([
			{
				code: "unified-busy",
				message:
					"Hyperliquid switches back to a manual account only when nothing is open, and this treasury has 1 open position and 2 open orders. Close them with an API wallet first.",
			},
		]);
		expect(
			await codes(to("disabled"), { open: { positions: 0, orders: 1 } }),
		).toEqual(["unified-busy"]);
		// a read that fails stops nothing
		expect(await codes(to("disabled"), { open: new Error("timeout") })).toEqual(
			[],
		);
		// A mode nobody measured: the finaliser's signature could not be made
		// the way Hyperliquid checks it, so it is stopped before any prompt
		// and nothing is read for it.
		const other = reads({ open: { positions: 0, orders: 0 } });
		const refused = await checkBeforeSubmit(
			payload(to("portfolioMargin")),
			other.r,
		);
		expect(refused.map((r) => r.code)).toEqual(["mode-unmeasured"]);
		expect(refused[0]?.message).toContain("“portfolioMargin”");
		expect(refused[0]?.message).toContain(
			"the proposal's number would be used up",
		);
		expect(other.asked).toEqual([]);
		// a mode that is no name at all
		expect(
			await codes({ type: "userSetAbstraction", user: TREASURY, nonce: 1 }),
		).toEqual(["mode-unmeasured"]);
	});

	it("stops the removal of an API wallet that is gone, and reads nothing else for it", async () => {
		const remove = (agentName: string): PlainObject => ({
			type: "approveAgent",
			agentAddress: `0x${"0".repeat(40)}`,
			agentName,
			nonce: 1,
		});
		const { r, asked } = reads();
		expect(await checkBeforeSubmit(payload(remove("lab")), r)).toEqual([]);
		expect(asked).toEqual(["agents treasury"]);
		// the one without a name
		expect(await codes(remove(""))).toEqual([]);
		// removed or replaced since the proposal was made
		const gone = await checkBeforeSubmit(
			payload(remove("rebalancer")),
			reads().r,
		);
		expect(gone).toEqual([
			{
				code: "agent-missing",
				message:
					'This treasury has no API wallet named "rebalancer": there is nothing to remove, and Hyperliquid would refuse it.',
			},
		]);
		expect(
			(
				await checkBeforeSubmit(
					payload(remove("")),
					reads({ agents: [{ name: "lab" }] }).r,
				)
			)[0]?.message,
		).toContain("no API wallet without a name");
		// a list that could not be read stops nothing
		expect(
			await codes(remove("rebalancer"), { agents: new Error("timeout") }),
		).toEqual([]);
		// an approval is no removal: nothing here bears on it
		const approve = await checkBeforeSubmit(
			payload({ ...remove("x"), agentAddress: RECIPIENT }),
			reads().r,
		);
		expect(approve).toEqual([]);
	});

	it("stops a send to one of HyperEVM's own addresses, whatever the mode and the balances", async () => {
		const toEvm = {
			...asset("spot"),
			destination: "0x2222222222222222222222222222222222222222",
		};
		expect(await codes(toEvm)).toEqual(["evm-multisig"]);
		// nothing read at all: the destination alone says it
		expect(
			await codes(toEvm, {
				mode: new Error("timeout"),
				role: new Error("timeout"),
				spot: new Error("timeout"),
			}),
		).toEqual(["evm-multisig"]);
	});

	it("stops a send from the treasury into the same balance of itself, whatever its mode", async () => {
		const toItself = { ...asset(""), destination: TREASURY };
		expect(await codes(toItself)).toEqual(["send-invalid"]);
		// also when the mode could not be read
		expect(await codes(toItself, { mode: new Error("timeout") })).toEqual([
			"send-invalid",
		]);
		expect(
			await codes({
				type: "usdSend",
				destination: TREASURY,
				amount: "1",
				time: 1,
			}),
		).toEqual(["self-transfer"]);
		// from one of its balances into the other is taken
		expect(
			await codes({
				...asset("spot"),
				destination: TREASURY,
				destinationDex: "",
			}),
		).toEqual([]);
	});

	it("stops a withdrawal that is not more than the bridge's fee", async () => {
		const withdraw = (amount: string): PlainObject => ({
			type: "withdraw3",
			destination: RECIPIENT,
			amount,
			time: 1,
		});
		expect(await codes(withdraw("1"))).toEqual(["withdrawal-below-fee"]);
		expect(await codes(withdraw("0.2"))).toEqual(["withdrawal-below-fee"]);
		// whatever the reads say, and also when they fail
		expect(
			await codes(withdraw("1"), { withdrawable: new Error("timeout") }),
		).toEqual(["withdrawal-below-fee"]);
		expect(await codes(withdraw("2"))).toEqual([]);
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

describe("checkBeforeSubmit: a staking step", () => {
	const HYPE_SPOT = [
		{ coin: "USDC", total: "100", hold: "0" },
		{ coin: "HYPE", total: "410", hold: "10" },
	];
	const check = async (action: PlainObject, over = {}, now = 5_000) =>
		checkBeforeSubmit(
			payload(action),
			reads({ spot: HYPE_SPOT, ...over }).r,
			now,
		);
	const codeOf = async (action: PlainObject, over = {}, now = 5_000) =>
		(await check(action, over, now)).map((x) => x.code);

	it("reads the treasury's spot, its staking and the validators, and nothing about a receiver", async () => {
		const { r, asked } = reads({ spot: HYPE_SPOT });
		expect(await checkBeforeSubmit(payload(moveIn(400)), r, 5_000)).toEqual([]);
		expect(asked.sort()).toEqual([
			"spot treasury",
			"staking treasury",
			"validators",
		]);
	});
	it("stops what Hyperliquid would refuse, in the words for someone about to submit", async () => {
		// 410 in spot, 10 of it on hold
		expect(await check(moveIn(401))).toEqual([
			{
				code: "deposit-funds",
				message:
					"This moves more HYPE into the staking balance than the spot balance can release now.",
			},
		]);
		expect(await codeOf(stake(51))).toEqual(["stake-balance"]);
		expect(await codeOf(stake(1, OUTSIDER))).toEqual(["validator-unknown"]);
		expect(await codeOf(unstake(1001))).toEqual(["unstake-balance"]);
		expect(await codeOf(back(51))).toEqual(["return-balance"]);
		expect(
			await codeOf(back(1), {
				staking: {
					...STAKING,
					summary: { ...STAKING.summary, pendingReturns: 5 },
				},
			}),
		).toEqual(["return-queue-full"]);
	});
	it("lets a sound step through", async () => {
		for (const action of [moveIn(400), stake(50), unstake(1000), back(50)])
			expect(await codeOf(action)).toEqual([]);
	});
	it("an unstake is held until the stake's lockup has ended, by the clock it is asked with", async () => {
		expect(await codeOf(unstake(1), {}, LOCKED_UNTIL - 1)).toEqual([
			"unstake-lockup",
		]);
		expect(await codeOf(unstake(1), {}, LOCKED_UNTIL)).toEqual([]);
	});
	it("judges a lockup by Hyperliquid's clock where it says the time, whatever the device's says", async () => {
		// the device runs 10 seconds fast: by its clock the lockup is over
		const fast = LOCKED_UNTIL + 10_000;
		expect(await codeOf(unstake(1), { clock: LOCKED_UNTIL - 1 }, fast)).toEqual(
			["unstake-lockup"],
		);
		expect(await codeOf(unstake(1), { clock: LOCKED_UNTIL }, fast)).toEqual([]);
		// the device runs slow: Hyperliquid's clock says the lockup is over
		expect(
			await codeOf(unstake(1), { clock: LOCKED_UNTIL }, LOCKED_UNTIL - 9_000),
		).toEqual([]);
		// no answer, or none with a time: the device's clock is what there is
		for (const clock of [new Error("network"), null])
			expect(await codeOf(unstake(1), { clock }, fast)).toEqual([]);
		// asked only where a step depends on the time
		const quiet = reads({ spot: HYPE_SPOT });
		await checkBeforeSubmit(payload(stake(50)), quiet.r, 5_000);
		expect(quiet.asked).not.toContain("clock");
		const timed = reads({ spot: HYPE_SPOT });
		await checkBeforeSubmit(payload(unstake(1)), timed.r, 5_000);
		expect(timed.asked).toContain("clock");
	});
	it("a read that fails stops nothing", async () => {
		const down = new Error("network");
		expect(
			await codeOf(moveIn(9999), {
				spot: down,
				staking: down,
				validators: down,
			}),
		).toEqual([]);
		expect(await codeOf(stake(9999), { staking: down })).toEqual([]);
		expect(await codeOf(stake(1, OUTSIDER), { validators: down })).toEqual([]);
		// an account with no HYPE row in spot holds none
		expect(
			await codeOf(moveIn(1), {
				spot: [{ coin: "USDC", total: "5", hold: "0" }],
			}),
		).toEqual(["deposit-funds"]);
	});
});

describe("checkMoveBeforeSubmit: the two steps of a move, before either is sent", () => {
	const HYPE_SPOT = [{ coin: "HYPE", total: "400", hold: "0" }];
	const check = async (actions: PlainObject[], over = {}, now = 5_000) =>
		checkMoveBeforeSubmit(
			actions.map(payload),
			reads({ spot: HYPE_SPOT, ...over }).r,
			now,
		);

	it("judges the second step against what the first leaves behind", async () => {
		// staking 100 alone would be refused (50 is unstaked); after 50 more moved in it is not
		expect(
			(await checkBeforeSubmit(payload(stake(100)), reads().r, 5_000)).map(
				(x) => x.code,
			),
		).toEqual(["stake-balance"]);
		expect(await check([moveIn(50), stake(100)])).toEqual([]);
		expect(await check([unstake(50), back(100)])).toEqual([]);
		expect(await check([unstake(100), stake(100, Y)])).toEqual([]);
	});
	it("reads once for the whole move", async () => {
		const { r, asked } = reads({ spot: HYPE_SPOT });
		await checkMoveBeforeSubmit(
			[moveIn(50), stake(100)].map(payload),
			r,
			5_000,
		);
		expect(asked.sort()).toEqual([
			"spot treasury",
			"staking treasury",
			"validators",
		]);
	});
	it("names the step that would be refused, so nothing is sent at all", async () => {
		expect(await check([moveIn(500), stake(550)])).toEqual([
			{
				code: "deposit-funds",
				message:
					"Step 1: This moves more HYPE into the staking balance than the spot balance can release now.",
			},
		]);
		expect(await check([moveIn(50), stake(100, OUTSIDER)])).toEqual([
			{
				code: "validator-unknown",
				message: "Step 2: The address this stakes with is not a validator.",
			},
		]);
		expect(
			(await check([unstake(50), back(100)], {}, LOCKED_UNTIL - 1)).map(
				(x) => x.code,
			),
		).toEqual(["unstake-lockup"]);
	});
	it("checks steps that are no staking actions one by one", async () => {
		const out = await check([asset("", "500"), moveIn(1)], {
			withdrawable: "100",
		});
		expect(out.map((x) => x.code)).toEqual(["transfer-balance"]);
		expect(await check([])).toEqual([]);
	});
});

describe("a vault deposit or withdrawal, before it is submitted", () => {
	const after = LOCKED_UNTIL + 1;
	const check = (action: PlainObject, over = {}, now = after) =>
		checkBeforeSubmit(payload(action), reads(over).r, now);
	const codesOf = async (action: PlainObject, over = {}, now = after) =>
		(await check(action, over, now)).map((x) => x.code);

	it("reads the treasury and the vault, and lets a sound deposit through", async () => {
		const { r, asked } = reads();
		expect(await checkBeforeSubmit(payload(vaultStep(50)), r, after)).toEqual(
			[],
		);
		expect(asked.sort()).toEqual([
			"mode treasury",
			"spot treasury",
			"vault receiver",
			"vaultDeposits treasury",
			"withdrawable treasury",
		]);
	});

	it("stops a deposit Hyperliquid would refuse, in its own order of reasons", async () => {
		// a manual account's deposit takes from perps only: 100 there, 100 in spot
		expect(await check(vaultStep(101))).toEqual([
			{
				code: "deposit-funds",
				message:
					"This deposits more USDC than the treasury can move into a vault now.",
			},
		]);
		expect(await codesOf(vaultStep(4))).toEqual(["vault-min-deposit"]);
		expect(await codesOf(vaultStep(50), { vault: { kind: "none" } })).toEqual([
			"vault-unregistered",
		]);
		expect(
			await codesOf(vaultStep(50), {
				vault: parseVaultDetails({
					name: "V",
					vaultAddress: VAULT,
					leader: VAULT,
					isClosed: true,
				}),
			}),
		).toEqual(["vault-closed"]);
		expect(
			await codesOf(vaultStep(50), {
				vault: parseVaultDetails({
					name: "V",
					vaultAddress: VAULT,
					leader: VAULT,
					allowDeposits: false,
				}),
			}),
		).toEqual(["vault-no-deposits"]);
		// a unified account draws on its one balance, reported in spot
		expect(
			await codesOf(vaultStep(150), {
				mode: "unifiedAccount",
				spot: [{ coin: "USDC", total: "200", hold: "0" }],
			}),
		).toEqual([]);
		expect(
			await codesOf(vaultStep(150), {
				mode: "unifiedAccount",
				spot: [{ coin: "USDC", total: "200", hold: "60" }],
			}),
		).toEqual(["deposit-funds"]);
	});

	it("holds a withdrawal back until the lockup has ended by Hyperliquid's clock, then asks what is there", async () => {
		const { r, asked } = reads({ clock: LOCKED_UNTIL - 1 });
		expect(
			(await checkBeforeSubmit(payload(vaultStep(5, false)), r, after)).map(
				(x) => x.code,
			),
		).toEqual(["vault-lockup"]);
		expect(asked).toContain("clock");
		expect(await codesOf(vaultStep(5, false), { clock: LOCKED_UNTIL })).toEqual(
			[],
		);
		// the device's clock when Hyperliquid's does not answer
		expect(
			await codesOf(
				vaultStep(5, false),
				{ clock: new Error("x") },
				LOCKED_UNTIL - 9,
			),
		).toEqual(["vault-lockup"]);
		expect(await codesOf(vaultStep(41, false))).toEqual(["vault-equity"]);
		expect(await codesOf(vaultStep(5, false), { vaultDeposits: [] })).toEqual([
			"vault-equity",
		]);
	});

	it("stops nothing for a fact it could not read", async () => {
		const down = new Error("timeout");
		expect(
			await codesOf(vaultStep(5000), {
				mode: down,
				withdrawable: down,
				spot: down,
				vault: down,
				vaultDeposits: down,
			}),
		).toEqual([]);
		// the mode unread: which balance a deposit draws on is not known
		expect(await codesOf(vaultStep(5000), { mode: down })).toEqual([]);
		expect(await codesOf(vaultStep(5, false), { vaultDeposits: down })).toEqual(
			[],
		);
	});

	it("judges a two-step deposit in order: the move to perps makes room for the deposit", async () => {
		const pair = (moved: string, into: number) => [
			payload(toPerps(moved)),
			payload(vaultStep(into)),
		];
		const judge = async (moved: string, into: number, over = {}) =>
			(
				await checkMoveBeforeSubmit(pair(moved, into), reads(over).r, after)
			).map((x) => `${x.code}: ${x.message.slice(0, 7)}`);
		// 100 in perps, 100 in spot: 50 over makes 150
		expect(await judge("50", 150)).toEqual([]);
		// the deposit alone would be refused
		expect(await codesOf(vaultStep(150))).toEqual(["deposit-funds"]);
		expect(await judge("50", 151)).toEqual(["deposit-funds: Step 2:"]);
		expect(await judge("101", 150)).toEqual(["transfer-balance: Step 1:"]);
		// read once for the pair, not once for each step
		const { r, asked } = reads();
		await checkMoveBeforeSubmit(pair("50", 150), r, after);
		expect(asked.filter((a) => a === "withdrawable treasury")).toHaveLength(1);
	});

	it("leaves a pair that is no vault move to the checks of its own steps", async () => {
		const odd = [
			payload({ type: "approveAgent", agentAddress: VAULT }),
			payload(vaultStep(50)),
		];
		expect(await checkMoveBeforeSubmit(odd, reads().r, after)).toEqual([]);
	});
});
