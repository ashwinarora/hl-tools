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
	publish(p: Proposal): Published;
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
		publish(p) {
			// the document travels as text so integer lexemes above 2^53 survive
			const doc = encodeProposal(p);
			const url = `${origin()}${PROPOSAL_PATH}#${shareFragment(SHARE_TOOL, { doc })}`;
			return {
				transport: "link",
				url,
				bytes: url.length,
				issues: sizeIssues(doc.length),
			};
		},
	};
}

export function proposalFilename(p: Proposal): string {
	const n = p.signatures.length;
	return `multisig-${p.payload.network}-${p.digest.slice(2, 10)}-${n}sig.json`;
}

export function fileTransport(
	save: (filename: string, text: string) => void,
): ProposalTransport {
	return {
		id: "file",
		label: "File",
		publish(p) {
			const text = encodeProposal(p, { pretty: true });
			const filename = proposalFilename(p);
			save(filename, text);
			return { transport: "file", filename, bytes: text.length, issues: [] };
		},
	};
}

/** The document text inside a share fragment, if the fragment is one of ours. */
export function documentFromFragment(hash: string): string | null {
	const payload = parseShareFragment(hash);
	if (!payload || payload.tool !== SHARE_TOOL) return null;
	const doc = (payload.state as { doc?: unknown }).doc;
	return typeof doc === "string" ? doc : null;
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
