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
import { shortAddress } from "../stage";
import { addressList, type EventRow } from "./rows";

export interface Part {
	readonly text: string;
	/** The action line of a proposal. */
	readonly strong?: boolean;
}

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
}

const t = (text: string): Part => ({ text });

/** Newest first. A proposer's own signature right after proposing is folded into "proposed … and signed". */
export function buildTimeline(
	events: readonly EventRow[],
	ctx: TimelineContext,
): TimelineEntry[] {
	const subject = (a: Address | null) =>
		!a ? "Someone" : a === ctx.me ? "You" : shortAddress(a);
	const object = (a: Address | null) =>
		!a ? "someone" : a === ctx.me ? "you" : shortAddress(a);
	const action = (digest: Hex | null, start: boolean): Part => {
		const line = digest ? ctx.line(digest) : null;
		return line
			? { text: line, strong: true }
			: t(start ? "A proposal" : "a proposal");
	};

	const asc = [...events].sort((a, b) => a.id - b.id);
	const folded = new Set<number>();
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
				const signers = addressList(e.data.signers).map(object);
				const threshold = Number(e.data.threshold);
				out.push(
					entry([
						t(
							`Treasury added by ${object(e.actor)}.${signers.length ? ` Signers: ${signers.join(", ")}.` : ""}${Number.isFinite(threshold) ? ` Threshold ${threshold}.` : ""}`,
						),
					]),
				);
				break;
			}
			case "signers_changed": {
				const added = addressList(e.data.added).map(
					(a) => `${object(a)} added`,
				);
				const removed = addressList(e.data.removed).map(
					(a) => `${object(a)} removed`,
				);
				const before = Number(e.data.threshold_before);
				const after = Number(e.data.threshold_after);
				const who = [...added, ...removed];
				const threshold =
					before === after
						? `Threshold stays ${after}.`
						: `Threshold changed from ${before} to ${after}.`;
				out.push(
					entry([
						t(
							who.length
								? `Signers changed: ${who.join(", ")}. ${threshold}`
								: threshold,
						),
					]),
				);
				break;
			}
			case "treasury_frozen":
				out.push(
					entry([
						t(
							"This account stopped being a multi-sig. Nothing new can be proposed; its history stays readable.",
						),
					]),
				);
				break;
			case "treasury_unfrozen":
				out.push(entry([t("This account is a multi-sig again.")]));
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
						[
							t(`${subject(e.actor)} proposed `),
							action(e.digest, false),
							t(
								`${signedToo ? " and signed" : ""}.${finaliser ? ` Finaliser: ${object(finaliser)}.` : ""}`,
							),
						],
						signedToo && next ? next.id : e.id,
					),
				);
				break;
			}
			case "signature_added":
				out.push(
					entry([
						t(`${subject(e.actor)} signed `),
						action(e.digest, false),
						t("."),
					]),
				);
				break;
			case "signature_removed":
				out.push(
					entry([
						t(
							e.actor && e.actor === ctx.me
								? "You took back your signature on "
								: `${subject(e.actor)} took back their signature on `,
						),
						action(e.digest, false),
						t("."),
					]),
				);
				break;
			case "proposal_withdrawn":
				out.push(
					entry([
						action(e.digest, true),
						t(` was withdrawn by the proposer, ${object(e.actor)}.`),
					]),
				);
				break;
			case "proposal_declined":
				out.push(
					entry([
						action(e.digest, true),
						t(` was declined by the finaliser, ${object(e.actor)}.`),
					]),
				);
				break;
			case "submission_recorded":
				out.push(
					entry(
						e.data.accepted === true
							? [
									action(e.digest, true),
									t(
										` was accepted by Hyperliquid. Submitted by ${object(e.actor)}.`,
									),
								]
							: [
									t("Hyperliquid rejected "),
									action(e.digest, false),
									t(`. Submitted by ${object(e.actor)}; it can be retried.`),
								],
					),
				);
				break;
		}
	}
	return out.sort((a, b) => b.id - a.id);
}

export function entryText(e: TimelineEntry): string {
	return e.parts.map((p) => p.text).join("");
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
					kind: e.kind,
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
