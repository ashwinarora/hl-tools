/**
 * A move of two steps, as the pages show it.
 *
 * Two proposals that the core found to be one move (`judgeMove`) are shown as
 * one item: one line in a list, one page. Each step keeps its own stage,
 * judged exactly as a proposal that stands alone; this file says what the two
 * stages mean together, and what the connected wallet can do about the move
 * as a whole. The order is the rule that makes it a move: step 2 is never
 * sent unless step 1 was carried out, and step 1 is not sent alone when step
 * 2 can no longer follow.
 */
import type { Move, Validator } from "@hl-tools/core";
import type { Phase, Stage } from "./stage";
import { hype, validatorLabel } from "./staking";

/** The move in one line, with the validators by the names they gave themselves. */
export function moveSentence(
	move: Pick<Move, "kind" | "amount" | "validator" | "to">,
	validators?: readonly Validator[] | null,
): string {
	const name = (address: string) => validatorLabel(address, validators);
	switch (move.kind) {
		case "stake":
			return `Stake ${hype(move.amount)} with ${name(move.validator)}`;
		case "return":
			return `Return ${hype(move.amount)} to spot`;
		default:
			return `Move ${hype(move.amount)} from ${name(move.validator)} to ${name(move.to ?? "")}`;
	}
}

/** Carried out: accepted when submitted from here, or found on Hyperliquid's record. */
const DONE: ReadonlySet<Phase> = new Set(["submitted", "carried-out"]);
/** Still to be decided: it can be signed, said no to, withdrawn or sent. */
const OPEN: ReadonlySet<Phase> = new Set([
	"collecting",
	"ready",
	"not-yet-valid",
	"cannot-pass",
	"finaliser-no",
]);
const WAITING: ReadonlySet<Phase> = new Set(["judging", "unknown"]);
const HELD_BY_A_NO: ReadonlySet<Phase> = new Set([
	"cannot-pass",
	"finaliser-no",
]);

type StepState = "done" | "open" | "waiting" | "over";
const stateOf = (phase: Phase): StepState =>
	DONE.has(phase)
		? "done"
		: OPEN.has(phase)
			? "open"
			: WAITING.has(phase)
				? "waiting"
				: // refused, withdrawn, expired, stuck…: it will not be carried out
					"over";

/**
 * judging     a step is still being judged
 * collecting  signatures are still missing
 * held        a no holds a step up
 * ready       every step still to be sent has its signatures
 * half        step 1 is carried out, step 2 is still to come
 * done        both steps were carried out
 * halted      step 1 will not be carried out, so step 2 is not sent (or step
 *             2 can no longer follow, so step 1 is not sent alone)
 * broken      step 1 was carried out, and step 2 will not be
 */
export type MovePhase =
	| "judging"
	| "collecting"
	| "held"
	| "ready"
	| "half"
	| "done"
	| "halted"
	| "broken";

/** One step, as its own page would judge it. */
export interface StepView {
	readonly stage: Stage;
	/** Signatures that count, and how many are needed (null while unknown). */
	readonly have: number;
	readonly need: number | null;
}

export interface MoveStage {
	readonly phase: MovePhase;
	readonly headline: string;
	readonly detail: string;
	/** The steps still to be sent, by index, in order. Empty when nothing is to be sent. */
	readonly toSend: readonly number[];
	/** The steps the connected wallet can sign now. */
	readonly toSign: readonly number[];
	readonly canSign: boolean;
	readonly canExecute: boolean;
	/** Why the connected wallet cannot submit; null when it can. */
	readonly executeReason: string | null;
	/** Only time stands between the finaliser and Submit: the moment it opens. */
	readonly opensAt: number | null;
	/** How many times the finaliser's wallet is asked when they submit. */
	readonly prompts: number;
	/** Of the steps still open, how many the connected wallet has signed. */
	readonly signed: number;
	/** The move is over, one way or the other: nothing more to sign or send. */
	readonly settled: boolean;
}

const count = (s: StepView) => `${s.have} of ${s.need ?? "?"}`;

export function deriveMoveStage(
	steps: readonly [StepView, StepView],
): MoveStage {
	const [one, two] = steps;
	const states = steps.map((s) => stateOf(s.stage.phase)) as [
		StepState,
		StepState,
	];
	const [first, second] = states;

	const base = {
		toSend: [] as number[],
		toSign: [] as number[],
		canSign: false,
		canExecute: false,
		executeReason: null as string | null,
		opensAt: null as number | null,
		prompts: 0,
		signed: 0,
		settled: true,
	};
	if (first === "waiting" || second === "waiting")
		return {
			...base,
			settled: false,
			phase: "judging",
			headline: "Checking signatures…",
			detail: "Recovering every signer and fetching the live signer set.",
			executeReason: "Checking signatures…",
		};
	if (first === "done" && second === "done")
		return {
			...base,
			phase: "done",
			headline: "Done · both steps were carried out",
			detail: "Nothing more to sign.",
			executeReason: "Both steps were carried out.",
		};
	if (first === "over")
		return {
			...base,
			phase: "halted",
			headline: "Step 1 was not carried out, so step 2 is not sent",
			detail: `Step 1: ${one.stage.headline}. The second step makes sense only after the first, so it stays where it is. Propose the move again if it is still wanted.`,
			executeReason: "Step 1 was not carried out.",
		};
	if (first === "done" && second === "over")
		return {
			...base,
			phase: "broken",
			headline: "Step 1 was carried out, step 2 was not",
			detail: `Step 2: ${two.stage.headline}. Proposing the move again makes only the step that is left.`,
			executeReason: "Step 2 will not be carried out.",
		};
	if (first === "open" && second === "over")
		return {
			...base,
			phase: "halted",
			headline: "Step 2 can no longer follow, so step 1 is not sent",
			detail: `Step 2: ${two.stage.headline}. Sending the first step alone would leave the move half done. Propose the move again if it is still wanted.`,
			executeReason: "Step 2 can no longer follow.",
		};

	// from here on something is still to be signed or sent
	const open = [0, 1].filter((i) => states[i] === "open");
	const pending = open.map((i) => steps[i] as StepView);
	const toSign = open.filter((i) => (steps[i] as StepView).stage.canSign);
	const signed = pending.filter((s) => s.stage.hasSigned).length;
	const blocker = pending.find((s) => !s.stage.canExecute);
	// time alone: every step that cannot be sent yet says when it can
	const timed = pending.filter((s) => !s.stage.canExecute);
	const opensAt =
		timed.length > 0 && timed.every((s) => s.stage.opensAt !== null)
			? Math.max(...timed.map((s) => s.stage.opensAt as number))
			: null;
	const shared = {
		toSend: open,
		toSign,
		canSign: toSign.length > 0,
		canExecute: !blocker,
		executeReason: blocker
			? `${pending.length > 1 ? `Step ${steps.indexOf(blocker) + 1}: ` : ""}${blocker.stage.executeReason ?? blocker.stage.headline}`
			: null,
		opensAt,
		prompts: pending.reduce(
			(n, s) => n + 1 + (s.stage.executeAddsSignature ? 1 : 0),
			0,
		),
		signed,
		settled: false,
	};
	const held = pending.find((s) => HELD_BY_A_NO.has(s.stage.phase));
	if (held)
		return {
			...shared,
			phase: "held",
			headline: held.stage.headline,
			detail: `${pending.length > 1 ? `Step ${steps.indexOf(held) + 1} of this move: ` : ""}${held.stage.detail}`,
		};
	const ready = pending.every((s) => s.stage.phase === "ready");
	if (first === "done") {
		// step 1 has landed: only step 2 is left
		return {
			...shared,
			phase: "half",
			headline: ready
				? "Step 1 is carried out · step 2 is ready to be sent"
				: `Step 1 is carried out · step 2 has ${count(two)} signatures`,
			detail: two.stage.detail,
		};
	}
	if (ready)
		return {
			...shared,
			phase: "ready",
			headline:
				pending.length === 2
					? "Ready · both steps have their signatures"
					: "Ready · the step that is left has its signatures",
			detail: one.stage.detail,
		};
	return {
		...shared,
		phase: "collecting",
		headline:
			pending.length === 2
				? `Collecting signatures · step 1: ${count(one)} · step 2: ${count(two)}`
				: `Collecting signatures · ${count(pending[0] as StepView)}`,
		detail: (pending.find((s) => s.stage.phase !== "ready") ?? one).stage
			.detail,
	};
}
