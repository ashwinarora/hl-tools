import { describe, expect, it } from "vitest";
import {
	createProposal,
	decodeProposal,
	encodeProposal,
	type Hex,
	judgeMove,
	type MoveFlaw,
	mergeProposals,
	moveHeadline,
	moveOf,
	moveShape,
	otherStep,
	type PlainObject,
	type Proposal,
	type ProposalInput,
	stepNumber,
	tieSteps,
	validateProposal,
	vaultMoveShape,
} from "../../src/multisig/index.ts";
import {
	A,
	B,
	codes,
	NONCE,
	NOW,
	RECIPIENT,
	TREASURY,
	VAULT,
} from "./_helpers.ts";

const X = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
const Y = "0x0014b26bde5766c0c0f94130af5c4bf4551eeef6";
const HYPE = 100_000_000;

const chain = (network: "testnet" | "mainnet" = "testnet") => ({
	signatureChainId: "0x66eee",
	hyperliquidChain: network === "testnet" ? "Testnet" : "Mainnet",
});
const moveIn = (hype: number, nonce: number): PlainObject => ({
	type: "cDeposit",
	...chain(),
	wei: hype * HYPE,
	nonce,
});
const back = (hype: number, nonce: number): PlainObject => ({
	type: "cWithdraw",
	...chain(),
	wei: hype * HYPE,
	nonce,
});
const stake = (
	hype: number,
	validator: string,
	nonce: number,
	isUndelegate = false,
): PlainObject => ({
	type: "tokenDelegate",
	...chain(),
	validator,
	wei: hype * HYPE,
	isUndelegate,
	nonce,
});
const unstake = (hype: number, validator: string, nonce: number) =>
	stake(hype, validator, nonce, true);

/** A proposal as the form makes it. */
function proposal(
	action: PlainObject,
	over: Partial<ProposalInput> = {},
): Proposal {
	const r = createProposal(
		{
			network: "testnet",
			multiSigUser: TREASURY,
			outerSigner: A,
			action,
			nonce: (action.nonce ?? action.time) as number,
			createdBy: A,
			...over,
		},
		{ now: NOW },
	);
	if (!r.proposal) throw new Error(JSON.stringify(r.issues));
	return r.proposal;
}
/** The two steps of "stake 100 with X" when 50 is already in the staking balance. */
const pair = (): readonly [Proposal, Proposal] =>
	tieSteps(proposal(moveIn(50, NONCE)), proposal(stake(100, X, NONCE + 1)));

describe("tying two proposals into a move", () => {
	it("writes the same list into both and changes neither digest", () => {
		const one = proposal(moveIn(50, NONCE));
		const two = proposal(stake(100, X, NONCE + 1));
		const [first, second] = tieSteps(one, two);
		expect(first.meta.steps).toEqual([one.digest, two.digest]);
		expect(second.meta.steps).toEqual([one.digest, two.digest]);
		expect(first.digest).toBe(one.digest);
		expect(second.digest).toBe(two.digest);
		expect(
			validateProposal(JSON.parse(encodeProposal(first)), { now: NOW }).issues,
		).toEqual([]);
	});
	it("each step knows its number and the other step", () => {
		const [first, second] = pair();
		expect([stepNumber(first), stepNumber(second)]).toEqual([1, 2]);
		expect(otherStep(first)).toBe(second.digest);
		expect(otherStep(second)).toBe(first.digest);
		const alone = proposal(moveIn(1, NONCE));
		expect(stepNumber(alone)).toBeNull();
		expect(otherStep(alone)).toBeNull();
		// a list that does not name the proposal says nothing about it
		const stray = {
			...alone,
			meta: { ...alone.meta, steps: first.meta.steps },
		};
		expect(stepNumber(stray)).toBeNull();
		expect(otherStep(stray)).toBeNull();
	});
});

describe("the tie in the document", () => {
	it("a proposal that stands alone is written exactly as before there were moves", () => {
		const alone = proposal(moveIn(1, NONCE));
		const parsed = JSON.parse(encodeProposal(alone));
		expect(Object.keys(parsed.meta)).toEqual([
			"kind",
			"title",
			"note",
			"createdBy",
			"createdAt",
			"supersedes",
			"policyAtCreation",
		]);
		expect(
			decodeProposal(encodeProposal(alone), { now: NOW }).proposal?.meta.steps,
		).toBeNull();
	});
	it("a step carries the list, last in its unsigned part, and it survives the round trip", () => {
		const [first] = pair();
		const text = encodeProposal(first);
		expect(Object.keys(JSON.parse(text).meta).at(-1)).toBe("steps");
		const read = decodeProposal(text, { now: NOW });
		expect(read.issues).toEqual([]);
		expect(read.proposal?.meta.steps).toEqual(first.meta.steps);
		expect(encodeProposal(read.proposal as Proposal)).toBe(text);
	});
	it("digests written in capitals are read in lowercase", () => {
		const [first] = pair();
		const doc = JSON.parse(encodeProposal(first));
		doc.meta.steps = doc.meta.steps.map(
			(d: string) => `0x${d.slice(2).toUpperCase()}`,
		);
		expect(validateProposal(doc, { now: NOW }).proposal?.meta.steps).toEqual(
			first.meta.steps,
		);
	});

	const other = `0x${"ab".repeat(32)}` as Hex;
	it.each([
		["three entries", (own: Hex) => [own, other, `0x${"cd".repeat(32)}`]],
		["one entry", (own: Hex) => [own]],
		["the same digest twice", (own: Hex) => [own, own]],
		["something that is no digest", (own: Hex) => [own, "step two"]],
		["a number among them", (own: Hex) => [own, 2]],
		["no list at all", (own: Hex) => `${own},${other}`],
		["a list this proposal is not on", () => [other, `0x${"cd".repeat(32)}`]],
	])("%s is dropped with a warning, and the proposal still opens", (_n, list) => {
		const alone = proposal(moveIn(1, NONCE));
		const doc = JSON.parse(encodeProposal(alone));
		doc.meta.steps = list(alone.digest);
		const read = validateProposal(doc, { now: NOW });
		expect(read.proposal?.digest).toBe(alone.digest);
		expect(read.proposal?.meta.steps).toBeNull();
		expect(codes(read.issues)).toEqual(["meta.steps"]);
		expect(read.issues[0]?.severity).toBe("warning");
	});

	it("a merge never ties a proposal that stands alone, and never unties one", async () => {
		const [first] = pair();
		const alone = { ...first, meta: { ...first.meta, steps: null } };
		expect((await mergeProposals(alone, first)).merged?.meta.steps).toBeNull();
		expect((await mergeProposals(first, alone)).merged?.meta.steps).toEqual(
			first.meta.steps,
		);
	});
});

describe("the moves two staking actions can make", () => {
	const s = (kind: "stake" | "unstake", amount: string, validator: string) =>
		({ kind, amount, validator }) as const;
	it("move in, then stake", () => {
		expect(
			moveShape({ kind: "moveIn", amount: "50" }, s("stake", "100", X)),
		).toEqual({
			kind: "stake",
			amount: "100",
			validator: X,
			to: null,
		});
		// everything comes from spot
		expect(
			moveShape({ kind: "moveIn", amount: "100" }, s("stake", "100", X))?.kind,
		).toBe("stake");
	});
	it("unstake, then return", () => {
		expect(
			moveShape(s("unstake", "40", X), { kind: "return", amount: "100" }),
		).toEqual({
			kind: "return",
			amount: "100",
			validator: X,
			to: null,
		});
	});
	it("unstake from one, then stake with another", () => {
		expect(moveShape(s("unstake", "100", X), s("stake", "100", Y))).toEqual({
			kind: "switch",
			amount: "100",
			validator: X,
			to: Y,
		});
	});
	it.each([
		[
			"a first step that moves in more than is staked",
			{ kind: "moveIn", amount: "101" },
			s("stake", "100", X),
		],
		[
			"a first step that unstakes more than is returned",
			s("unstake", "101", X),
			{ kind: "return", amount: "100" },
		],
		[
			"unstake and stake with the same validator",
			s("unstake", "100", X),
			s("stake", "100", X),
		],
		[
			"unstake and stake of different amounts",
			s("unstake", "100", X),
			s("stake", "90", Y),
		],
		[
			"the steps the wrong way round",
			s("stake", "100", X),
			{ kind: "moveIn", amount: "50" },
		],
		[
			"two of a kind",
			{ kind: "moveIn", amount: "1" },
			{ kind: "moveIn", amount: "1" },
		],
		[
			"a return, then a stake",
			{ kind: "return", amount: "1" },
			s("stake", "1", X),
		],
	] as const)("%s is no move", (_n, first, second) => {
		expect(moveShape(first, second)).toBeNull();
	});
});

describe("whether two proposals are one move", () => {
	it("stake: one move, named by what it comes to", () => {
		const [first, second] = pair();
		// in either order, and found by either step
		for (const [a, b] of [
			[first, second],
			[second, first],
		] as const) {
			const judged = judgeMove(a, b);
			expect(judged.flaw).toBeNull();
			expect(judged.move).toMatchObject({
				kind: "stake",
				amount: "100",
				validator: X,
				to: null,
			});
			expect(judged.move?.steps.map((p) => p.digest)).toEqual([
				first.digest,
				second.digest,
			]);
		}
		expect(moveHeadline(moveOf(first, second) as never)).toBe(
			`Stake 100 HYPE with validator ${X}`,
		);
	});
	it("return and switch", () => {
		const ret = tieSteps(
			proposal(unstake(40, X, NONCE)),
			proposal(back(100, NONCE + 1)),
		);
		expect(moveOf(...ret)).toMatchObject({
			kind: "return",
			amount: "100",
			validator: X,
		});
		expect(moveHeadline(moveOf(...ret) as never)).toBe(
			"Return 100 HYPE to the spot balance",
		);
		const sw = tieSteps(
			proposal(unstake(100, X, NONCE)),
			proposal(stake(100, Y, NONCE + 1)),
		);
		expect(moveOf(...sw)).toMatchObject({
			kind: "switch",
			validator: X,
			to: Y,
		});
		expect(moveHeadline(moveOf(...sw) as never)).toBe(
			`Move 100 HYPE from validator ${X} to validator ${Y}`,
		);
	});
	it("who proposed is taken from the relay when it says so, not from the documents", () => {
		const [first, second] = pair();
		expect(judgeMove(first, second, { a: A, b: A }).flaw).toBeNull();
		expect(judgeMove(first, second, { a: A, b: B }).flaw).toBe("proposer");
		expect(judgeMove(first, second, { a: null, b: null }).flaw).toBe(
			"proposer",
		);
	});

	const tied = (first: Proposal, second: Proposal) => tieSteps(first, second);
	const withMeta = (
		p: Proposal,
		meta: Partial<Proposal["meta"]>,
	): Proposal => ({
		...p,
		meta: { ...p.meta, ...meta },
	});
	const withPayload = (
		p: Proposal,
		payload: Partial<Proposal["payload"]>,
	): Proposal => ({
		...p,
		payload: { ...p.payload, ...payload },
	});
	const one = () => proposal(moveIn(50, NONCE));
	const two = () => proposal(stake(100, X, NONCE + 1));
	const FLAWS: [string, MoveFlaw, () => readonly [Proposal, Proposal]][] = [
		["neither is tied", "untied", () => [one(), two()]],
		["only one is tied", "untied", () => [pair()[0], two()]],
		[
			"they carry different lists",
			"other-list",
			() => {
				const [first, second] = pair();
				return [
					first,
					withMeta(second, { steps: [second.digest, first.digest] }),
				];
			},
		],
		[
			"the second names a third proposal as its other step",
			"other-list",
			() => {
				const [first, second] = pair();
				const third = proposal(stake(100, X, NONCE + 2));
				return [
					first,
					withMeta(second, { steps: [first.digest, third.digest] }),
				];
			},
		],
		[
			"one of them is not on the list both carry",
			"not-on-list",
			() => {
				const [first] = pair();
				const third = proposal(stake(100, X, NONCE + 2));
				return [first, withMeta(third, { steps: first.meta.steps })];
			},
		],
		[
			"another network",
			"network",
			() => {
				const [first, second] = pair();
				return [first, withPayload(second, { network: "mainnet" })];
			},
		],
		[
			"another account",
			"account",
			() =>
				tied(
					one(),
					proposal(stake(100, X, NONCE + 1), { multiSigUser: RECIPIENT }),
				),
		],
		[
			"another finaliser",
			"finaliser",
			() => tied(one(), proposal(stake(100, X, NONCE + 1), { outerSigner: B })),
		],
		[
			"another proposer",
			"proposer",
			() => tied(one(), proposal(stake(100, X, NONCE + 1), { createdBy: B })),
		],
		[
			"a proposer nobody names",
			"proposer",
			() =>
				tied(
					proposal(moveIn(50, NONCE), { createdBy: null }),
					proposal(stake(100, X, NONCE + 1), { createdBy: null }),
				),
		],
		[
			"signed under different chains",
			"form",
			() =>
				tied(
					one(),
					proposal({ ...stake(100, X, NONCE + 1), signatureChainId: "0x3e6" }),
				),
		],
		[
			"a vault named beside it",
			"form",
			() => {
				const [first, second] = pair();
				return [first, withPayload(second, { vaultAddress: VAULT })];
			},
		],
		[
			"an expiry named beside it",
			"form",
			() => {
				const [first, second] = pair();
				return [withPayload(first, { expiresAfter: NOW }), second];
			},
		],
		[
			"a kind that is signed as a bare hash",
			"form",
			() => {
				const [first, second] = pair();
				return [withMeta(first, { kind: "l1" }), second];
			},
		],
		[
			"the second step is numbered before the first",
			"order",
			() => tied(proposal(moveIn(50, NONCE + 5)), two()),
		],
		[
			"a send dressed up as the first step of a stake",
			"shape",
			() =>
				tied(
					proposal({
						type: "usdSend",
						...chain(),
						destination: RECIPIENT,
						amount: "5000",
						time: NONCE,
					}),
					two(),
				),
		],
		[
			"a first step that moves in more than the move says",
			"shape",
			() => tied(proposal(moveIn(5000, NONCE)), two()),
		],
	];
	it.each(FLAWS)("not when %s", (_name, flaw, make) => {
		const [a, b] = make();
		expect(judgeMove(a, b)).toEqual({ move: null, flaw });
		expect(judgeMove(b, a)).toEqual({ move: null, flaw });
		expect(moveOf(a, b)).toBeNull();
	});
});

describe("a vault deposit in two steps: USDC to perps, then the deposit", () => {
	const DEPOSIT_VAULT = "0x49d05977597b22e3c73d654c351adde9d9920e18";
	const HLP = "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0";
	const toPerps = (
		amount: string,
		nonce: number,
		toPerp = true,
	): PlainObject => ({
		type: "usdClassTransfer",
		...chain(),
		amount,
		toPerp,
		nonce,
	});
	const deposit = (
		usdc: number,
		isDeposit = true,
		vaultAddress = DEPOSIT_VAULT,
	): PlainObject => ({
		type: "vaultTransfer",
		vaultAddress,
		isDeposit,
		usd: usdc * 1_000_000,
	});
	/** An L1 proposal carries its number beside the action, not inside it. */
	const l1 = (
		action: PlainObject,
		nonce: number,
		over: Partial<ProposalInput> = {},
	) => proposal(action, { nonce, ...over });
	const vaultPair = (moved = "30", into = 50) =>
		tieSteps(proposal(toPerps(moved, NONCE)), l1(deposit(into), NONCE + 1));
	const withMeta = (
		p: Proposal,
		meta: Partial<Proposal["meta"]>,
	): Proposal => ({
		...p,
		meta: { ...p.meta, ...meta },
	});
	const withPayload = (
		p: Proposal,
		payload: Partial<Proposal["payload"]>,
	): Proposal => ({ ...p, payload: { ...p.payload, ...payload } });

	it("is one move, named by the deposit, though its steps are signed in two ways", () => {
		const [first, second] = vaultPair();
		expect(first.meta.kind).toBe("user-signed");
		expect(second.meta.kind).toBe("l1");
		for (const [a, b] of [
			[first, second],
			[second, first],
		] as const) {
			const judged = judgeMove(a, b);
			expect(judged.flaw).toBeNull();
			expect(judged.move).toMatchObject({
				kind: "vault",
				amount: "50",
				vault: DEPOSIT_VAULT,
				validator: "",
				to: null,
			});
		}
		expect(moveHeadline(moveOf(first, second) as never)).toBe(
			`Deposit 50 USDC into vault ${DEPOSIT_VAULT}`,
		);
		// HLP by its name
		const hlp = tieSteps(
			proposal(toPerps("50", NONCE)),
			l1(deposit(50, true, HLP), NONCE + 1),
		);
		expect(moveHeadline(moveOf(...hlp) as never)).toBe(
			`Deposit 50 USDC into HLP, Hyperliquid's own vault, ${HLP}`,
		);
		// the whole amount may come from spot
		expect(moveOf(...vaultPair("50", 50))?.amount).toBe("50");
		// a shape that names no vault still reads as a line
		expect(
			moveHeadline({ kind: "vault", amount: "5", validator: "", to: null }),
		).toBe("Deposit 5 USDC into vault ");
	});

	it("is a shape of its own: the staking moves stay readable on both steps", () => {
		expect(
			vaultMoveShape(toPerps("30", NONCE), {
				kind: "deposit",
				vault: DEPOSIT_VAULT,
				amount: "50",
			}),
		).toEqual({
			kind: "vault",
			amount: "50",
			validator: "",
			to: null,
			vault: DEPOSIT_VAULT,
		});
		const dep = {
			kind: "deposit" as const,
			vault: DEPOSIT_VAULT,
			amount: "50",
		};
		for (const first of [
			// more than the deposit: the headline would understate what moves
			toPerps("50.000001", NONCE),
			// the other direction
			toPerps("30", NONCE, false),
			toPerps("0", NONCE),
			{ ...toPerps("30", NONCE), amount: 30 },
			{ ...toPerps("30", NONCE), amount: "much" },
			{ ...toPerps("30", NONCE), type: "usdSend" },
			null,
			"usdClassTransfer",
			[toPerps("30", NONCE)],
		])
			expect(vaultMoveShape(first, dep)).toBeNull();
		expect(
			vaultMoveShape(toPerps("30", NONCE), { ...dep, kind: "withdraw" }),
		).toBeNull();
	});

	const FLAWS: [string, MoveFlaw, () => readonly [Proposal, Proposal]][] = [
		[
			"the first step moves more than the deposit",
			"shape",
			() => vaultPair("60", 50),
		],
		[
			"the first step moves USDC out of perps",
			"shape",
			() =>
				tieSteps(
					proposal(toPerps("30", NONCE, false)),
					l1(deposit(50), NONCE + 1),
				),
		],
		[
			"a send dressed up as the first step of a deposit",
			"shape",
			() =>
				tieSteps(
					proposal({
						type: "usdSend",
						...chain(),
						destination: RECIPIENT,
						amount: "30",
						time: NONCE,
					}),
					l1(deposit(50), NONCE + 1),
				),
		],
		[
			"a staking step in front of a deposit",
			"shape",
			() => tieSteps(proposal(moveIn(50, NONCE)), l1(deposit(50), NONCE + 1)),
		],
		[
			"the second step is a withdrawal",
			"form",
			() =>
				tieSteps(
					proposal(toPerps("30", NONCE)),
					l1(deposit(50, false), NONCE + 1),
				),
		],
		[
			"the second step is another action signed as a hash",
			"form",
			() =>
				tieSteps(
					proposal(toPerps("30", NONCE)),
					l1({ type: "noop" }, NONCE + 1),
				),
		],
		[
			"the deposit comes first",
			"form",
			() =>
				tieSteps(l1(deposit(50), NONCE), proposal(toPerps("30", NONCE + 1))),
		],
		[
			"the deposit acts for a vault or sub-account",
			"form",
			() => {
				const [first, second] = vaultPair();
				return [first, withPayload(second, { vaultAddress: VAULT })];
			},
		],
		[
			"the deposit carries an expiry",
			"form",
			() => {
				const [first, second] = vaultPair();
				return [first, withPayload(second, { expiresAfter: NOW })];
			},
		],
		[
			"the deposit claims to be the readable kind",
			"form",
			() => {
				const [first, second] = vaultPair();
				return [first, withMeta(second, { kind: "user-signed" })];
			},
		],
		[
			"a stake claims to be signed as a hash",
			"form",
			() => {
				const [first, second] = pair();
				return [first, withMeta(second, { kind: "l1" })];
			},
		],
		[
			"the deposit is numbered before the transfer",
			"order",
			() =>
				tieSteps(
					proposal(toPerps("30", NONCE + 5)),
					l1(deposit(50), NONCE + 1),
				),
		],
		[
			"another finaliser on the deposit",
			"finaliser",
			() =>
				tieSteps(
					proposal(toPerps("30", NONCE)),
					l1(deposit(50), NONCE + 1, { outerSigner: B }),
				),
		],
	];
	it.each(FLAWS)("not when %s", (_name, flaw, make) => {
		const [a, b] = make();
		expect(judgeMove(a, b)).toEqual({ move: null, flaw });
		expect(judgeMove(b, a)).toEqual({ move: null, flaw });
	});
});
