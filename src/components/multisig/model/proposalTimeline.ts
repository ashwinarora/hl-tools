/**
 * A proposal's timeline, oldest first: who proposed it, who signed, who said
 * no or took it back, how it ended, and what Hyperliquid's record says. Read
 * from the hl-tools server's history of the proposal when there is one (who
 * did what, and when); otherwise from the copy itself, which can say only
 * when it was made, which signatures it carries (and when, as written in
 * it) and when it was sent. Who proposed a copy is not signed, so a copy's
 * timeline never names its proposer.
 */
import type { Address, Proposal } from "@hl-tools/core";
import type { OnRecord } from "./chain/record";
import { type Part, part, partsText, say } from "./parts";
import { afterRejection } from "./relay/copy";
import { addressList, type EventRow } from "./relay/rows";
import { shortAddress } from "./stage";

/** One proposal of the timeline: alone, or one step of a move. */
export interface TimelineStep {
	readonly proposal: Proposal;
	/** The hl-tools server's history of this proposal; null when it has none to give. */
	readonly events: readonly EventRow[] | null;
	/** The signers whose signature on the copy verifies; null while not judged. */
	readonly counted: readonly Address[] | null;
	/** Its step in a move; absent for a proposal that stands alone. */
	readonly step?: 1 | 2;
}

/** What Hyperliquid's record says of a step that was sent from here. */
export interface TimelineRecord {
	readonly step?: 1 | 2;
	readonly hash: string;
	readonly at: number;
	/** Hyperliquid's own words when its record shows the transaction refused. */
	readonly refused?: string;
	/**
	 * A vault step: its record holds one like it, never more than "likely"
	 * (a vault action carries no number that would tie it to this proposal).
	 */
	readonly likely?: true;
}

export interface TimelineItem {
	readonly key: string;
	/** Unix ms; null when the copy does not say. */
	readonly at: number | null;
	readonly parts: readonly Part[];
	/** The step of a move it is about; null for both steps, or for a lone proposal. */
	readonly step: 1 | 2 | null;
	/** "ok" for an acceptance, "wrong" for a refusal. */
	readonly tone?: "ok" | "wrong";
	/** A transaction on Hyperliquid to link to. */
	readonly hash?: string;
	/** The proposal was sent to Hyperliquid here: its record comes after it. */
	readonly sent?: true;
	/** What Hyperliquid's record shows. */
	readonly record?: true;
}

export interface Timeline {
	readonly items: readonly TimelineItem[];
	/** Read from a copy alone: its times are as written in it. */
	readonly fromCopy: boolean;
}

/** What the timeline's card says around its entries. */
export const TIMELINE_COPY = {
	title: "Timeline",
	fromCopy: "From this copy: its times are as written in it.",
	undated: "time not given",
	transaction: "Transaction",
} as const;

/** What Hyperliquid's record says of a step, as entries of its timeline (none while it says nothing yet). */
export function recordEntries(
	record: OnRecord | null,
	step?: 1 | 2,
): TimelineRecord[] {
	if (!record) return [];
	const at = step ? { step } : {};
	if (record.kind === "found")
		return [{ ...at, hash: record.hash, at: record.time }];
	if (record.kind === "likely")
		return [{ ...at, hash: record.hash, at: record.time, likely: true }];
	if (record.kind === "refused")
		return [
			{ ...at, hash: record.hash, at: record.time, refused: record.error },
		];
	return [];
}

/** Two entries this close and alike, on the two steps of a move, are one. */
const SAME_MOMENT_MS = 5 * 60_000;

/**
 * Two entries of one wallet this close are one step (proposing and signing
 * in one go; saying no, which takes the signature back; signing, which
 * replaces a no): further apart, they were two decisions and are told apart.
 */
const ONE_STEP_MS = 10_000;

function forOne(s: TimelineStep, me: Address | null): TimelineItem[] {
	const step = s.step ?? null;
	const subject = (a: Address | null): Part =>
		!a ? part("Someone") : { text: a === me ? "You" : shortAddress(a), who: a };
	const object = (a: Address | null): Part =>
		!a ? part("someone") : { text: a === me ? "you" : shortAddress(a), who: a };
	const own = (a: Address | null) => (a && a === me ? "your" : "their");
	const digest = s.proposal.digest;
	const out: TimelineItem[] = [];

	if (!s.events) {
		const made = s.proposal.meta.createdAt;
		if (made !== null)
			out.push({
				key: `${digest}:made`,
				at: made,
				parts: say`Proposed.`,
				step,
			});
		const counted = new Set(s.counted ?? []);
		for (const sig of s.proposal.signatures)
			if (counted.has(sig.signer))
				out.push({
					key: `${digest}:sig:${sig.signer}`,
					at: sig.at,
					parts: say`${subject(sig.signer)} signed.`,
					step,
				});
		const r = s.proposal.receipt;
		if (r)
			out.push({
				key: `${digest}:sent`,
				at: r.submittedAt,
				parts: say`Sent to Hyperliquid by ${object(s.proposal.payload.outerSigner)}, its finaliser.`,
				step,
				sent: true,
			});
		return out;
	}

	const asc = s.events
		.filter((e) => e.digest === digest)
		.sort((a, b) => a.id - b.id);
	// a result recorded as accepted: a "carried out" entry after it says nothing new
	const acceptedHere = asc.some(
		(e) => e.kind === "submission_recorded" && e.data.accepted === true,
	);
	const folded = new Set<number>();
	for (const [i, e] of asc.entries()) {
		if (folded.has(e.id)) continue;
		const next = asc.slice(i + 1)[0];
		const followedBy = (kind: EventRow["kind"]) =>
			!!next &&
			next.kind === kind &&
			next.actor === e.actor &&
			next.at - e.at <= ONE_STEP_MS;
		const item = (
			parts: Part[],
			extra: Partial<TimelineItem> = {},
		): TimelineItem => ({
			key: `${digest}:${e.id}`,
			at: e.at,
			parts,
			step,
			...extra,
		});
		switch (e.kind) {
			case "proposal_created": {
				const signedToo = followedBy("signature_added");
				if (signedToo && next) folded.add(next.id);
				const finaliser = addressList([e.data.finaliser])[0] ?? null;
				out.push(
					item(
						say`${subject(e.actor)} proposed it${signedToo ? " and signed" : ""}.${
							finaliser ? say` Finaliser: ${object(finaliser)}.` : ""
						}`,
					),
				);
				break;
			}
			case "signature_added":
				out.push(item(say`${subject(e.actor)} signed.`));
				break;
			case "signature_removed":
				if (followedBy("objection_added") && next) {
					folded.add(next.id);
					out.push(
						item(
							say`${subject(e.actor)} said no, taking back ${own(e.actor)} signature.`,
						),
					);
				} else
					out.push(
						item(say`${subject(e.actor)} took back ${own(e.actor)} signature.`),
					);
				break;
			case "objection_added":
				out.push(item(say`${subject(e.actor)} said no.`));
				break;
			case "objection_removed":
				if (followedBy("signature_added") && next) {
					folded.add(next.id);
					out.push(
						item(
							say`${subject(e.actor)} signed, in place of ${own(e.actor)} no.`,
						),
					);
				} else
					out.push(
						item(say`${subject(e.actor)} took back ${own(e.actor)} no.`),
					);
				break;
			case "proposal_withdrawn":
				out.push(
					item(
						say`Cancelled for everyone by the proposer, ${object(e.actor)}.`,
					),
				);
				break;
			case "proposal_declined":
				out.push(
					item(
						say`${subject(e.actor)}, its finaliser, said no: it will not be sent.`,
					),
				);
				break;
			case "submission_recorded":
				out.push(
					e.data.accepted === true
						? item(say`Sent by ${object(e.actor)}; accepted by Hyperliquid.`, {
								tone: "ok",
								sent: true,
							})
						: item(
								say`Sent by ${object(e.actor)}; Hyperliquid did not accept it. ${afterRejection(e.data.http_status, true)}`,
								{ tone: "wrong", sent: true },
							),
				);
				break;
			case "proposal_carried_out": {
				if (acceptedHere) break;
				const noticed = addressList([e.data.reported_by])[0] ?? null;
				const hash =
					typeof e.data.tx_hash === "string" ? e.data.tx_hash : undefined;
				const at = typeof e.data.tx_time === "number" ? e.data.tx_time : e.at;
				out.push(
					item(
						say`Carried out without being sent from here: its transaction is on Hyperliquid's record${
							noticed ? say`, noticed by ${object(noticed)}` : ""
						}.`,
						{ at, tone: "ok", ...(hash ? { hash } : {}) },
					),
				);
				break;
			}
			case "unknown":
				out.push(
					item(
						say`An entry this version of the page cannot describe (“${e.rawKind}”).`,
					),
				);
				break;
			default:
				break;
		}
	}
	return out;
}

/**
 * The timeline of a proposal, or of the two steps of a move. What both steps
 * of a move had alike, at the same moment (proposed together, signed in one
 * go), is one entry.
 */
export function proposalTimeline(
	steps: readonly TimelineStep[],
	me: Address | null,
	records: readonly TimelineRecord[] = [],
): Timeline {
	const all = steps.flatMap((s) => forOne(s, me));
	for (const r of records)
		all.push({
			key: `record:${r.step ?? 0}:${r.hash}`,
			at: r.at,
			parts: r.refused
				? say`Hyperliquid's record shows it refused: ${r.refused}`
				: r.likely
					? say`Hyperliquid's record shows a vault step like this one.`
					: say`On Hyperliquid's record.`,
			step: r.step ?? null,
			tone: r.refused ? "wrong" : "ok",
			hash: r.hash,
			record: true,
		});

	// a move: an entry of step 2 just like one of step 1, at the same moment, joins it
	const merged: TimelineItem[] = [];
	const used = new Set<string>();
	for (const a of all) {
		if (used.has(a.key)) continue;
		const twin =
			a.step === 1
				? all.find(
						(b) =>
							b.step === 2 &&
							!used.has(b.key) &&
							!b.hash &&
							!a.hash &&
							partsText(b.parts) === partsText(a.parts) &&
							a.at !== null &&
							b.at !== null &&
							Math.abs(a.at - b.at) <= SAME_MOMENT_MS,
					)
				: undefined;
		if (twin) {
			used.add(twin.key);
			merged.push({ ...a, step: null, at: Math.max(a.at ?? 0, twin.at ?? 0) });
		} else merged.push(a);
		used.add(a.key);
	}

	// oldest first; what the copy does not date goes last, in its own order.
	// Hyperliquid's record comes after the send it records, whatever the few
	// seconds between the transaction's time and the send being noted.
	const order = new Map(merged.map((m, i) => [m.key, i]));
	const sentAt = (step: 1 | 2 | null) =>
		Math.max(
			...merged
				.filter(
					(m) =>
						m.at !== null &&
						m.sent === true &&
						(step === null || m.step === null || m.step === step),
				)
				.map((m) => m.at as number),
			Number.NEGATIVE_INFINITY,
		);
	const sortAt = (m: TimelineItem) =>
		m.at === null ? null : m.record ? Math.max(m.at, sentAt(m.step)) : m.at;
	const items = [...merged].sort((a, b) => {
		const x = sortAt(a);
		const y = sortAt(b);
		return x === null && y === null
			? (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)
			: x === null
				? 1
				: y === null
					? -1
					: x - y || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0);
	});
	return { items, fromCopy: steps.some((s) => s.events === null) };
}
