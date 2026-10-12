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
	type Network,
	type Proposal,
} from "@hl-tools/core";
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
}

export interface TimelineContext {
	readonly me: Address | null;
	/** The action in words for a proposal, when its document is at hand. */
	readonly line: (digest: Hex) => string | null;
	/** The proposal's title, if it has one. It follows the action, never replaces it. */
	readonly title?: (digest: Hex) => string | null;
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
	const action = (digest: Hex | null, start: boolean): Part[] => {
		const line = digest ? ctx.line(digest) : null;
		if (!line) return [part(start ? "A proposal" : "a proposal")];
		const title = digest ? ctx.title?.(digest) : null;
		return title
			? [
					{ text: line, strong: true },
					{ text: ` (“${title}”)`, quiet: true },
				]
			: [{ text: line, strong: true }];
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
			case "signature_removed":
				out.push(
					entry(
						e.actor && e.actor === ctx.me
							? say`${subject(e.actor)} took back your signature on ${action(e.digest, false)}.`
							: say`${subject(e.actor)} took back their signature on ${action(e.digest, false)}.`,
					),
				);
				break;
			case "proposal_withdrawn":
				out.push(
					entry(
						say`${action(e.digest, true)} was withdrawn by the proposer, ${object(e.actor)}.`,
					),
				);
				break;
			case "proposal_declined":
				out.push(
					entry(
						say`${action(e.digest, true)} was declined by the finaliser, ${object(e.actor)}.`,
					),
				);
				break;
			case "proposal_carried_out": {
				if (acceptedHere.has(e.digest)) break;
				const noticed = addressList([e.data.reported_by])[0] ?? null;
				out.push(
					entry(
						say`${action(e.digest, true)} was carried out without being reported here. The relay checked the transaction on Hyperliquid${
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
					entry(
						e.data.accepted === true
							? say`${action(e.digest, true)} was accepted by Hyperliquid. Submitted by ${object(e.actor)}.`
							: say`Hyperliquid rejected ${action(e.digest, false)}. Submitted by ${object(e.actor)}. ${afterRejection(e.data.http_status)}`,
					),
				);
				break;
		}
	}
	return out.sort((a, b) => b.id - a.id);
}

export function entryText(e: TimelineEntry): string {
	return partsText(e.parts);
}

export function historyFilename(network: Network, treasury: Address): string {
	return `multisig-history-${network}-${treasury.slice(0, 10)}.json`;
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
