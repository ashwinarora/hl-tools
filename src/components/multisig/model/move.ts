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
import {
	type Hex,
	judgeMove,
	type Move,
	otherStep,
	type Proposal,
	stakingActionOf,
	stepNumber,
	type Validator,
} from "@hl-tools/core";
import { type Part, part, partsText, say } from "./parts";
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
	/**
	 * Hyperliquid's staking history holds a step like this one, and the
	 * explorer did not say whether it is this one (`stepRecord`): one such
	 * step ("likely") or several ("unchecked"). Null or absent otherwise.
	 */
	readonly onRecord?: "likely" | "unchecked" | null;
}

export interface MoveStage {
	readonly phase: MovePhase;
	/** The two sentences as plain text (addresses shortened, moments in UTC). */
	readonly headline: string;
	readonly detail: string;
	/** The same as parts, so a screen names an address and gives a moment in the reader's own time. */
	readonly headlineParts: readonly Part[];
	readonly detailParts: readonly Part[];
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
	/**
	 * The step (0 or 1) that may be carried out already although nothing here
	 * says so for certain: Hyperliquid answered "duplicate nonce" to it (its
	 * number had been used before, possibly by a submission whose answer never
	 * got here), or its staking history holds a step like it that the explorer
	 * did not confirm. Such a step is never said to be "not carried out".
	 * Null otherwise.
	 */
	readonly unsure: 0 | 1 | null;
}

const duplicate = (s: StepView): boolean =>
	s.stage.failedAttempt?.id === "nonce-duplicate";
/** Hyperliquid refused it for a reason of its own: that submission carried nothing out, and its number is spent. */
const refusedForGood = (s: StepView): boolean =>
	!!s.stage.failedAttempt && !duplicate(s);
const likeOnRecord = (s: StepView): boolean =>
	s.onRecord === "likely" || s.onRecord === "unchecked";
/** Whether the step was carried out is not known, in either direction. */
const mayBeDone = (s: StepView): boolean =>
	duplicate(s) || (!refusedForGood(s) && likeOnRecord(s));

/** Why a step that is over may have been carried out all the same. */
const maybe = (s: StepView, n: 1 | 2): Part[] =>
	duplicate(s)
		? say`Step ${String(n)}: Hyperliquid answered "duplicate nonce" to it, so its number had been used by an earlier submission. If that one went through, the step is carried out already. Look at the treasury's staking history before proposing it again.`
		: say`Step ${String(n)}: ${s.stage.headlineParts}. Hyperliquid's staking history shows a step like it, so it may have been carried out all the same: the explorer did not say. Look at the treasury's staking history before proposing it again.`;

/**
 * Under "Your part" of a move that is over while the relay still holds a step
 * of it open (a refused step stays open there until it is withdrawn or lapses).
 */
export const leftOpenNote = (canWithdraw: boolean): string =>
	canWithdraw
		? "What is left of this move cannot be submitted, so nothing here needs a signature. Withdraw it, then propose it again."
		: "What is left of this move cannot be submitted, so nothing here needs your signature. Its proposer can withdraw it and propose it again.";

const count = (s: StepView) => `${s.have} of ${s.need ?? "?"}`;

/** Two sentences, as parts and as plain text. */
const told = (
	head: readonly Part[] | string,
	body: readonly Part[] | string,
) => {
	const headlineParts = typeof head === "string" ? [part(head)] : head;
	const detailParts = typeof body === "string" ? [part(body)] : body;
	return {
		headline: partsText(headlineParts),
		detail: partsText(detailParts),
		headlineParts,
		detailParts,
	};
};

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
		unsure: null as 0 | 1 | null,
	};
	if (first === "waiting" || second === "waiting")
		return {
			...base,
			settled: false,
			phase: "judging",
			...told(
				"Checking signatures…",
				"Recovering every signer and fetching the live signer set.",
			),
			executeReason: "Checking signatures…",
		};
	if (first === "done" && second === "done")
		return {
			...base,
			phase: "done",
			...told("Done · both steps were carried out", "Nothing more to sign."),
			executeReason: "Both steps were carried out.",
		};
	if (first === "over" && mayBeDone(one))
		return {
			...base,
			phase: "halted",
			unsure: 0,
			...told(
				"Step 1 may be carried out already · look before proposing again",
				say`${maybe(one, 1)} Step 2 was not sent. If step 1 was carried out, only step 2 is left to propose; if it was not, the whole move is.`,
			),
			executeReason: "Step 1 may be carried out already.",
		};
	if (first === "over" && second === "done")
		// another page or tool sent the second step by itself
		return {
			...base,
			phase: "halted",
			...told(
				"Step 2 was carried out, step 1 was not",
				say`Step 1: ${one.stage.headlineParts}. The second step was sent by itself, from another page or tool. Propose the first again if it is still wanted.`,
			),
			executeReason: "Step 1 was not carried out.",
		};
	if (first === "over" && second === "over" && mayBeDone(two))
		return {
			...base,
			phase: "halted",
			unsure: 1,
			...told(
				"Step 1 was not carried out · step 2 may have been",
				say`Step 1: ${one.stage.headlineParts}. ${maybe(two, 2)}`,
			),
			executeReason: "Step 1 was not carried out.",
		};
	if (first === "over" && second === "over")
		// e.g. withdrawn or lapsed together: neither is "left where it is"
		return {
			...base,
			phase: "halted",
			...(one.stage.phase === two.stage.phase
				? told(
						say`${one.stage.headlineParts} · neither step was carried out`,
						"Propose the move again if it is still wanted.",
					)
				: told(
						"Neither step was carried out",
						say`Step 1: ${one.stage.headlineParts}. Step 2: ${two.stage.headlineParts}. Propose the move again if it is still wanted.`,
					)),
			executeReason: "Neither step was carried out.",
		};
	if (first === "over")
		return {
			...base,
			phase: "halted",
			...told(
				"Step 1 was not carried out, so step 2 is not sent",
				say`Step 1: ${one.stage.headlineParts}. The second step makes sense only after the first, so it is not sent. Propose the move again if it is still wanted.`,
			),
			executeReason: "Step 1 was not carried out.",
		};
	if (first === "done" && second === "over" && mayBeDone(two))
		return {
			...base,
			phase: "broken",
			unsure: 1,
			...told("Step 1 was carried out · step 2 may be too", maybe(two, 2)),
			executeReason: "Step 2 may be carried out already.",
		};
	if (first === "done" && second === "over")
		return {
			...base,
			phase: "broken",
			...told(
				"Step 1 was carried out, step 2 was not",
				say`Step 2: ${two.stage.headlineParts}. Proposing it again makes only the step that is left.`,
			),
			executeReason: "Step 2 will not be carried out.",
		};
	if (first === "open" && second === "over")
		return {
			...base,
			phase: "halted",
			...told(
				"Step 2 can no longer follow, so step 1 is not sent",
				say`Step 2: ${two.stage.headlineParts}. Sending the first step alone would leave the move half done. Propose the move again if it is still wanted.`,
			),
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
	// a step still open that the staking history may already hold
	const seen = pending.find(likeOnRecord);
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
		unsure: (seen ? steps.indexOf(seen) : null) as 0 | 1 | null,
	};
	const phase: MovePhase = pending.some((s) => HELD_BY_A_NO.has(s.stage.phase))
		? "held"
		: first === "done"
			? "half"
			: pending.every((s) => s.stage.phase === "ready")
				? "ready"
				: "collecting";
	if (seen) {
		// sent from a page that never got the answer (closed, reloaded, offline):
		// the step is listed as waiting although it may be done
		const n = String(steps.indexOf(seen) + 1);
		return {
			...shared,
			phase,
			...told(
				first === "done"
					? "Step 1 is carried out · step 2 may be too"
					: `Step ${n} may be carried out already`,
				`Hyperliquid's staking history shows a step like step ${n}, made after this move was proposed. It may be this step, sent from a page that never got the answer: the explorer did not say. Once it does, the step is marked carried out here. Sending it again cannot carry it out twice, because Hyperliquid takes a proposal's number once.`,
			),
		};
	}
	const held = pending.find((s) => HELD_BY_A_NO.has(s.stage.phase));
	if (held)
		return {
			...shared,
			phase,
			...told(
				held.stage.headlineParts,
				say`${pending.length > 1 ? `Step ${steps.indexOf(held) + 1} of this move: ` : ""}${held.stage.detailParts}`,
			),
		};
	const ready = pending.every((s) => s.stage.phase === "ready");
	if (first === "done") {
		// step 1 has landed: only step 2 is left
		return {
			...shared,
			phase,
			...told(
				ready
					? "Step 1 is carried out · step 2 is ready to be sent"
					: `Step 1 is carried out · step 2 has ${count(two)} signatures`,
				two.stage.detailParts,
			),
		};
	}
	if (ready)
		return {
			...shared,
			phase,
			...told(
				pending.length === 2
					? "Ready · both steps have their signatures"
					: "Ready · the step that is left has its signatures",
				one.stage.detailParts,
			),
		};
	return {
		...shared,
		phase,
		...told(
			pending.length === 2
				? `Collecting signatures · step 1: ${count(one)} · step 2: ${count(two)}`
				: `Collecting signatures · ${count(pending[0] as StepView)}`,
			// the step the reader can still sign says "you" among those who can;
			// otherwise the first step that still lacks signatures
			(
				pending.find((s) => s.stage.canSign) ??
				pending.find((s) => s.stage.phase !== "ready") ??
				one
			).stage.detailParts,
		),
	};
}

// ------------------------------------------------------------------- lists

/**
 * What a list may say of an item that stands alone and says it is one step of
 * a move: its number, where the item is a staking step itself and the other
 * step is not in the list at all. `listed` is every digest of the list,
 * before any pairing.
 *
 * The tie is a claim nobody signed, and a list has not judged it. So where
 * both steps are listed and were not made one item, the claim did not hold up
 * and is not repeated; and a send that says "step 1 of 2" is not given the tag.
 */
export function loneStep(
	p: Proposal,
	listed: ReadonlySet<string>,
): 1 | 2 | null {
	const other = otherStep(p);
	if (!other || listed.has(other)) return null;
	return stakingActionOf(p.payload.action) ? stepNumber(p) : null;
}

/**
 * The hover text of that tag. Why the other step is not listed is not known
 * from a list, so none of the reasons is asserted.
 */
export const LONE_STEP_HINT =
	"This proposal was made as one step of a move of two. The other step is not among the ones listed here: it was carried out, it was closed, or it was never shared.";

/** What a list has to hold of an item for a move to be told: the document, and who proposed it. */
export interface Listed {
	readonly proposal: Proposal;
	/**
	 * Who proposed it, by the relay's word where the list comes from the relay
	 * (it stamps that itself); null where there is only the document, whose
	 * own `createdBy` is then compared.
	 */
	readonly proposedBy: string | null;
}

/**
 * A list with the two steps of every move made one item, at the place of
 * whichever step came first in the list. A step whose other step is not in
 * the list, or with which it does not bear the claim out (`judgeMove`), stays
 * as it is: it is then shown as one proposal, which it also is.
 */
export function pairMoves<T extends Listed>(
	items: readonly T[],
	merge: (first: T, second: T, move: Move) => T,
): T[] {
	const byDigest = new Map(items.map((item) => [item.proposal.digest, item]));
	const taken = new Set<T>();
	const out: T[] = [];
	for (const item of items) {
		if (taken.has(item)) continue;
		const digest = otherStep(item.proposal);
		const other = digest ? byDigest.get(digest) : undefined;
		const move =
			other && !taken.has(other)
				? judgeMove(
						item.proposal,
						other.proposal,
						item.proposedBy !== null && other.proposedBy !== null
							? { a: item.proposedBy, b: other.proposedBy }
							: undefined,
					).move
				: null;
		if (!move || !other) {
			out.push(item);
			continue;
		}
		taken.add(other);
		const firstIsItem = move.steps[0].digest === item.proposal.digest;
		out.push(
			merge(firstIsItem ? item : other, firstIsItem ? other : item, move),
		);
	}
	return out;
}

// ------------------------------------------------------------------- sentences

/** What a sentence has to know of a proposal that is one step of a move. */
export interface MoveRef {
	readonly step: 1 | 2;
	/** The digest of the other step. */
	readonly other: Hex;
	/** The move in words. */
	readonly line: string;
}

/** For every proposal in the list that is a step of a move found there: its place in it. */
export function moveRefs(
	items: readonly Listed[],
	validators?: readonly Validator[] | null,
): Map<Hex, MoveRef> {
	const refs = new Map<Hex, MoveRef>();
	pairMoves(items, (first, second, move) => {
		const line = moveSentence(move, validators);
		refs.set(first.proposal.digest, {
			step: 1,
			other: second.proposal.digest,
			line,
		});
		refs.set(second.proposal.digest, {
			step: 2,
			other: first.proposal.digest,
			line,
		});
		return first;
	});
	return refs;
}

/** After the move's line in a sentence about one of its steps. */
export const stepMark = (step: 1 | 2): Part => ({
	text: ` (step ${step} of 2)`,
	quiet: true,
});
const BOTH: Part = { text: " (both steps)", quiet: true };
const isStepMark = (p: Part): boolean =>
	p.quiet === true && /^ \(step [12] of 2\)$/.test(p.text);

/**
 * What is said of both steps of a move in the same words is said once, of
 * both: "proposed … (both steps)" for the two history entries a move's
 * proposal leaves, one line when both were carried out. Sentences that differ
 * (one step accepted, the other refused) stay two, each naming its step.
 * Only sentences about moments close to each other are taken together.
 */
export function sayOncePerMove<T>(
	items: readonly T[],
	read: {
		digest(item: T): Hex | null;
		parts(item: T): readonly Part[];
		at(item: T): number;
	},
	moveOf: (digest: Hex) => MoveRef | null,
	/** The first step's item, with the parts that speak of both and the other item it stands for too. */
	merge: (item: T, parts: Part[], other: T) => T,
	withinMs = 120_000,
): T[] {
	const bare = (item: T) =>
		read
			.parts(item)
			.filter((p) => !isStepMark(p))
			.map((p) => p.text)
			.join("");
	const gone = new Set<T>();
	const out: T[] = [];
	for (const item of items) {
		if (gone.has(item)) continue;
		const digest = read.digest(item);
		const ref = digest ? moveOf(digest) : null;
		const twin = ref
			? items.find(
					(x) =>
						x !== item &&
						!gone.has(x) &&
						read.digest(x) === ref.other &&
						Math.abs(read.at(x) - read.at(item)) <= withinMs &&
						bare(x) === bare(item),
				)
			: undefined;
		if (!ref || !twin) {
			out.push(item);
			continue;
		}
		gone.add(twin);
		const [first, second] = ref.step === 1 ? [item, twin] : [twin, item];
		out.push(
			merge(
				first,
				read.parts(first).map((p) => (isStepMark(p) ? BOTH : p)),
				second,
			),
		);
	}
	return out;
}
