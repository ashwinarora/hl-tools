import {
	describeAction,
	type Issue,
	LOCKUP_MARGIN_MS,
	type StakingAction,
	type StakingEvent,
	type Validator,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { NOW } from "#/test/keys";
import { HELP_JARGON } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import {
	actionLine,
	historyText,
	isStakingKind,
	lockupWords,
	noPayLine,
	planStaking,
	queueWords,
	ratePercent,
	STAKING,
	STAKING_KINDS,
	STAKING_REFUSALS,
	type StakingInput,
	type StakingRead,
	stakingActions,
	stakingPageOrder,
	stakingSummaryLine,
	stakingView,
	stepSentence,
	validatorLabel,
	validatorState,
	waitWords,
	wholeHype,
} from "./staking";

const v = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const X = v(0xa1);
const Y = v(0xb2);
const JAILED = v(0xc3);
const OUTSIDE = v(0xd4);
const KEEPS = v(0xe5);
const QUIET = v(0xf6);
const STRANGER = v(0x99);
const HOUR = 3_600_000;

const validator = (
	address: string,
	name: string,
	over: Partial<Validator> = {},
): Validator => ({
	address,
	name,
	description: "",
	stake: "1000000",
	isActive: true,
	isJailed: false,
	commission: "0.03",
	day: null,
	week: null,
	month: { uptime: "1", expectedRate: "0.0217" },
	...over,
});
const NOTHING = { uptime: "0", expectedRate: "0" };
const VALIDATORS: Validator[] = [
	validator(X, "Hypurr"),
	validator(Y, "Nansen"),
	validator(JAILED, "Kraken", {
		isJailed: true,
		isActive: false,
		month: NOTHING,
	}),
	validator(OUTSIDE, "Meria", { isActive: false, month: NOTHING }),
	validator(KEEPS, "Falcon", { commission: "1", month: NOTHING }),
	validator(QUIET, "", { month: NOTHING }),
];

/** 400 HYPE in spot, 50 in the staking balance, 1,000 staked with X (lockup over). */
const read = (over: Partial<StakingRead> = {}): StakingRead => ({
	summary: {
		delegated: "1000",
		undelegated: "50",
		pendingTotal: "0",
		pendingReturns: 0,
	},
	delegations: [{ validator: X, amount: "1000", lockedUntil: NOW - HOUR }],
	validators: VALIDATORS,
	spotAvailable: "400",
	...over,
});
const form = (over: Partial<StakingInput>): StakingInput => ({
	kind: "stake",
	amount: "100",
	validator: Y,
	toValidator: "",
	...over,
});
const plan = (f: Partial<StakingInput>, r: StakingRead | null = read()) =>
	planStaking(form(f), r, "mainnet", NOW);
const codes = (issues: readonly Issue[]) => issues.map((i) => i.code);
const said = (issues: readonly Issue[], code: string) =>
	issues.find((i) => i.code === code)?.message;

describe("the words of staking", () => {
	it("spells a wait out", () => {
		expect(waitWords(60_000)).toBe("1 minute");
		expect(waitWords(2 * 60_000)).toBe("2 minutes");
		expect(waitWords(HOUR)).toBe("1 hour");
		expect(waitWords(5 * HOUR)).toBe("5 hours");
		expect(waitWords(24 * HOUR)).toBe("1 day");
		expect(waitWords(7 * 24 * HOUR)).toBe("7 days");
	});
	it("knows the two waits of each network", () => {
		expect([lockupWords("mainnet"), queueWords("mainnet")]).toEqual([
			"1 day",
			"7 days",
		]);
		expect([lockupWords("testnet"), queueWords("testnet")]).toEqual([
			"2 minutes",
			"5 minutes",
		]);
	});
	it("names a validator by its own name, always with its address", () => {
		expect(validatorLabel(X, VALIDATORS)).toBe("Hypurr (0x0000…00a1)");
		// no name, not on the list, no list: the address alone
		expect(validatorLabel(QUIET, VALIDATORS)).toBe("0x0000…00f6");
		expect(validatorLabel(STRANGER, VALIDATORS)).toBe("0x0000…0099");
		expect(validatorLabel(X, null)).toBe("0x0000…00a1");
	});
	it("a validator's name written right to left cannot move its address", () => {
		const arabic = String.fromCodePoint(0x645, 0x631, 0x62d, 0x628, 0x627);
		const named = [{ ...VALIDATORS[0], address: X, name: arabic }] as never;
		expect(validatorLabel(X, named)).toBe(
			`${String.fromCodePoint(0x2068)}${arabic}${String.fromCodePoint(0x2069)} (0x0000…00a1)`,
		);
	});
	it("says what each step does", () => {
		const steps: StakingAction[] = [
			{ kind: "moveIn", amount: "50" },
			{ kind: "stake", amount: "100", validator: X },
			{ kind: "unstake", amount: "40", validator: X },
			{ kind: "return", amount: "100" },
		];
		expect(steps.map((s) => stepSentence(s, VALIDATORS))).toEqual([
			"Move 50 HYPE from the spot balance to the staking balance",
			"Stake 100 HYPE with Hypurr (0x0000…00a1)",
			"Unstake 40 HYPE from Hypurr (0x0000…00a1)",
			"Return 100 HYPE from the staking balance to the spot balance",
		]);
	});
	it("gives a list the same line as the step's own page, and anything else as the core says it", () => {
		const stake = {
			type: "tokenDelegate",
			validator: X,
			wei: 2_000_000,
			isUndelegate: false,
		};
		// by its own name where the validators are at hand, by its address until then
		expect(actionLine(stake, VALIDATORS)).toBe(
			"Stake 0.02 HYPE with Hypurr (0x0000…00a1)",
		);
		expect(actionLine(stake)).toBe("Stake 0.02 HYPE with 0x0000…00a1");
		expect(actionLine({ type: "cDeposit", wei: 2_000_000 })).toBe(
			"Move 0.02 HYPE from the spot balance to the staking balance",
		);
		// not a staking step: the core's own headline, untouched
		const send = {
			type: "usdSend",
			destination: STRANGER,
			amount: "5",
			time: 1,
		};
		expect(actionLine(send, VALIDATORS)).toBe(describeAction(send).headline);
	});
	it("gives a validator's total stake in whole HYPE, cut as Hyperliquid's own page cuts it", () => {
		expect(wholeHype("6470703.95005698")).toBe("6,470,703");
		expect(wholeHype("99742056.82732467")).toBe("99,742,056");
		expect(wholeHype("0.99")).toBe("0");
		expect(wholeHype("12")).toBe("12");
	});
	it("knows its three kinds", () => {
		expect(STAKING_KINDS).toEqual(["stake", "returnToSpot", "moveStake"]);
		expect(isStakingKind("moveStake")).toBe(true);
		expect(isStakingKind("sendUsdc")).toBe(false);
	});
	it("gives Hyperliquid's estimate as a percentage, or nothing", () => {
		expect(ratePercent(VALIDATORS[0] as Validator)).toBe("2.17%");
		expect(ratePercent(VALIDATORS[2] as Validator)).toBe("0.00%");
		expect(ratePercent(validator(X, "", { month: null }))).toBeNull();
	});
});

describe("stake", () => {
	it("moves in from spot what the staking balance does not hold, then stakes", () => {
		// the staking balance already holds 50, and 100 is to be staked
		const p = plan({});
		expect(p.steps).toEqual([
			{ kind: "moveIn", amount: "50" },
			{ kind: "stake", amount: "100", validator: Y },
		]);
		expect(p.issues).toEqual([]);
		expect(p.opensAt).toBeNull();
	});
	it("is one step when the staking balance covers it", () => {
		expect(plan({ amount: "50" }).steps).toEqual([
			{ kind: "stake", amount: "50", validator: Y },
		]);
		expect(plan({ amount: "12.5" }).steps).toHaveLength(1);
	});
	it("says that adding to a stake locks all of it again", () => {
		const p = plan({ validator: X });
		expect(p.steps).toHaveLength(2);
		expect(codes(p.issues)).toEqual(["stake.relocks"]);
		expect(p.issues[0]?.severity).toBe("warning");
		expect(p.issues[0]?.message).toBe(
			"The treasury already has 1000 HYPE staked with Hypurr (0x0000…00a1). Adding to it locks all of it again: none of it can be unstaked for 1 day.",
		);
	});
	it.each([
		[
			JAILED,
			"Kraken (0x0000…00c3) is jailed: the other validators voted it out for not responding. A stake with it earns nothing. Hyperliquid accepts the stake all the same, and it cannot be unstaked for 1 day.",
		],
		[
			OUTSIDE,
			"Meria (0x0000…00d4) is not among the validators that produce blocks and are paid. A stake with it earns nothing. Hyperliquid accepts the stake all the same, and it cannot be unstaked for 1 day.",
		],
		[
			KEEPS,
			"Falcon (0x0000…00e5) keeps all rewards as its commission. A stake with it earns nothing. Hyperliquid accepts the stake all the same, and it cannot be unstaked for 1 day.",
		],
		[
			QUIET,
			"0x0000…00f6 is expected by Hyperliquid to pay nothing as things stand. A stake with it earns nothing. Hyperliquid accepts the stake all the same, and it cannot be unstaked for 1 day.",
		],
	])("warns in one line about a validator that pays nothing, and still plans (%s)", (address, line) => {
		const p = plan({ validator: address });
		expect(p.steps).toHaveLength(2);
		expect(codes(p.issues)).toEqual(["stake.pays_nothing"]);
		expect(p.issues[0]?.severity).toBe("warning");
		expect(p.issues[0]?.path).toBe("action.validator");
		expect(p.issues[0]?.message).toBe(line);
	});
	it("says nothing about a validator that pays", () => {
		expect(noPayLine(VALIDATORS[0] as Validator, "mainnet")).toBeNull();
		expect(noPayLine(VALIDATORS[2] as Validator, "testnet")).toContain(
			"for 2 minutes",
		);
	});
	it("does not take an address that is no validator: Hyperliquid would refuse it", () => {
		const p = plan({ validator: STRANGER });
		expect(p.steps).toBeNull();
		expect(codes(p.issues)).toEqual(["validator.unknown"]);
		expect(p.issues[0]).toMatchObject({
			severity: "error",
			path: "action.validator",
			message:
				"This address is not a validator on mainnet. Hyperliquid would refuse the stake.",
		});
	});
	it("asks for a validator, as an address", () => {
		expect(codes(plan({ validator: "" }).issues)).toEqual(["field.required"]);
		expect(codes(plan({ validator: "0x12" }).issues)).toEqual([
			"address.invalid",
		]);
		expect(plan({ validator: "" }).steps).toBeNull();
	});
	it("plans without the validator list, and says the address was not checked", () => {
		const p = plan({ validator: STRANGER }, read({ validators: null }));
		expect(p.steps).toHaveLength(2);
		expect(codes(p.issues)).toEqual(["validators.unread"]);
		expect(p.issues[0]?.message).toBe(STAKING.validatorsUnread);
	});
	it("takes an address in capitals", () => {
		expect(
			plan({ validator: `0x${Y.slice(2).toUpperCase()}` }).steps?.[1],
		).toEqual({ kind: "stake", amount: "100", validator: Y });
	});
});

describe("the amount", () => {
	it.each([
		["", "field.required"],
		["abc", "amount.invalid"],
		["1e2", "amount.invalid"],
		["0", "amount.not_positive"],
		["-5", "amount.not_positive"],
		["0.000000001", "amount.precision"],
	])("%j is not taken (%s)", (amount, code) => {
		const p = plan({ amount });
		expect(p.steps).toBeNull();
		expect(codes(p.issues)).toEqual([code]);
		expect(p.issues[0]?.path).toBe("action.amount");
	});
	it("is never rounded: HYPE has 8 decimals", () => {
		expect(plan({ amount: "0.000000001" }).issues[0]?.message).toBe(
			"HYPE has 8 decimal places; 0.000000001 has 9.",
		);
		expect(plan({ amount: "0.00000001", validator: Y }).steps).toHaveLength(1);
	});
});

describe("what was not read", () => {
	it("no steps are worked out before the staking balance is known", () => {
		for (const r of [null, read({ summary: null })]) {
			const p = plan({}, r);
			expect(p.steps).toBeNull();
			expect(codes(p.issues)).toEqual(["staking.unread"]);
			expect(p.issues[0]?.message).toBe(STAKING.unread);
		}
	});
	it("a figure that is unknown refuses nothing", () => {
		const p = plan({}, read({ spotAvailable: null, delegations: null }));
		expect(p.steps).toHaveLength(2);
		expect(p.issues).toEqual([]);
	});
});

describe("what Hyperliquid would refuse as things stand", () => {
	it("more than spot can release is an amber line, not a stop", () => {
		const p = plan({}, read({ spotAvailable: "10" }));
		expect(p.steps).toHaveLength(2);
		expect(codes(p.issues)).toEqual(["staking.would_refuse.deposit-funds"]);
		expect(p.issues[0]?.severity).toBe("warning");
		expect(p.issues[0]?.message).toBe(
			"This moves more HYPE into the staking balance than the spot balance can release now. As things stand Hyperliquid would refuse it (step 1). Spot holds 10 HYPE that is not on hold, and this moves 50 HYPE.",
		);
	});
	it("an unstake of more than is staked there", () => {
		const p = plan({ kind: "returnToSpot", amount: "2000", validator: X });
		expect(p.steps).toEqual([
			{ kind: "unstake", amount: "1950", validator: X },
			{ kind: "return", amount: "2000" },
		]);
		expect(said(p.issues, "staking.would_refuse.unstake-balance")).toBe(
			"This unstakes more HYPE than is staked with that validator now. As things stand Hyperliquid would refuse it (step 1). The treasury has 1000 HYPE staked with Hypurr (0x0000…00a1), and this unstakes 1950 HYPE.",
		);
		// from a validator the treasury has nothing with
		expect(
			said(
				plan({ kind: "returnToSpot", amount: "60", validator: Y }).issues,
				"staking.would_refuse.unstake-balance",
			),
		).toContain("The treasury has 0 HYPE staked with Nansen");
	});
	it("a sixth return", () => {
		const full = read({
			summary: {
				delegated: "1000",
				undelegated: "50",
				pendingTotal: "5",
				pendingReturns: 5,
			},
		});
		const p = plan({ kind: "returnToSpot", amount: "30" }, full);
		expect(p.steps).toEqual([{ kind: "return", amount: "30" }]);
		expect(said(p.issues, "staking.would_refuse.return-queue-full")).toBe(
			"5 returns to spot are already waiting, and Hyperliquid takes no more than 5 at once. As things stand Hyperliquid would refuse it.",
		);
	});
});

describe("return to spot", () => {
	it("is one step when enough is unstaked already, whoever is named", () => {
		expect(
			plan({ kind: "returnToSpot", amount: "30", validator: "" }).steps,
		).toEqual([{ kind: "return", amount: "30" }]);
		const named = plan({ kind: "returnToSpot", amount: "50", validator: X });
		expect(named.steps).toEqual([{ kind: "return", amount: "50" }]);
		expect(named.issues).toEqual([]);
	});
	it("unstakes what is missing from the validator named, then starts the return", () => {
		const p = plan({ kind: "returnToSpot", amount: "100", validator: X });
		expect(p.steps).toEqual([
			{ kind: "unstake", amount: "50", validator: X },
			{ kind: "return", amount: "100" },
		]);
		expect(p.issues).toEqual([]);
	});
	it("asks which validator to unstake from, only when something has to be", () => {
		const p = plan({ kind: "returnToSpot", amount: "100", validator: "" });
		expect(p.steps).toBeNull();
		expect(codes(p.issues)).toEqual(["validator.needed"]);
		expect(p.issues[0]).toMatchObject({
			severity: "error",
			path: "action.validator",
			message:
				"The staking balance holds 50 HYPE that is not staked, so the rest has to be unstaked first. Choose the validator to take it from.",
		});
		expect(
			codes(
				plan({ kind: "returnToSpot", amount: "100", validator: "nobody" })
					.issues,
			),
		).toEqual(["address.invalid"]);
	});
});

describe("a stake that is still locked", () => {
	const until = NOW + 5 * HOUR;
	const locked = read({
		delegations: [{ validator: X, amount: "1000", lockedUntil: until }],
	});
	it("can be proposed and signed now: the plan says from when it can be submitted", () => {
		const p = plan(
			{ kind: "returnToSpot", amount: "100", validator: X },
			locked,
		);
		expect(p.steps).toHaveLength(2);
		expect(p.issues).toEqual([]);
		expect(p.opensAt).toBe(until + LOCKUP_MARGIN_MS);
	});
	it("what else stands in its way is still said, as of the end of the lockup", () => {
		const p = plan(
			{ kind: "returnToSpot", amount: "5000", validator: X },
			locked,
		);
		expect(codes(p.issues)).toEqual(["staking.would_refuse.unstake-balance"]);
		expect(p.opensAt).toBe(until + LOCKUP_MARGIN_MS);
	});
	it("a lockup that has passed opens nothing later", () => {
		expect(
			plan({ kind: "returnToSpot", amount: "100", validator: X }).opensAt,
		).toBeNull();
	});
});

describe("move to another validator", () => {
	const move = (over: Partial<StakingInput> = {}) =>
		plan({ kind: "moveStake", validator: X, toValidator: Y, ...over });
	it("unstakes from one and stakes with the other", () => {
		const p = move();
		expect(p.steps).toEqual([
			{ kind: "unstake", amount: "100", validator: X },
			{ kind: "stake", amount: "100", validator: Y },
		]);
		expect(p.issues).toEqual([]);
	});
	it("needs two different validators", () => {
		const p = move({ toValidator: X });
		expect(p.steps).toBeNull();
		expect(codes(p.issues)).toEqual(["validator.same"]);
		expect(p.issues[0]?.path).toBe("action.toValidator");
	});
	it("checks the one the HYPE goes to, under its own field", () => {
		const unknown = move({ toValidator: STRANGER });
		expect(codes(unknown.issues)).toEqual(["validator.unknown"]);
		expect(unknown.issues[0]?.path).toBe("action.toValidator");
		const jailed = move({ toValidator: JAILED });
		expect(jailed.steps).toHaveLength(2);
		expect(codes(jailed.issues)).toEqual(["stake.pays_nothing"]);
		expect(jailed.issues[0]?.path).toBe("action.toValidator");
		expect(codes(move({ validator: "" }).issues)).toEqual(["field.required"]);
	});
	it("more than is staked with the first would be refused", () => {
		expect(codes(move({ amount: "1001" }).issues)).toEqual([
			"staking.would_refuse.unstake-balance",
		]);
	});
});

describe("the actions of a plan", () => {
	const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
	it("carry the proposal's chain fields and a number each, one after the other", () => {
		const steps = plan({}).steps ?? [];
		expect(stakingActions(steps, HEAD, 1000)).toEqual([
			{ type: "cDeposit", ...HEAD, wei: 5000000000, nonce: 1000 },
			{
				type: "tokenDelegate",
				...HEAD,
				validator: Y,
				wei: 10000000000,
				isUndelegate: false,
				nonce: 1001,
			},
		]);
		expect(Object.keys(stakingActions(steps, HEAD, 1000)[1] as object)).toEqual(
			[
				"type",
				"signatureChainId",
				"hyperliquidChain",
				"validator",
				"wei",
				"isUndelegate",
				"nonce",
			],
		);
	});
	it("leave out an amount that cannot be carried exactly", () => {
		expect(
			stakingActions([{ kind: "moveIn", amount: "0.000000001" }], HEAD, 1),
		).toEqual([]);
	});
});

describe("every sentence about staking", () => {
	const texts = [
		STAKING.label,
		...Object.values(STAKING.kinds).flatMap((k) => [k.label, k.description]),
		...Object.values(STAKING.amount),
		...Object.values(STAKING.validator),
		STAKING.toValidator,
		STAKING.oneStep,
		STAKING.twoSteps,
		STAKING.unread,
		STAKING.validatorsUnread,
		STAKING.noRecommendation,
		...Object.values(STAKING_REFUSALS),
		...VALIDATORS.flatMap((x) => noPayLine(x, "mainnet") ?? []),
		...[
			plan({ validator: X }),
			plan({}, read({ spotAvailable: "10" })),
			plan({ kind: "returnToSpot", amount: "2000", validator: X }),
			plan({ kind: "returnToSpot", amount: "100", validator: "" }),
			plan({ validator: STRANGER }),
			plan({ kind: "moveStake", validator: X, toValidator: X }),
		].flatMap((p) => p.issues.map((i) => i.message)),
	];
	it("promises nothing the product does not provide, in plain words", () => {
		expect(texts.length).toBeGreaterThan(25);
		for (const t of texts) {
			for (const claim of FORBIDDEN_CLAIMS)
				expect(t, `${claim} in "${t}"`).not.toMatch(claim);
			for (const word of HELP_JARGON)
				expect(t, `${word} in "${t}"`).not.toMatch(word);
		}
	});
	it("recommends no validator", () => {
		for (const t of texts)
			expect(t).not.toMatch(/\b(best|safest|recommended|we suggest)\b/i);
	});
	it("has a sentence for every refusal the judge can give", () => {
		expect(Object.keys(STAKING_REFUSALS).sort()).toEqual([
			"deposit-funds",
			"return-balance",
			"return-queue-full",
			"stake-balance",
			"unstake-balance",
			"unstake-lockup",
			"validator-unknown",
		]);
	});
});

describe("what the Staking section shows", () => {
	const ZERO = `0x${"0".repeat(64)}`;
	const event = (
		time: number,
		kind: StakingEvent["kind"],
		amount: string,
		validator: string | null = null,
		hash = `0x${"ab".repeat(32)}`,
	): StakingEvent => ({ time, hash, kind, amount, validator });
	const MINUTE = 60_000;
	const history: StakingEvent[] = [
		event(NOW - MINUTE, "returnStarted", "20"),
		event(NOW - 2 * MINUTE, "returnStarted", "30"),
		event(NOW - 3 * MINUTE, "unstake", "50", X),
		event(NOW - 4 * MINUTE, "returnLanded", "5", null, ZERO),
		event(NOW - 9 * MINUTE, "stake", "1050", X),
		event(NOW - 10 * MINUTE, "moveIn", "1100"),
	];
	const waiting = {
		delegated: "1000",
		undelegated: "50",
		pendingTotal: "50",
		pendingReturns: 2,
	};
	const view = (over = {}, now = NOW) =>
		stakingView(
			{
				summary: waiting,
				delegations: [
					{ validator: X, amount: "1000", lockedUntil: NOW + HOUR },
					{ validator: JAILED, amount: "3", lockedUntil: NOW - HOUR },
					{ validator: STRANGER, amount: "1", lockedUntil: 0 },
				],
				history,
				validators: VALIDATORS,
				...over,
			},
			"testnet",
			now,
		);

	it("the figures, as Hyperliquid reports them", () => {
		expect(view()).toMatchObject({
			undelegated: "50",
			delegated: "1000",
			pending: "50",
			places: 2,
			any: true,
		});
	});
	it("each stake with its validator's name, the estimate, and from when it can be unstaked", () => {
		expect(view().stakes).toEqual([
			{
				validator: X,
				name: "Hypurr",
				amount: "1000",
				rate: "2.17%",
				idle: null,
				lockedUntil: NOW + HOUR,
				locked: true,
			},
			// the validator was jailed after the stake was made: said on the row
			{
				validator: JAILED,
				name: "Kraken",
				amount: "3",
				rate: "0.00%",
				idle: "jailed",
				lockedUntil: NOW - HOUR,
				locked: false,
			},
			// not on the list: nothing is made up about it
			{
				validator: STRANGER,
				name: "",
				amount: "1",
				rate: null,
				idle: null,
				lockedUntil: 0,
				locked: false,
			},
		]);
		expect(view({}, NOW + HOUR).stakes?.[0]?.locked).toBe(false);
	});
	it("each return with the moment it lands, the next one first", () => {
		expect(view().returns).toEqual([
			{
				amount: "30",
				startedAt: NOW - 2 * MINUTE,
				landsAt: NOW + 3 * MINUTE,
			},
			{ amount: "20", startedAt: NOW - MINUTE, landsAt: NOW + 4 * MINUTE },
		]);
	});
	it("no landing time is made up when the history does not account for the returns", () => {
		expect(view({ history: [] }).returns).toBeNull();
		expect(view({ history: null }).returns).toBeNull();
		expect(view({ history: null }).history).toBeNull();
	});
	it("Hyperliquid's own list of steps, in words, with a transaction to open where there is one", () => {
		expect(view().history?.map((r) => [r.text, r.hash !== null])).toEqual([
			["Started the return of 20 HYPE to spot", true],
			["Started the return of 30 HYPE to spot", true],
			["Unstaked 50 HYPE from Hypurr (0x0000…00a1)", true],
			["5 HYPE landed in spot", false],
			["Staked 1050 HYPE with Hypurr (0x0000…00a1)", true],
			["Moved 1100 HYPE from spot to the staking balance", true],
		]);
		expect(new Set(view().history?.map((r) => r.key)).size).toBe(6);
		expect(historyText(event(1, "stake", "1", STRANGER), null)).toBe(
			"Staked 1 HYPE with 0x0000…0099",
		);
	});
	it("nothing read, nothing claimed", () => {
		expect(
			stakingView(
				{ summary: null, delegations: null, history: null, validators: null },
				"mainnet",
				NOW,
			),
		).toEqual({
			undelegated: null,
			delegated: null,
			pending: null,
			places: null,
			stakes: null,
			returns: null,
			history: null,
			any: false,
		});
	});
	it("lists validators in the order of Hyperliquid's own staking page", () => {
		const listed = [
			validator(X, "big", { stake: "6475454" }),
			validator(JAILED, "jailed, the largest", {
				stake: "99742056",
				isJailed: true,
				isActive: false,
			}),
			validator(KEEPS, "keeps all rewards", {
				stake: "11056",
				commission: "1",
				month: NOTHING,
			}),
			validator(Y, "small", { stake: "10063" }),
			validator(OUTSIDE, "not active", { stake: "500", isActive: false }),
			// jailed and still in the set is not among the ones listed first
			validator(QUIET, "jailed, active", { stake: "1", isJailed: true }),
		];
		expect([...listed].sort(stakingPageOrder).map((x) => x.name)).toEqual([
			// the active set by stake, smallest first: paying nothing moves nobody
			"small",
			"keeps all rewards",
			"big",
			// then the rest, the same way
			"jailed, active",
			"not active",
			"jailed, the largest",
		]);
		// two with the same stake keep one order whatever order they came in
		const twins = [
			validator(Y, "y", { stake: "5" }),
			validator(X, "x", { stake: "5" }),
		];
		expect(twins.sort(stakingPageOrder).map((x) => x.name)).toEqual(["x", "y"]);
		// read as amounts, never as text
		expect(
			[
				validator(X, "ten", { stake: "10" }),
				validator(Y, "nine", { stake: "9.5" }),
			]
				.sort(stakingPageOrder)
				.map((x) => x.name),
		).toEqual(["nine", "ten"]);
	});
	it("a validator's state in a word", () => {
		expect(VALIDATORS.map((x) => validatorState(x))).toEqual([
			{ text: "active", idle: false },
			{ text: "active", idle: false },
			{ text: "jailed", idle: true },
			{ text: "not active", idle: true },
			{ text: "keeps all rewards", idle: true },
			{ text: "pays nothing", idle: true },
		]);
	});
	it("the Overview's one line: only what is there", () => {
		expect(stakingSummaryLine(waiting)).toBe(
			"1000 HYPE staked · 50 HYPE in the staking balance · 50 HYPE on its way back to spot",
		);
		expect(
			stakingSummaryLine({ ...waiting, undelegated: "0", pendingTotal: "0" }),
		).toBe("1000 HYPE staked");
		expect(
			stakingSummaryLine({
				delegated: "0",
				undelegated: "0",
				pendingTotal: "0",
				pendingReturns: 0,
			}),
		).toBeNull();
		expect(stakingSummaryLine(null)).toBeNull();
	});
});

describe("an amount no action can carry (audit F-114)", () => {
	it("is refused in the form: the wallet signs a 64-bit whole number", () => {
		const big = plan({ amount: "200000000000" });
		expect(codes(big.issues)).toContain("amount.too_large");
		expect(big.steps).toBeNull();
		// the largest that fits still builds
		expect(
			codes(plan({ amount: "184467440737.09551615" }).issues),
		).not.toContain("amount.too_large");
	});
});
