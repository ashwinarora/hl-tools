import {
	classifySignatures,
	type Move,
	type Proposal,
	readiness,
	tieSteps,
	type Validator,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, makeProposal, NONCE, NOW, POLICY, signAs } from "#/test/keys";
import { HELP_JARGON } from "./help";
import {
	deriveMoveStage,
	LONE_STEP_HINT,
	leftOpenNote,
	loneStep,
	type MovePhase,
	moveRefs,
	moveSentence,
	pairMoves,
	type StepView,
	sayOncePerMove,
	stepMark,
} from "./move";
import type { Part } from "./parts";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import { deriveStage, type Phase, type Stage } from "./stage";

const X = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
const Y = "0x0014b26bde5766c0c0f94130af5c4bf4551eeef6";

/** A step as far as a move reads it. */
const step = (
	phase: Phase,
	over: Partial<Stage> = {},
	have = 1,
	need: number | null = 2,
): StepView => ({
	stage: {
		phase,
		headline: `[${phase}]`,
		detail: `<${phase}>`,
		canSign: false,
		hasSigned: false,
		canExecute: false,
		executeAddsSignature: false,
		executeReason: `no: ${phase}`,
		opensAt: null,
		...over,
	} as Stage,
	have,
	need,
});
const collecting = (over: Partial<Stage> = {}, have = 1) =>
	step("collecting", { canSign: true, ...over }, have);
const ready = (over: Partial<Stage> = {}) =>
	step("ready", { canExecute: true, executeReason: null, ...over }, 2);
const done = () => step("submitted", {}, 2);

describe("a move in one line", () => {
	const validators = [
		{ address: X, name: "Hypurr" },
		{ address: Y, name: "" },
	] as Validator[];
	const move = (
		kind: Move["kind"],
		to: string | null = null,
	): Pick<Move, "kind" | "amount" | "validator" | "to"> => ({
		kind,
		amount: "100",
		validator: X,
		to,
	});
	it("names where the HYPE ends up, and the validators by their own names", () => {
		expect(moveSentence(move("stake"), validators)).toBe(
			"Stake 100 HYPE with Hypurr (0x946b…5b21)",
		);
		expect(moveSentence(move("return"), validators)).toBe(
			"Return 100 HYPE to spot",
		);
		expect(moveSentence(move("switch", Y), validators)).toBe(
			"Move 100 HYPE from Hypurr (0x946b…5b21) to 0x0014…eef6",
		);
		// before the list of validators is read: addresses
		expect(moveSentence(move("stake"))).toBe("Stake 100 HYPE with 0x946b…5b21");
	});
});

describe("what two steps mean together", () => {
	it.each<[string, StepView, StepView, MovePhase]>([
		["both still collect", collecting(), collecting(), "collecting"],
		["one is ready, the other collects", ready(), collecting(), "collecting"],
		["both are ready", ready(), ready(), "ready"],
		["step 1 is done, step 2 collects", done(), collecting(), "half"],
		["step 1 is done, step 2 is ready", done(), ready(), "half"],
		["both are done", done(), done(), "done"],
		[
			"both were carried out some other way",
			step("carried-out"),
			step("carried-out"),
			"done",
		],
		["step 1 was refused", step("refused"), ready(), "halted"],
		["step 1 was withdrawn", step("withdrawn"), step("withdrawn"), "halted"],
		["step 1 expired", step("expired"), step("expired"), "halted"],
		["step 2 can no longer follow", ready(), step("withdrawn"), "halted"],
		["step 1 is done, step 2 was refused", done(), step("refused"), "broken"],
		["step 1 is done, step 2 expired", done(), step("expired"), "broken"],
		["a step is still being judged", step("judging"), ready(), "judging"],
		["the signer set is not read", ready(), step("unknown"), "judging"],
		["too many said no to a step", step("cannot-pass"), collecting(), "held"],
		["the finaliser said no to a step", ready(), step("finaliser-no"), "held"],
	])("%s", (_name, one, two, phase) => {
		expect(deriveMoveStage([one, two]).phase).toBe(phase);
	});

	it("nothing is to be sent or signed once a move is over", () => {
		for (const pair of [
			[done(), done()],
			[step("refused"), ready()],
			[ready(), step("withdrawn")],
			[done(), step("refused")],
		] as [StepView, StepView][]) {
			const m = deriveMoveStage(pair);
			expect(m.settled).toBe(true);
			expect([m.toSend, m.toSign, m.canSign, m.canExecute, m.prompts]).toEqual([
				[],
				[],
				false,
				false,
				0,
			]);
			expect(m.executeReason).not.toBeNull();
		}
	});

	it('a step answered "duplicate nonce" is never said to be not carried out', () => {
		const duplicate = (detail: string) =>
			step("refused", {
				detail,
				failedAttempt: { id: "nonce-duplicate" } as Stage["failedAttempt"],
			});
		// its number was used before: by a refusal, or by a submission that
		// went through and whose answer never got here
		const one = deriveMoveStage([duplicate("Look first."), ready()]);
		expect([one.phase, one.unsure, one.settled]).toEqual(["halted", 0, true]);
		expect(one.headline).toBe(
			"Step 1 may be carried out already · look before proposing again",
		);
		expect(one.detail).toBe(
			"Step 1: Look first. Step 2 was not sent. If step 1 was carried out, only step 2 is left to propose; if it was not, the whole move is.",
		);
		const two = deriveMoveStage([done(), duplicate("Look first.")]);
		expect([two.phase, two.unsure]).toEqual(["broken", 1]);
		expect(two.headline).toBe("Step 1 was carried out · step 2 may be too");
		expect(two.detail).toBe("Step 2: Look first.");
		for (const m of [one, two])
			expect(`${m.headline} ${m.detail} ${m.executeReason}`).not.toContain(
				"not carried out",
			);
		// any other refusal is what it was before
		const plain = deriveMoveStage([step("refused"), ready()]);
		expect([plain.unsure, plain.headline]).toEqual([
			null,
			"Step 1 was not carried out, so step 2 is not sent",
		]);
		expect(deriveMoveStage([done(), step("refused")]).unsure).toBeNull();
		expect(deriveMoveStage([ready(), ready()]).unsure).toBeNull();
	});

	it("a move that is over but still open on the relay says who can clear it", () => {
		expect(leftOpenNote(true)).toBe(
			"What is left of this move cannot be submitted, so nothing here needs a signature. Withdraw it, then propose it again.",
		);
		expect(leftOpenNote(false)).toBe(
			"What is left of this move cannot be submitted, so nothing here needs your signature. Its proposer can withdraw it and propose it again.",
		);
	});

	it("step 1 is never sent alone when step 2 can no longer follow", () => {
		const m = deriveMoveStage([ready(), step("expired")]);
		expect(m.canExecute).toBe(false);
		expect(m.headline).toBe(
			"Step 2 can no longer follow, so step 1 is not sent",
		);
		expect(m.detail).toContain("half done");
	});

	it("says where each step stands while signatures are collected", () => {
		const m = deriveMoveStage([collecting({}, 1), collecting({}, 0)]);
		expect(m.headline).toBe(
			"Collecting signatures · step 1: 1 of 2 · step 2: 0 of 2",
		);
		expect(m.toSign).toEqual([0, 1]);
		expect(m.canSign).toBe(true);
		expect(m.canExecute).toBe(false);
		expect(m.executeReason).toBe("Step 1: no: collecting");
		// a signer who signed one of the two has the other left
		const half = deriveMoveStage([
			collecting({ canSign: false, hasSigned: true }),
			collecting(),
		]);
		expect([half.toSign, half.signed]).toEqual([[1], 1]);
	});

	it("the finaliser sends both in one go: one prompt each, two where their own signature is still missing", () => {
		const both = deriveMoveStage([ready(), ready()]);
		expect(both.headline).toBe("Ready · both steps have their signatures");
		expect([both.toSend, both.canExecute, both.prompts]).toEqual([
			[0, 1],
			true,
			2,
		]);
		const completing = deriveMoveStage([
			collecting({
				canExecute: true,
				executeReason: null,
				executeAddsSignature: true,
			}),
			collecting({
				canExecute: true,
				executeReason: null,
				executeAddsSignature: true,
			}),
		]);
		expect([
			completing.phase,
			completing.canExecute,
			completing.prompts,
		]).toEqual(["collecting", true, 4]);
		// one step lacks a signature the finaliser cannot give: nothing is sent yet
		const waiting = deriveMoveStage([ready(), collecting()]);
		expect(waiting.canExecute).toBe(false);
		expect(waiting.executeReason).toBe("Step 2: no: collecting");
	});

	it("once step 1 is carried out, only step 2 is left to sign and send", () => {
		const m = deriveMoveStage([done(), ready()]);
		expect(m.headline).toBe(
			"Step 1 is carried out · step 2 is ready to be sent",
		);
		expect([m.toSend, m.canExecute, m.prompts, m.settled]).toEqual([
			[1],
			true,
			1,
			false,
		]);
		const collects = deriveMoveStage([done(), collecting({}, 1)]);
		expect(collects.headline).toBe(
			"Step 1 is carried out · step 2 has 1 of 2 signatures",
		);
		expect(collects.toSign).toEqual([1]);
		expect(collects.executeReason).toBe("no: collecting");
	});

	it("a step that waits for a lockup makes the move wait, and says until when", () => {
		const held = (at: number) =>
			step(
				"ready",
				{ canExecute: false, executeReason: "locked", opensAt: at },
				2,
			);
		const m = deriveMoveStage([held(5_000), ready()]);
		expect([m.phase, m.canExecute, m.opensAt]).toEqual(["ready", false, 5_000]);
		expect(m.executeReason).toBe("Step 1: locked");
		// something else is in the way as well: time is not the only thing
		expect(deriveMoveStage([held(5_000), collecting()]).opensAt).toBeNull();
		expect(deriveMoveStage([held(5_000), held(9_000)]).opensAt).toBe(9_000);
	});

	it("a no on one step holds the move, in that step's own words", () => {
		const m = deriveMoveStage([
			step("cannot-pass", { canSign: true }),
			collecting(),
		]);
		expect(m.headline).toBe("[cannot-pass]");
		expect(m.detail).toBe("Step 1 of this move: <cannot-pass>");
		expect(m.settled).toBe(false);
		expect(m.toSign).toEqual([0, 1]);
	});

	it("what stopped a move is said with the step it stopped at", () => {
		expect(deriveMoveStage([step("refused"), ready()]).detail).toBe(
			"Step 1: [refused]. The second step makes sense only after the first, so it stays where it is. Propose the move again if it is still wanted.",
		);
		expect(deriveMoveStage([done(), step("refused")]).detail).toBe(
			"Step 2: [refused]. Proposing the move again makes only the step that is left.",
		);
	});

	it("promises nothing and uses no developer's words", () => {
		const texts = (
			[
				[collecting(), collecting()],
				[ready(), ready()],
				[done(), ready()],
				[done(), done()],
				[step("refused"), ready()],
				[ready(), step("expired")],
				[done(), step("refused")],
				[step("judging"), ready()],
			] as [StepView, StepView][]
		).flatMap((pair) => {
			const m = deriveMoveStage(pair);
			return [m.headline, m.detail, m.executeReason ?? ""];
		});
		for (const t of texts) {
			for (const claim of FORBIDDEN_CLAIMS)
				expect(t, `${claim} in "${t}"`).not.toMatch(claim);
			for (const word of HELP_JARGON)
				expect(t, `${word} in "${t}"`).not.toMatch(word);
		}
	});
});

describe("two real steps, judged as their own pages judge them", () => {
	const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
	const pair = (): readonly [Proposal, Proposal] =>
		tieSteps(
			makeProposal({
				action: { type: "cDeposit", ...HEAD, wei: 5_000_000_000, nonce: NONCE },
			}),
			makeProposal({
				action: {
					type: "tokenDelegate",
					...HEAD,
					validator: X,
					wei: 10_000_000_000,
					isUndelegate: false,
					nonce: NONCE + 1,
				},
				nonce: NONCE + 1,
			}),
		);
	const view = async (p: Proposal, wallet: string): Promise<StepView> => {
		const classified = await classifySignatures(p, POLICY);
		const r = readiness(p, POLICY, classified, { now: NOW });
		return {
			stage: deriveStage({
				proposal: p,
				readiness: r,
				policy: POLICY,
				wallet,
				walletChainId: 998,
				now: NOW,
			}),
			have: r.have,
			need: r.need,
		};
	};

	it("A signed both, B finalises: B's click signs and sends both", async () => {
		const [one, two] = pair();
		const signed = [await signAs(one, 1), await signAs(two, 1)] as const;
		const asB = deriveMoveStage([
			await view(signed[0], B),
			await view(signed[1], B),
		]);
		expect(asB.headline).toBe(
			"Collecting signatures · step 1: 1 of 2 · step 2: 1 of 2",
		);
		expect([asB.canExecute, asB.prompts, asB.toSend]).toEqual([
			true,
			4,
			[0, 1],
		]);
		// C can sign both; A has signed both and can only wait
		const asC = deriveMoveStage([
			await view(signed[0], C),
			await view(signed[1], C),
		]);
		expect([asC.toSign, asC.canExecute]).toEqual([[0, 1], false]);
		const asA = deriveMoveStage([
			await view(signed[0], A),
			await view(signed[1], A),
		]);
		expect([asA.toSign, asA.signed, asA.canExecute]).toEqual([[], 2, false]);
	});
});

describe("a list with the two steps of a move made one item", () => {
	const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
	const moveIn = (nonce: number) =>
		makeProposal({
			action: { type: "cDeposit", ...HEAD, wei: 5_000_000_000, nonce },
			nonce,
		});
	const stake = (nonce: number) =>
		makeProposal({
			action: {
				type: "tokenDelegate",
				...HEAD,
				validator: X,
				wei: 10_000_000_000,
				isUndelegate: false,
				nonce,
			},
			nonce,
		});
	const send = makeProposal({ title: "a send" });
	interface Item {
		proposal: Proposal;
		proposedBy: string | null;
		label: string;
	}
	const item = (
		proposal: Proposal,
		label: string,
		proposedBy: string | null = A,
	): Item => ({ proposal, proposedBy, label });
	const merge = (first: Item, second: Item, move: Move): Item => ({
		...first,
		label: `${move.kind}(${first.label}+${second.label})`,
	});
	const labels = (items: Item[]) => pairMoves(items, merge).map((i) => i.label);

	it("puts the move where its first-listed step was, whichever step that is", () => {
		const [one, two] = tieSteps(moveIn(NONCE), stake(NONCE + 1));
		expect(
			labels([item(send, "send"), item(one, "1"), item(two, "2")]),
		).toEqual(["send", "stake(1+2)"]);
		// listed newest first, as the relay gives them
		expect(
			labels([item(two, "2"), item(send, "send"), item(one, "1")]),
		).toEqual(["stake(1+2)", "send"]);
	});
	it("leaves a step alone whose other step is not in the list", () => {
		const [one, two] = tieSteps(moveIn(NONCE), stake(NONCE + 1));
		expect(labels([item(two, "2"), item(send, "send")])).toEqual(["2", "send"]);
		expect(labels([item(one, "1")])).toEqual(["1"]);
	});
	it("a lone step is tagged with its number only where the list can stand behind it", () => {
		const [one, two] = tieSteps(moveIn(NONCE), stake(NONCE + 1));
		const only = (...ps: Proposal[]) => new Set(ps.map((p) => p.digest));
		// the other step is not listed: carried out, closed, or never shared
		expect(loneStep(two, only(two, send))).toBe(2);
		expect(loneStep(one, only(one))).toBe(1);
		// both are listed and were not made one item: the tie did not hold up
		expect(loneStep(one, only(one, two))).toBeNull();
		expect(loneStep(two, only(one, two))).toBeNull();
		// a proposal that stands alone
		expect(loneStep(send, only(send))).toBeNull();
		// a send that says it is a step of a move is not given the tag
		const [forged] = tieSteps(send, stake(NONCE + 1));
		expect(loneStep(forged, only(forged))).toBeNull();
		// why the other step is not listed is not known, so no reason is asserted
		expect(LONE_STEP_HINT).toContain("it was carried out, it was closed, or");
		expect(LONE_STEP_HINT).not.toMatch(/no longer waiting/);
		for (const word of [...FORBIDDEN_CLAIMS, ...HELP_JARGON])
			expect(LONE_STEP_HINT).not.toMatch(word);
	});

	it("takes the relay's word for who proposed each, and ties nothing it contradicts", () => {
		const [one, two] = tieSteps(moveIn(NONCE), stake(NONCE + 1));
		expect(labels([item(one, "1", A), item(two, "2", B)])).toEqual(["1", "2"]);
		// without the relay the documents have to name the same proposer, and these name none
		expect(labels([item(one, "1", null), item(two, "2", null)])).toEqual([
			"1",
			"2",
		]);
	});
	it("ties nothing that is not one of the staking moves", () => {
		const [fake, stakeStep] = tieSteps(send, stake(NONCE + 1));
		expect(labels([item(fake, "send"), item(stakeStep, "2")])).toEqual([
			"send",
			"2",
		]);
	});
	it("two moves in one list stay two", () => {
		const a = tieSteps(moveIn(NONCE), stake(NONCE + 1));
		const b = tieSteps(moveIn(NONCE + 10), stake(NONCE + 11));
		expect(
			labels([
				item(a[0], "a1"),
				item(b[0], "b1"),
				item(a[1], "a2"),
				item(b[1], "b2"),
			]),
		).toEqual(["stake(a1+a2)", "stake(b1+b2)"]);
	});
});

describe("saying once what holds for both steps of a move", () => {
	const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
	const [one, two] = tieSteps(
		makeProposal({
			action: { type: "cDeposit", ...HEAD, wei: 5_000_000_000, nonce: NONCE },
		}),
		makeProposal({
			action: {
				type: "tokenDelegate",
				...HEAD,
				validator: X,
				wei: 10_000_000_000,
				isUndelegate: false,
				nonce: NONCE + 1,
			},
			nonce: NONCE + 1,
		}),
	);
	const refs = moveRefs([
		{ proposal: one, proposedBy: A },
		{ proposal: two, proposedBy: A },
		{ proposal: makeProposal({ title: "a send" }), proposedBy: A },
	]);

	it("knows each step's place in its move, and nothing of a proposal that stands alone", () => {
		expect(refs.size).toBe(2);
		expect(refs.get(one.digest)).toEqual({
			step: 1,
			other: two.digest,
			line: "Stake 100 HYPE with 0x946b…5b21",
		});
		expect(refs.get(two.digest)).toMatchObject({ step: 2, other: one.digest });
	});

	interface Line {
		digest: string | null;
		parts: Part[];
		at: number;
	}
	const line = (p: Proposal | null, text: string, at = 0): Line => {
		const ref = p ? refs.get(p.digest) : undefined;
		return {
			digest: p?.digest ?? null,
			parts: [
				{ text: "the move" },
				...(ref ? [stepMark(ref.step)] : []),
				{ text },
			],
			at,
		};
	};
	const once = (lines: Line[]) =>
		sayOncePerMove(
			lines,
			{
				digest: (l) => l.digest as never,
				parts: (l) => l.parts,
				at: (l) => l.at,
			},
			(d) => refs.get(d) ?? null,
			(first, parts) => ({ ...first, parts }),
		).map((l) => l.parts.map((p) => p.text).join(""));

	it("two sentences that say the same of each step become one, of both", () => {
		expect(once([line(two, " was signed"), line(one, " was signed")])).toEqual([
			"the move (both steps) was signed",
		]);
	});
	it("sentences that differ, or lie far apart, stay two", () => {
		expect(
			once([line(one, " was accepted"), line(two, " was refused")]),
		).toEqual([
			"the move (step 1 of 2) was accepted",
			"the move (step 2 of 2) was refused",
		]);
		expect(
			once([line(one, " was signed", 0), line(two, " was signed", 600_000)]),
		).toHaveLength(2);
	});
	it("leaves everything else alone", () => {
		expect(once([line(null, " changed"), line(one, " was signed")])).toEqual([
			"the move changed",
			"the move (step 1 of 2) was signed",
		]);
	});
});
