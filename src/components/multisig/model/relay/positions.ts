/**
 * A signer's "no", and what it does to a proposal.
 *
 * A no is an objection the others see, never a cancellation: the proposal
 * stays open and the number that must sign decides. Each signer has one
 * position at a time (nothing yet, a signature, or a no) and can change it
 * while the proposal is open. This file is the whole rule and every sentence
 * about it, with no React and no relay, so both can be tested:
 *
 * - a no counts only from somebody who is a signer now, like a signature;
 * - a proposal "cannot pass as things stand" when the signers who have not
 *   said no are fewer than must sign, and "cannot be submitted as things
 *   stand" when its finaliser said no (only the finaliser can submit);
 * - neither closes it. A change of mind makes it live again; otherwise its
 *   proposer withdraws it or it lapses with its signing window.
 */
import type { Address } from "@hl-tools/core";
import { joinParts, type Part, part, say, whoPart } from "../parts";
import { agoWords, untilWords } from "../time";

export interface Objection {
	readonly signer: Address;
	/** Unix ms. */
	readonly at: number;
}

/**
 * cannot-pass    too many said no for the number that must sign to be reached
 * finaliser-no   the one signer who can submit it said no
 */
export type Blocked = "cannot-pass" | "finaliser-no";

export interface Standing {
	/** The current signers who said no, oldest first. */
	readonly objected: readonly Objection[];
	/** How many current signers have not said no. */
	readonly left: number;
	readonly threshold: number;
	/** Null while the proposal can still go ahead as things stand. */
	readonly blocked: Blocked | null;
}

export function standing(i: {
	/** The treasury's signers now. */
	readonly signers: readonly Address[];
	readonly threshold: number;
	readonly finaliser: Address;
	readonly objections: readonly Objection[];
}): Standing {
	const seen = new Set<Address>();
	const objected = [...i.objections]
		.sort((a, b) => a.at - b.at || (a.signer < b.signer ? -1 : 1))
		.filter((o) => {
			// somebody who is no longer a signer has no say; one position per signer
			if (!i.signers.includes(o.signer) || seen.has(o.signer)) return false;
			seen.add(o.signer);
			return true;
		});
	const left = i.signers.length - objected.length;
	return {
		objected,
		left,
		threshold: i.threshold,
		blocked:
			objected.length > 0 && left < i.threshold
				? // the stronger fact when both hold: no change of finaliser would help
					"cannot-pass"
				: objected.some((o) => o.signer === i.finaliser)
					? "finaliser-no"
					: null,
	};
}

/** Whether this wallet's own position is a no. */
export function saidNo(s: Standing, me: Address | null): boolean {
	return me !== null && s.objected.some((o) => o.signer === me);
}

// ------------------------------------------------------------------- sentences

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/** "Carol", "Carol and Dave", "Carol, Dave and Erin"; the reader is "you". */
function names(
	list: readonly Address[],
	me: Address | null,
	start: boolean,
): Part[] {
	const each = list.map((a, i): Part[] => [
		a === me ? { text: start && i === 0 ? "You" : "you", who: a } : whoPart(a),
	]);
	if (each.length <= 1) return each[0] ?? [];
	return [
		...joinParts(each.slice(0, -1), ", "),
		part(" and "),
		...(each[each.length - 1] as Part[]),
	];
}

/** "on 14 Oct 2026, 16:20, in 1 day 6 hours" (the moment is shown in the reader's zone). */
function lapses(at: number, now: number): Part[] {
	return say`Otherwise it lapses on ${{ text: new Date(at).toISOString().slice(0, 16).replace("T", " "), when: at }}, ${untilWords(at, now)}.`;
}

export interface PositionText {
	readonly headline: Part[];
	readonly detail: Part[];
}

/**
 * The line that stands on a proposal somebody said no to while it can still
 * go ahead: who, when (for one), and what it would still take.
 */
export function objectionLine(i: {
	readonly standing: Standing;
	/** The signers whose signature counts. */
	readonly signed: readonly Address[];
	/** The current signers, to name who could still sign. */
	readonly signers: readonly Address[];
	readonly me: Address | null;
	readonly now: number;
}): Part[] | null {
	const { objected, threshold } = i.standing;
	if (objected.length === 0) return null;
	const who = names(
		objected.map((o) => o.signer),
		i.me,
		true,
	);
	const when =
		objected.length === 1
			? `, ${agoWords((objected[0] as Objection).at, i.now)}`
			: "";
	const said = say`${who} said no${when}.`;
	if (i.standing.blocked) return said;
	const need = threshold - i.signed.length;
	if (need <= 0)
		return say`${said} It can still go ahead: ${plural(i.signed.length, "signer has", "signers have")} signed, and ${String(threshold)} must.`;
	const open = i.signers.filter(
		(a) => !i.signed.includes(a) && !objected.some((o) => o.signer === a),
	);
	if (open.length === need) {
		const them = names(open, i.me, false);
		const verb = open.length === 1 && open[0] !== i.me ? "signs" : "sign";
		return say`${said} It can still go ahead if ${them} ${verb}.`;
	}
	return say`${said} It can still go ahead if ${String(need)} of the ${String(open.length)} signers who have not signed yet do.`;
}

/** The amber line above Sign and Submit: a fact, with no click attached. */
export function objectionNote(
	s: Standing,
	me: Address | null,
	now: number,
): Part[] | null {
	// one's own no is said in one's own words (`ownPosition`)
	const others = s.objected.filter((o) => o.signer !== me);
	if (others.length === 0) return null;
	const who = names(
		others.map((o) => o.signer),
		me,
		true,
	);
	return others.length === 1
		? say`${who} said no to this, ${agoWords((others[0] as Objection).at, now)}.`
		: say`${who} said no to this.`;
}

/** What the reader is told about their own no. */
export function ownPosition(i: {
	readonly standing: Standing;
	readonly me: Address | null;
	readonly finaliser: Address;
	readonly now: number;
}): Part[] | null {
	const mine = i.standing.objected.find((o) => o.signer === i.me);
	if (!mine) return null;
	return i.me === i.finaliser
		? say`You said no. You are the one who has to submit this, so it cannot go ahead unless you change your mind.`
		: say`You said no, ${agoWords(mine.at, i.now)}.`;
}

/** The two states in which a proposal cannot go ahead as things stand. */
export function blockedText(i: {
	readonly standing: Standing;
	readonly finaliser: Address;
	readonly me: Address | null;
	/** When the signing window closes, unix ms. */
	readonly lapsesAt: number;
	readonly now: number;
}): PositionText | null {
	const { standing: s, me } = i;
	if (!s.blocked) return null;
	const who = (start: boolean) =>
		names(
			s.objected.map((o) => o.signer),
			me,
			start,
		);
	const end = lapses(i.lapsesAt, i.now);
	if (s.blocked === "cannot-pass") {
		const short = s.threshold - s.left;
		const only =
			s.left === 0
				? "no signer is left"
				: `only ${plural(s.left, "signer is", "signers are")} left`;
		// the reader among those who said no is spoken to, not about
		const among = s.objected.some((o) => o.signer === me);
		const back =
			s.objected.length === 1
				? say`${names([(s.objected[0] as Objection).signer], me, false)} ${among ? "change your mind" : "changes their mind"}`
				: short === 1
					? among
						? say`one of you changes your mind`
						: say`one of them changes their mind`
					: among
						? say`${String(short)} of you change your minds`
						: say`${String(short)} of them change their minds`;
		return {
			headline: say`Cannot pass as things stand`,
			detail: say`${who(true)} said no, so ${only} and ${String(s.threshold)} must sign. It goes ahead only if ${back}. ${end}`,
		};
	}
	const finaliser = names([i.finaliser], me, true);
	const again = names([i.finaliser], me, false);
	return {
		headline: say`Cannot be submitted as things stand`,
		detail:
			i.finaliser === me
				? say`You said no, and you are the one who has to submit this proposal. It goes ahead only if you change your mind. To have someone else submit it, propose it again with a different finaliser. ${end}`
				: say`${finaliser} said no, and ${again} is the one who has to submit this proposal. It goes ahead only if ${again} changes their mind. To have someone else submit it, propose it again with a different finaliser. ${end}`,
	};
}

/** The tag a blocked proposal carries in a list. */
export function blockedTag(blocked: Blocked): string {
	return blocked === "cannot-pass" ? "cannot pass" : "finaliser said no";
}

/** The tag a proposal carries in a list while somebody's no stands on it. */
export function saidNoTag(count: number, mine: boolean): string {
	if (count === 1) return mine ? "you said no" : "1 said no";
	return `${count} said no`;
}
