import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type Delegation,
	expectedRate,
	explainExchangeError,
	hypeToWei,
	parseDelegations,
	parseDelegatorHistory,
	parseDelegatorSummary,
	parseValidators,
	pendingReturns,
	RETURN_QUEUE_LINE,
	STAKE_LOCKUP_LINE,
	type StakingEvent,
	type Validator,
	validatorPays,
	weiToHype,
} from "../../src/multisig/index.ts";
import {
	HYPE_WEI_DECIMALS,
	LOCKUP_MARGIN_MS,
	MAX_PENDING_RETURNS,
	RETURN_QUEUE,
	STAKE_LOCKUP,
	STAKING_ACTION_TYPES,
	STAKING_RULES,
} from "../../src/rules/staking.ts";

const HYPURR = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
const JAILED = "0x0000472d488d33b7329ca53bfcc3918961d55f8e";
const INACTIVE = "0x0014b26bde5766c0c0f94130af5c4bf4551eeef6";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface FixtureState {
	at: number;
	spotAvailable: string;
	undelegated: string;
	delegated: string;
	pendingReturns: number;
	pendingTotal: string;
	delegations: {
		validator: string;
		amount: string;
		lockedUntilTimestamp: number;
	}[];
}
interface FixtureStep {
	about: string;
	action: Record<string, unknown>;
	sentAt: number;
	before: FixtureState;
	answer: { status: string; response: unknown };
	after: FixtureState;
	history: { time: number; hash: string; delta: unknown } | null;
}
const STAKING_FIXTURE = JSON.parse(
	readFileSync(
		new URL("../../fixtures/multisig/staking.json", import.meta.url),
		"utf8",
	),
) as {
	network: "testnet";
	validators: Record<string, string>;
	notes: {
		topUp: { lockedBefore: number; lockedAfter: number; unstakeAtOnce: string };
		moveBackToBack: { unstake: string; stake: string };
		lockupEnd: {
			lockedUntil: number;
			tries: { offsetMs: number; sentAt: number; result: string }[];
		};
	};
	steps: FixtureStep[];
};

describe("the rule set", () => {
	it("carries the waits per network and says which were measured", () => {
		expect(STAKING_RULES.id).toBe("staking");
		expect(HYPE_WEI_DECIMALS).toBe(8);
		expect(STAKE_LOCKUP).toEqual({
			mainnet: { ms: DAY, measured: false },
			testnet: { ms: 2 * MINUTE, measured: true },
		});
		expect(RETURN_QUEUE).toEqual({
			mainnet: { ms: 7 * DAY, measured: false },
			testnet: { ms: 5 * MINUTE, measured: true },
		});
		expect(MAX_PENDING_RETURNS).toBe(5);
		expect(LOCKUP_MARGIN_MS).toBeGreaterThan(1_500);
		expect(STAKING_ACTION_TYPES).toEqual([
			"cDeposit",
			"tokenDelegate",
			"cWithdraw",
		]);
	});

	it("is what the sentences of an action say", () => {
		// the sentences spell the lengths out; a change to the rule has to change them
		expect(STAKE_LOCKUP_LINE).toContain("1 day");
		expect(STAKE_LOCKUP_LINE).toContain("2 minutes on testnet");
		expect(RETURN_QUEUE_LINE).toContain("7 days");
		expect(RETURN_QUEUE_LINE).toContain("5 minutes on testnet");
	});

	it("matches what testnet did: the lockup of a top-up, and its sharp end", () => {
		const { topUp, lockupEnd } = STAKING_FIXTURE.notes;
		const toppedUp = STAKING_FIXTURE.steps.find((s) =>
			s.about.startsWith("stake more with a validator"),
		);
		// the stake's lockup had passed; adding to it locked all of it again, for the testnet length
		expect(topUp.lockedBefore).toBeLessThan(toppedUp?.sentAt ?? 0);
		expect(topUp.lockedAfter - (toppedUp?.history?.time ?? 0)).toBe(
			STAKE_LOCKUP.testnet.ms,
		);
		expect(topUp.unstakeAtOnce).toMatch(/lockup period/);
		const [early, late] = lockupEnd.tries;
		expect(early?.sentAt).toBeLessThan(lockupEnd.lockedUntil);
		expect(early?.result).toMatch(/lockup period/);
		expect(late?.sentAt).toBeGreaterThan(lockupEnd.lockedUntil);
		expect((late?.sentAt ?? 0) - lockupEnd.lockedUntil).toBeLessThan(
			LOCKUP_MARGIN_MS,
		);
		expect(late?.result).toBe("accepted");
	});
});

describe("every refusal recorded has its place in the catalogue", () => {
	const EXPECTED: Record<string, string> = {
		"stake with nothing like that in the staking balance": "stake-balance",
		"move in more than spot holds": "staking-deposit-funds",
		"unstake part of it at once, after the top-up": "unstake-lockup",
		"stake with an address that is no validator": "validator-unknown",
		"unstake more than is staked there": "unstake-balance",
		"return more than is unstaked": "return-balance",
		"a sixth return while five wait": "return-queue-full",
		"unstake -2500 ms from the end of the lockup": "unstake-lockup",
	};
	const refused = STAKING_FIXTURE.steps.filter((s) => s.answer.status !== "ok");
	it("and nothing was refused that is not listed here", () => {
		expect(refused.map((s) => s.about).sort()).toEqual(
			Object.keys(EXPECTED).sort(),
		);
		expect(new Set(Object.values(EXPECTED)).size).toBe(7);
	});
	it.each(refused)("$about", (s) => {
		expect(explainExchangeError(s.answer, 200).id).toBe(EXPECTED[s.about]);
	});
});

describe("HYPE and the integer an action carries", () => {
	it.each([
		[100000000, "1"],
		[1, "0.00000001"],
		[0, "0"],
		[100000000n, "1"],
		[9007199300000000n, "90071993"],
		["2000000", "0.02"],
	])("%s is %s HYPE", (wei, hype) => {
		expect(weiToHype(wei)).toBe(hype);
	});
	it.each([
		[-1],
		[-1n],
		[1.5],
		[2 ** 60],
		["1.5"],
		["-3"],
		[""],
		[null],
		[undefined],
		[{}],
	])("%s is not an amount", (wei) => {
		expect(weiToHype(wei)).toBeNull();
	});
	it.each([
		["1", 100000000],
		["0.02", 2000000],
		["0.00000001", 1],
		["0", 0],
		["90071992.54740991", 9007199254740991],
		["90071993", 9007199300000000n],
	])("%s HYPE is carried as %s", (hype, wei) => {
		expect(hypeToWei(hype)).toBe(wei);
	});
	it.each([
		["0.000000001"],
		["-1"],
		["abc"],
		[""],
	])("%s is never rounded or guessed", (hype) => {
		expect(hypeToWei(hype)).toBeNull();
	});
});

describe("delegatorSummary", () => {
	const raw = {
		delegated: "0.0106",
		undelegated: "0.0004",
		totalPendingWithdrawal: "0.0",
		nPendingWithdrawals: 0,
	};
	it("reads the four figures, in their canonical form", () => {
		expect(parseDelegatorSummary(raw)).toEqual({
			delegated: "0.0106",
			undelegated: "0.0004",
			pendingTotal: "0",
			pendingReturns: 0,
		});
	});
	it.each([
		["delegated"],
		["undelegated"],
		["totalPendingWithdrawal"],
		["nPendingWithdrawals"],
	])("is not read without %s", (key) => {
		expect(parseDelegatorSummary({ ...raw, [key]: undefined })).toBeNull();
	});
	it.each([
		[null],
		["text"],
		[[raw]],
		[{ ...raw, delegated: "-1" }],
		[{ ...raw, undelegated: 1 }],
		[{ ...raw, nPendingWithdrawals: 1.5 }],
		[{ ...raw, nPendingWithdrawals: -1 }],
	])("answers nothing for %j", (bad) => {
		expect(parseDelegatorSummary(bad)).toBeNull();
	});
});

describe("delegations", () => {
	it("reads each stake with the end of its lockup, the largest first", () => {
		expect(
			parseDelegations([
				{ validator: JAILED, amount: "0.0003", lockedUntilTimestamp: 2 },
				{
					validator: HYPURR.toUpperCase().replace("0X", "0x"),
					amount: "0.02",
					lockedUntilTimestamp: 1791820832327,
				},
				{ validator: INACTIVE, amount: "0.0003", lockedUntilTimestamp: 3 },
			]),
		).toEqual<Delegation[]>([
			{ validator: HYPURR, amount: "0.02", lockedUntil: 1791820832327 },
			{ validator: JAILED, amount: "0.0003", lockedUntil: 2 },
			{ validator: INACTIVE, amount: "0.0003", lockedUntil: 3 },
		]);
	});
	it("lists equal stakes in one order, however they arrive", () => {
		const a = { validator: JAILED, amount: "1", lockedUntilTimestamp: 1 };
		const b = { validator: INACTIVE, amount: "1", lockedUntilTimestamp: 1 };
		const order = (rows: unknown[]) =>
			parseDelegations(rows)?.map((d) => d.validator);
		expect(order([a, b])).toEqual([JAILED, INACTIVE]);
		expect(order([b, a])).toEqual([JAILED, INACTIVE]);
	});
	it("leaves out a row it cannot read, and keeps the rest", () => {
		expect(
			parseDelegations([
				{ validator: "0x12", amount: "1", lockedUntilTimestamp: 1 },
				{ validator: 7, amount: "1", lockedUntilTimestamp: 1 },
				{ validator: HYPURR, amount: "one", lockedUntilTimestamp: 1 },
				{ validator: HYPURR, amount: "1", lockedUntilTimestamp: "soon" },
				"row",
				{ validator: JAILED, amount: "1", lockedUntilTimestamp: 1 },
			]),
		).toEqual([{ validator: JAILED, amount: "1", lockedUntil: 1 }]);
	});
	it("an account with no stake has an empty list; another shape is not read", () => {
		expect(parseDelegations([])).toEqual([]);
		expect(parseDelegations({})).toBeNull();
		expect(parseDelegations(null)).toBeNull();
	});
});

describe("delegatorHistory", () => {
	const H =
		"0x7B66AC4DD6EB43D97CE0042B8694B0010600C43371EE62AB1F2F57A095EF1DC4";
	const ZERO = `0x${"0".repeat(64)}`;
	const rows = [
		{ time: 1, hash: H, delta: { cDeposit: { amount: "0.02" } } },
		{
			time: 2,
			hash: H,
			delta: {
				delegate: { validator: HYPURR, amount: "0.01", isUndelegate: false },
			},
		},
		{
			time: 3,
			hash: H,
			delta: {
				delegate: { validator: JAILED, amount: "0.0003", isUndelegate: true },
			},
		},
		{
			time: 4,
			hash: H,
			delta: { withdrawal: { amount: "0.0001", phase: "initiated" } },
		},
		{
			time: 5,
			hash: ZERO,
			delta: { withdrawal: { amount: "0.0001", phase: "finalized" } },
		},
	];
	it("reads the five kinds of step, newest first", () => {
		expect(parseDelegatorHistory(rows)).toEqual<StakingEvent[]>([
			{
				time: 5,
				hash: ZERO,
				kind: "returnLanded",
				amount: "0.0001",
				validator: null,
			},
			{
				time: 4,
				hash: H.toLowerCase(),
				kind: "returnStarted",
				amount: "0.0001",
				validator: null,
			},
			{
				time: 3,
				hash: H.toLowerCase(),
				kind: "unstake",
				amount: "0.0003",
				validator: JAILED,
			},
			{
				time: 2,
				hash: H.toLowerCase(),
				kind: "stake",
				amount: "0.01",
				validator: HYPURR,
			},
			{
				time: 1,
				hash: H.toLowerCase(),
				kind: "moveIn",
				amount: "0.02",
				validator: null,
			},
		]);
	});
	it("reads the rows the lab recorded", () => {
		const recorded = STAKING_FIXTURE.steps.flatMap((s) =>
			s.history ? [s.history] : [],
		);
		const read = parseDelegatorHistory(recorded);
		expect(read).toHaveLength(recorded.length);
		expect(new Set(read?.map((e) => e.kind))).toEqual(
			new Set(["moveIn", "stake", "unstake", "returnStarted"]),
		);
	});
	it.each([
		[{ time: 1, hash: H, delta: { cDeposit: { amount: "x" } } }],
		[{ time: 1, hash: H, delta: { delegate: { validator: HYPURR } } }],
		[{ time: 1, hash: H, delta: { delegate: { amount: "1" } } }],
		[{ time: 1, hash: H, delta: { withdrawal: { amount: "1", phase: "?" } } }],
		[{ time: 1, hash: H, delta: { withdrawal: { phase: "initiated" } } }],
		[{ time: 1, hash: H, delta: { vote: {} } }],
		[{ time: 1, hash: H, delta: "moved" }],
		[{ time: 1, hash: 5, delta: { cDeposit: { amount: "1" } } }],
		[{ time: "now", hash: H, delta: { cDeposit: { amount: "1" } } }],
		[null],
	])("leaves out %j", (bad) => {
		expect(parseDelegatorHistory([bad, rows[0]])).toHaveLength(1);
	});
	it("another shape is not read", () => {
		expect(parseDelegatorHistory({ rows })).toBeNull();
	});
});

describe("when a return lands", () => {
	const start = (time: number, amount: string): StakingEvent => ({
		time,
		hash: "0xaa",
		kind: "returnStarted",
		amount,
		validator: null,
	});
	const landed: StakingEvent = {
		time: 50,
		hash: "0x00",
		kind: "returnLanded",
		amount: "0.5",
		validator: null,
	};
	const summary = (pendingReturns: number, pendingTotal: string) => ({
		delegated: "0",
		undelegated: "0",
		pendingTotal,
		pendingReturns,
	});
	// an older return that has landed, then two that still wait
	const events = [
		start(300, "0.2"),
		start(200, "0.1"),
		landed,
		start(10, "0.5"),
	];

	it("is when it was started plus the network's queue, the first to land first", () => {
		expect(pendingReturns(summary(2, "0.3"), events, "testnet")).toEqual([
			{ amount: "0.1", startedAt: 200, landsAt: 200 + 5 * MINUTE },
			{ amount: "0.2", startedAt: 300, landsAt: 300 + 5 * MINUTE },
		]);
		expect(
			pendingReturns(summary(1, "0.2"), events, "mainnet")?.[0]?.landsAt,
		).toBe(300 + 7 * DAY);
	});
	it("nothing waits, nothing is listed", () => {
		expect(pendingReturns(summary(0, "0"), events, "testnet")).toEqual([]);
	});
	it("no time is made up when the history does not account for the summary", () => {
		// more waiting than the history shows
		expect(pendingReturns(summary(4, "0.8"), events, "testnet")).toBeNull();
		// the count fits, the total does not
		expect(pendingReturns(summary(2, "0.31"), events, "testnet")).toBeNull();
	});
	it("fits the lab's five", () => {
		const five = STAKING_FIXTURE.steps.filter((s) =>
			/^return \d of 5$/.test(s.about),
		);
		const history = parseDelegatorHistory(five.map((s) => s.history)) ?? [];
		const last = five[4]?.after;
		const waiting = pendingReturns(
			{
				delegated: last?.delegated ?? "",
				undelegated: last?.undelegated ?? "",
				pendingTotal: last?.pendingTotal ?? "",
				pendingReturns: last?.pendingReturns ?? 0,
			},
			history,
			"testnet",
		);
		expect(waiting).toHaveLength(5);
		expect(waiting?.every((r) => r.amount === "0.0001")).toBe(true);
	});
});

describe("validators", () => {
	const row = (over: Record<string, unknown> = {}) => ({
		validator: "0xA82FE73bbD768bc15D1eF2F6142a21fF8bD762AD",
		signer: "0xa82fe73bbd768bc15d1ef2f6142a21ff8bd762ad",
		name: "Hyper Foundation 2",
		description: "Hyper Foundation 2",
		nRecentBlocks: 10,
		stake: 5417504760171491,
		isJailed: false,
		unjailableAfter: null,
		isActive: true,
		commission: "0.03",
		stats: [
			[
				"day",
				{ uptimeFraction: "1.0", predictedApr: "0.0216", nSamples: 1440 },
			],
			[
				"week",
				{ uptimeFraction: "0.9996", predictedApr: "0.0217", nSamples: 10080 },
			],
			[
				"month",
				{ uptimeFraction: "0.9998", predictedApr: "0.0218", nSamples: 43199 },
			],
		],
		...over,
	});
	const read = (over: Record<string, unknown> = {}): Validator =>
		(parseValidators([row(over)]) as Validator[])[0] as Validator;

	it("reads what Hyperliquid reports about one", () => {
		expect(read()).toEqual<Validator>({
			address: "0xa82fe73bbd768bc15d1ef2f6142a21ff8bd762ad",
			name: "Hyper Foundation 2",
			description: "Hyper Foundation 2",
			stake: "54175047.60171491",
			isActive: true,
			isJailed: false,
			commission: "0.03",
			day: { uptime: "1", expectedRate: "0.0216" },
			week: { uptime: "0.9996", expectedRate: "0.0217" },
			month: { uptime: "0.9998", expectedRate: "0.0218" },
		});
	});
	it("lists the most staked first, and leaves out what has no address or stake", () => {
		const small = "0x00000000000000000000000000000000000000bb";
		const twin = "0x00000000000000000000000000000000000000aa";
		const list = parseValidators([
			row({ validator: small, stake: 100 }),
			row({ validator: "nobody" }),
			row({ stake: "a lot" }),
			null,
			row(),
			row({ validator: twin, stake: 100 }),
		]);
		expect(list?.map((v) => v.address)).toEqual([
			"0xa82fe73bbd768bc15d1ef2f6142a21ff8bd762ad",
			twin,
			small,
		]);
	});
	it("lists equally staked validators in one order, however they arrive", () => {
		const a = row({ validator: JAILED, stake: 7 });
		const b = row({ validator: INACTIVE, stake: 7 });
		const order = (rows: unknown[]) =>
			parseValidators(rows)?.map((v) => v.address);
		expect(order([a, b])).toEqual([JAILED, INACTIVE]);
		expect(order([b, a])).toEqual([JAILED, INACTIVE]);
	});
	it("takes nothing for granted about a row", () => {
		const bare = read({
			name: 7,
			description: null,
			isActive: "yes",
			isJailed: 1,
			commission: undefined,
			stats: undefined,
		});
		expect(bare).toMatchObject({
			name: "",
			description: "",
			isActive: false,
			isJailed: false,
			commission: null,
			day: null,
			week: null,
			month: null,
		});
		expect(read({ stats: [["day", "fine"], "week"] }).day).toBeNull();
		expect(read({ stats: [["day", {}]] }).day).toEqual({
			uptime: null,
			expectedRate: null,
		});
	});
	it("another shape is not read", () => {
		expect(parseValidators({ validators: [] })).toBeNull();
	});

	it("gives Hyperliquid's estimate over the longest window it has", () => {
		expect(expectedRate(read())).toBe("0.0218");
		expect(
			expectedRate(
				read({
					stats: [(row().stats as unknown[])[0], (row().stats as unknown[])[1]],
				}),
			),
		).toBe("0.0217");
		expect(expectedRate(read({ stats: [(row().stats as unknown[])[0]] }))).toBe(
			"0.0216",
		);
		expect(expectedRate(read({ stats: [] }))).toBeNull();
	});

	const ZERO_STATS = [
		["month", { uptimeFraction: "0.0", predictedApr: "0.0", nSamples: 1 }],
	];
	it.each([
		[
			"jailed",
			{ isJailed: true, isActive: false, stats: ZERO_STATS },
			"jailed",
		],
		// testnet has validators flagged active and jailed at once: jailed decides
		["jailed", { isJailed: true, isActive: true, stats: ZERO_STATS }, "jailed"],
		[
			"outside the working set",
			{ isActive: false, stats: ZERO_STATS },
			"outside",
		],
		[
			"keeping everything",
			{ commission: "1.0", stats: ZERO_STATS },
			"keeps-all",
		],
		["expected to pay nothing", { stats: ZERO_STATS }, "no-rate"],
	] as const)("a validator that is %s pays nothing", (_name, over, why) => {
		expect(validatorPays(read(over))).toEqual({ pays: false, why });
	});
	it("one that works pays, and what is not known is not held against it", () => {
		expect(validatorPays(read())).toEqual({ pays: true });
		expect(validatorPays(read({ commission: null, stats: [] }))).toEqual({
			pays: true,
		});
	});
});
