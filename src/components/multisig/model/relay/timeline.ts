/**
 * A treasury's history as sentences, and as a file. Built from the relay's
 * event log (who did what, when) plus, for the action line, the proposals the
 * events refer to. Events carry identifiers only; what a proposal does is
 * read from its own verified document.
 */
import {
	type Address,
	encodeProposal,
	type Hex,
	isolated,
	type Network,
	type Proposal,
} from "@hl-tools/core";
import { type CsvCell, csvTime } from "#/lib/download";
import { type MoveRef, sayOncePerMove, stepMark } from "../move";
import { joinParts, type Part, part, partsText, say } from "../parts";
import { shortAddress } from "../stage";
import { afterRejection } from "./copy";
import { addressList, type EventRow } from "./rows";

export type { Part } from "../parts";

export interface TimelineEntry {
	/** The id of the (last) event behind this entry. */
	readonly id: number;
	readonly at: number;
	readonly digest: Hex | null;
	readonly parts: readonly Part[];
	/** The proposals whose accepted submission this entry reports: checked against Hyperliquid's record. */
	readonly accepted?: readonly Hex[];
}

export interface TimelineContext {
	readonly me: Address | null;
	/** The action in words for a proposal, when its document is at hand. */
	readonly line: (digest: Hex) => string | null;
	/** The proposal's title, if it has one. It follows the action, never replaces it. */
	readonly title?: (digest: Hex) => string | null;
	/**
	 * For a proposal that is one step of a move this browser verified: which
	 * step, and the move in words. An entry then names the move and the step,
	 * and what is said of both steps alike is said once (model/move.ts).
	 */
	readonly move?: (digest: Hex) => MoveRef | null;
}

/** Newest first. A proposer's own signature right after proposing is folded into "proposed … and signed". */
export function buildTimeline(
	events: readonly EventRow[],
	ctx: TimelineContext,
): TimelineEntry[] {
	// who did it, at the start of a sentence and inside one
	const subject = (a: Address | null): Part =>
		!a
			? part("Someone")
			: { text: a === ctx.me ? "You" : shortAddress(a), who: a };
	const object = (a: Address | null): Part =>
		!a
			? part("someone")
			: { text: a === ctx.me ? "you" : shortAddress(a), who: a };
	/** "your" for the reader, "their" for anybody else: the log knows addresses, not people. */
	const own = (a: Address | null) => (a && a === ctx.me ? "your" : "their");
	const action = (digest: Hex | null, start: boolean): Part[] => {
		const move = digest ? (ctx.move?.(digest) ?? null) : null;
		const line = move ? move.line : digest ? ctx.line(digest) : null;
		if (!line) return [part(start ? "A proposal" : "a proposal")];
		const title = digest ? ctx.title?.(digest) : null;
		return [
			{ text: line, strong: true },
			...(move ? [stepMark(move.step)] : []),
			...(title ? [{ text: ` (“${isolated(title)}”)`, quiet: true }] : []),
		];
	};

	const asc = [...events].sort((a, b) => a.id - b.id);
	const folded = new Set<number>();
	// A proposal closed as "carried out outside" whose finaliser then recorded
	// the accepted result was submitted through the tool after all: said once.
	const acceptedHere = new Set(
		asc
			.filter(
				(e) =>
					e.kind === "submission_recorded" &&
					e.data.accepted === true &&
					e.digest !== null,
			)
			.map((e) => e.digest),
	);
	const out: TimelineEntry[] = [];
	for (const [i, e] of asc.entries()) {
		if (folded.has(e.id)) continue;
		const entry = (parts: Part[], id = e.id): TimelineEntry => ({
			id,
			at: e.at,
			digest: e.digest,
			parts,
		});
		switch (e.kind) {
			case "treasury_added": {
				const signers = addressList(e.data.signers).map((a) => [object(a)]);
				const threshold = Number(e.data.threshold);
				// the account that was converted registers itself: nobody "added" it
				const origin =
					e.actor !== null && e.actor === e.treasury
						? say`Treasury registered by the account itself when it was converted.`
						: say`Treasury added by ${object(e.actor)}.`;
				out.push(
					entry(
						say`${origin}${
							signers.length ? say` Signers: ${joinParts(signers, ", ")}.` : ""
						}${Number.isFinite(threshold) ? ` Threshold ${threshold}.` : ""}`,
					),
				);
				break;
			}
			case "signers_changed": {
				const who = [
					...addressList(e.data.added).map((a) => say`${object(a)} added`),
					...addressList(e.data.removed).map((a) => say`${object(a)} removed`),
				];
				const before = Number(e.data.threshold_before);
				const after = Number(e.data.threshold_after);
				const threshold =
					before === after
						? `Threshold stays ${after}.`
						: `Threshold changed from ${before} to ${after}.`;
				out.push(
					entry(
						who.length
							? say`Signers changed: ${joinParts(who, ", ")}. ${threshold}`
							: say`${threshold}`,
					),
				);
				break;
			}
			case "treasury_frozen":
				out.push(
					entry(
						say`This account stopped being a multi-sig. Nothing new can be proposed; its history stays readable.`,
					),
				);
				break;
			case "treasury_unfrozen":
				out.push(entry(say`This account is a multi-sig again.`));
				break;
			case "proposal_created": {
				// the next event of the same proposal, if it is the proposer signing
				const next = asc
					.slice(i + 1)
					.find((x) => x.digest !== null && x.digest === e.digest);
				const signedToo =
					!!next && next.kind === "signature_added" && next.actor === e.actor;
				if (signedToo && next) folded.add(next.id);
				const finaliser = addressList([e.data.finaliser])[0] ?? null;
				out.push(
					entry(
						say`${subject(e.actor)} proposed ${action(e.digest, false)}${
							signedToo ? " and signed" : ""
						}.${finaliser ? say` Finaliser: ${object(finaliser)}.` : ""}`,
						signedToo && next ? next.id : e.id,
					),
				);
				break;
			}
			case "signature_added":
				out.push(
					entry(say`${subject(e.actor)} signed ${action(e.digest, false)}.`),
				);
				break;
			case "signature_removed": {
				// Saying no takes one's signature back in the same step: one entry.
				// (The next event of the same proposal, as for "proposed and signed".)
				const next = asc
					.slice(i + 1)
					.find((x) => x.digest !== null && x.digest === e.digest);
				const saidNo =
					!!next && next.kind === "objection_added" && next.actor === e.actor;
				if (saidNo && next) {
					folded.add(next.id);
					out.push(
						entry(
							say`${subject(e.actor)} said no to ${action(e.digest, false)}, taking back ${own(e.actor)} signature.`,
							next.id,
						),
					);
					break;
				}
				out.push(
					entry(
						say`${subject(e.actor)} took back ${own(e.actor)} signature on ${action(e.digest, false)}.`,
					),
				);
				break;
			}
			case "objection_added":
				out.push(
					entry(
						say`${subject(e.actor)} said no to ${action(e.digest, false)}.`,
					),
				);
				break;
			case "objection_removed": {
				// Signing replaces one's no in the same step: one entry.
				const next = asc
					.slice(i + 1)
					.find((x) => x.digest !== null && x.digest === e.digest);
				const signed =
					!!next && next.kind === "signature_added" && next.actor === e.actor;
				if (signed && next) {
					folded.add(next.id);
					out.push(
						entry(
							say`${subject(e.actor)} signed ${action(e.digest, false)}, in place of ${own(e.actor)} no.`,
							next.id,
						),
					);
					break;
				}
				out.push(
					entry(
						say`${subject(e.actor)} took back ${own(e.actor)} no to ${action(e.digest, false)}.`,
					),
				);
				break;
			}
			case "proposal_withdrawn":
				out.push(
					entry(
						say`${action(e.digest, true)} was cancelled by the proposer, ${object(e.actor)}.`,
					),
				);
				break;
			case "proposal_declined":
				out.push(
					entry(
						say`${action(e.digest, true)} will not be sent: ${object(e.actor)}, its finaliser, said no.`,
					),
				);
				break;
			case "proposal_carried_out": {
				if (acceptedHere.has(e.digest)) break;
				const noticed = addressList([e.data.reported_by])[0] ?? null;
				out.push(
					entry(
						say`${action(e.digest, true)} was carried out without being reported here. Its transaction was found on Hyperliquid${
							noticed ? say`; ${object(noticed)} noticed it` : ""
						}.`,
					),
				);
				break;
			}
			case "unknown":
				out.push(
					entry(
						say`An entry this version of the page cannot describe (“${e.rawKind}”).`,
					),
				);
				break;
			case "submission_recorded":
				out.push(
					e.data.accepted === true
						? {
								...entry(
									say`${action(e.digest, true)} was accepted by Hyperliquid. Sent by ${object(e.actor)}.`,
								),
								...(e.digest ? { accepted: [e.digest] } : {}),
							}
						: entry(
								say`Hyperliquid did not accept ${action(e.digest, false)}. Sent by ${object(e.actor)}. ${afterRejection(e.data.http_status)}`,
							),
				);
				break;
		}
	}
	// the two steps of a move: what is said of both alike is one entry
	const once = ctx.move
		? sayOncePerMove(
				out,
				{ digest: (e) => e.digest, parts: (e) => e.parts, at: (e) => e.at },
				ctx.move,
				(first, parts, second) => {
					const accepted = [
						...(first.accepted ?? []),
						...(second.accepted ?? []),
					];
					return {
						...first,
						id: Math.max(first.id, second.id),
						at: Math.max(first.at, second.at),
						parts,
						...(accepted.length ? { accepted } : {}),
					};
				},
			)
		: out;
	return once.sort((a, b) => b.id - a.id);
}

export function entryText(e: TimelineEntry): string {
	return partsText(e.parts);
}

export function historyFilename(
	network: Network,
	treasury: Address,
	ext: "json" | "csv" = "json",
): string {
	return `multisig-history-${network}-${treasury.slice(0, 10)}.${ext}`;
}

/**
 * Writes the short form of each address given ("0x49d0…0e18") whole, where
 * only one of them has that short form. A short form two of them share is
 * left as it is: the file never names the wrong one.
 */
export function wholeAddresses(
	addresses: readonly string[],
): (text: string) => string {
	const byShort = new Map<string, string | null>();
	for (const a of new Set(addresses.map((x) => x.toLowerCase()))) {
		const short = shortAddress(a);
		byShort.set(short, byShort.has(short) ? null : a);
	}
	return (text) =>
		text.replace(
			/0x[0-9a-f]{4}…[0-9a-f]{4}/gi,
			(m) => byShort.get(m.toLowerCase()) ?? m,
		);
}

/**
 * The Signing log as CSV, oldest first: when (UTC), what happened with every
 * address whole, the proposal it is about, and, for an accepted send, what
 * Hyperliquid's record said when it was exported (`record`).
 */
export function historyCsv(
	entries: readonly TimelineEntry[],
	record: (e: TimelineEntry) => string | null,
	/**
	 * Addresses the entries name inside their words (a vault, a validator):
	 * written whole in the file, as every other address is (audit F-050).
	 */
	named: readonly string[] = [],
): { readonly columns: readonly string[]; readonly rows: CsvCell[][] } {
	const whole = wholeAddresses(named);
	return {
		columns: [
			"Time (UTC)",
			"What happened",
			"Proposal",
			"Hyperliquid's record",
		],
		rows: [...entries]
			.sort((a, b) => a.at - b.at || a.id - b.id)
			.map((e) => [
				csvTime(e.at),
				whole(e.parts.map((p) => p.who ?? p.text).join("")),
				e.digest,
				e.accepted ? record(e) : null,
			]),
	};
}

/**
 * The history as one JSON file: every event, and every proposal document the
 * browser holds for them (with the signatures and receipt it verified).
 * Proposal documents are embedded in the core's own encoding, so integers
 * survive exactly.
 */
export function historyExport(i: {
	readonly network: Network;
	readonly treasury: Address;
	readonly exportedAt: number;
	readonly events: readonly EventRow[];
	readonly proposals: readonly Proposal[];
}): string {
	const head = JSON.stringify(
		{
			format: "hl-tools-multisig-history",
			v: 1,
			network: i.network,
			treasury: i.treasury,
			exportedAt: new Date(i.exportedAt).toISOString(),
			events: [...i.events]
				.sort((a, b) => a.id - b.id)
				.map((e) => ({
					id: e.id,
					at: new Date(e.at).toISOString(),
					kind: e.rawKind,
					actor: e.actor,
					digest: e.digest,
					data: e.data,
				})),
		},
		null,
		"\t",
	);
	const docs = i.proposals.map((p) => `\t\t${encodeProposal(p)}`);
	const proposals = docs.length ? `[\n${docs.join(",\n")}\n\t]` : "[]";
	return `${head.slice(0, head.lastIndexOf("}")).trimEnd()},\n\t"proposals": ${proposals}\n}\n`;
}
