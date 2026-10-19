/**
 * How a proposal document leaves this browser and comes back. One interface,
 * two implementations today (a link whose fragment carries the document, and a
 * file); the relay of a later phase is a third. The screens only know the
 * interface, and everything that arrives ends in the core's strict decoder.
 */
import {
	type DecodeResult,
	decodeProposal,
	encodeProposal,
	type Issue,
	issue,
	PROPOSAL_SIZE_WARN_BYTES,
	type Proposal,
	stringifyJson,
	tryParseJson,
} from "@hl-tools/core";
import { parseShareFragment, shareFragment } from "#/lib/share";

export type TransportId = "link" | "file";

export interface Published {
	readonly transport: TransportId;
	readonly url?: string;
	readonly filename?: string;
	/** Size of what travels: the URL for a link, the file text for a file. */
	readonly bytes: number;
	readonly issues: readonly Issue[];
}

export interface ProposalTransport {
	readonly id: TransportId;
	readonly label: string;
	/**
	 * `also`: the further steps of the same move, in order. They travel with
	 * `p` in the one link or file, so whoever opens it sees the move whole.
	 */
	publish(p: Proposal, also?: readonly Proposal[]): Published;
}

/** Tool key inside the `#share=` payload; the proposal page reads it. */
export const SHARE_TOOL = "multisig-proposal";
export const PROPOSAL_PATH = "/multisig/proposal";

export function sizeIssues(documentBytes: number): Issue[] {
	return documentBytes > PROPOSAL_SIZE_WARN_BYTES
		? [
				issue(
					"transport.oversize",
					"warning",
					`The document is ${documentBytes} bytes; chat apps and browsers may cut links over ${PROPOSAL_SIZE_WARN_BYTES}.`,
					{ fix: "Send the file instead of the link." },
				),
			]
		: [];
}

/** `origin` is e.g. `https://hltools.tech` (no trailing slash). */
export function linkTransport(origin: () => string): ProposalTransport {
	return {
		id: "link",
		label: "Link",
		publish(p, also = []) {
			// the document travels as text so integer lexemes above 2^53 survive
			const doc = encodeProposal(p);
			// `doc` is where a build from before moves looks: it opens step 1 by itself
			const rest = also.map((x) => encodeProposal(x));
			const url = `${origin()}${PROPOSAL_PATH}#${shareFragment(
				SHARE_TOOL,
				rest.length > 0 ? { doc, also: rest } : { doc },
			)}`;
			return {
				transport: "link",
				url,
				bytes: url.length,
				issues: sizeIssues(
					doc.length + rest.reduce((n, text) => n + text.length, 0),
				),
			};
		},
	};
}

export function proposalFilename(p: Proposal): string {
	const n = p.signatures.length;
	return `multisig-${p.payload.network}-${p.digest.slice(2, 10)}-${n}sig.json`;
}

/** The file of a move: named after its first step. */
export function moveFilename(first: Proposal): string {
	return `multisig-${first.payload.network}-${first.digest.slice(2, 10)}-move.json`;
}

/** The key under which a file holds the steps of a move, in order. */
const MOVE_KEY = "move";

/**
 * The steps of a move as one text: `{"move":[…, …]}`, each step exactly as
 * it is written by itself (so nothing about a number changes on the way).
 */
export function moveText(steps: readonly Proposal[]): string {
	return `{"${MOVE_KEY}":[\n${steps
		.map((p) => encodeProposal(p, { pretty: true }))
		.join(",\n")}\n]}\n`;
}

export function fileTransport(
	save: (filename: string, text: string) => void,
): ProposalTransport {
	return {
		id: "file",
		label: "File",
		publish(p, also = []) {
			const move = also.length > 0;
			const text = move
				? moveText([p, ...also])
				: encodeProposal(p, { pretty: true });
			const filename = move ? moveFilename(p) : proposalFilename(p);
			save(filename, text);
			return { transport: "file", filename, bytes: text.length, issues: [] };
		},
	};
}

/** The document text inside a share fragment, if the fragment is one of ours. */
export function documentFromFragment(hash: string): string | null {
	return documentsFromFragment(hash)?.[0] ?? null;
}

/**
 * Every document a share fragment carries, in order: one, or the steps of a
 * move. Null when the fragment is not one of ours.
 */
export function documentsFromFragment(hash: string): string[] | null {
	const payload = parseShareFragment(hash);
	if (!payload || payload.tool !== SHARE_TOOL) return null;
	const { doc, also } = payload.state as { doc?: unknown; also?: unknown };
	if (typeof doc !== "string") return null;
	return [
		doc,
		...(Array.isArray(also)
			? also.filter((x): x is string => typeof x === "string")
			: []),
	];
}

/**
 * Whatever a person pastes or uploads: the document itself, or a link that
 * carries one (people paste links into the box). Always ends in the strict
 * decoder; a link's fragment is decoded locally and never fetched.
 */
export function openText(text: string, now?: number): DecodeResult {
	const trimmed = text.trim();
	const hashAt = trimmed.indexOf("#share=");
	if (hashAt >= 0 && !trimmed.startsWith("{")) {
		const doc = documentFromFragment(trimmed.slice(hashAt));
		if (doc === null) {
			return {
				proposal: null,
				issues: [
					issue(
						"transport.link",
						"error",
						"This link does not carry a multi-sig proposal.",
					),
				],
			};
		}
		return decodeProposal(doc, { now });
	}
	return decodeProposal(trimmed, { now });
}

export interface OpenedAll {
	/** One proposal, or the steps of a move in order. Empty when something did not open. */
	readonly proposals: readonly Proposal[];
	readonly issues: readonly Issue[];
}

/**
 * Like `openText`, for what may carry a whole move: a link with both steps
 * in its fragment, or a move's file. Every document goes through the strict
 * decoder by itself, and a move is opened whole or not at all: half a move
 * is not what was sent.
 */
export function openAll(text: string, now?: number): OpenedAll {
	const trimmed = text.trim();
	let docs: string[] | null = null;
	const hashAt = trimmed.indexOf("#share=");
	if (hashAt >= 0 && !trimmed.startsWith("{")) {
		docs = documentsFromFragment(trimmed.slice(hashAt));
	} else if (trimmed.startsWith("{")) {
		const parsed = tryParseJson(trimmed);
		const node = parsed.ok ? parsed.node : null;
		const steps =
			node?.kind === "object" && node.entries.length === 1
				? node.entries.find((e) => e.key === MOVE_KEY)?.value
				: null;
		if (steps?.kind === "array")
			docs = steps.items.map((item) => stringifyJson(item, 0));
	}
	// anything else is one document, or a link that is not ours: `openText` says which
	if (!docs || docs.length < 2) {
		const one = openText(text, now);
		return {
			proposals: one.proposal ? [one.proposal] : [],
			issues: one.issues,
		};
	}
	const opened = docs.map((doc) => decodeProposal(doc, { now }));
	const proposals = opened.flatMap((o) => (o.proposal ? [o.proposal] : []));
	const issues = opened.flatMap((o, i) =>
		o.issues.map((x) => ({ ...x, message: `Step ${i + 1}: ${x.message}` })),
	);
	return proposals.length === docs.length
		? { proposals, issues }
		: { proposals: [], issues };
}
