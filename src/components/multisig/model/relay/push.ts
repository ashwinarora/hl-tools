/**
 * What this browser should send to the relay after a proposal changed here.
 * Pure: the page gives it the document it holds, what the relay already has,
 * and who is signed in; it answers with an ordered list of writes.
 *
 * A proposal is published only when the caller says so (creating one from the
 * propose screen, pressing "Share", or recording a result): opening a link or
 * a file never sends anything by itself.
 */
import type { Address, Hex, Network, Proposal, Receipt } from "@hl-tools/core";
import { bareDocument } from "./assemble";
import type { ProposalStatus } from "./rows";

export interface PublishRow {
	readonly network: Network;
	readonly treasury: Address;
	readonly digest: Hex;
	readonly document: string;
	readonly finaliser: Address;
	readonly nonce: number;
}

export type PushOp =
	| { readonly kind: "publish"; readonly row: PublishRow }
	| {
			readonly kind: "sign";
			readonly signature: {
				readonly r: Hex;
				readonly s: Hex;
				readonly v: 27 | 28;
			};
	  }
	| { readonly kind: "receipt"; readonly receipt: Receipt };

/** What the relay holds for this proposal; null when it does not have it. */
export interface RelayKnown {
	readonly status: ProposalStatus;
	readonly expired: boolean;
	/** Signers with a signature row, verified or not. */
	readonly signers: readonly Address[];
	readonly receiptTimes: readonly number[];
}

export interface PushInput {
	readonly doc: Proposal;
	/** The signed-in wallet. */
	readonly me: Address | null;
	readonly relay: RelayKnown | null;
	/** `me` is in the relay's stored signer list of this (unfrozen) treasury. */
	readonly storedSigner: boolean;
	/** The caller asked for the proposal to be shared if the relay lacks it. */
	readonly publish: boolean;
	/** Signers who took their signature back on the relay (see `removedSigners`). */
	readonly removed: ReadonlySet<Address>;
	/** A user action just now (signing), as opposed to a background catch-up. */
	readonly explicit: boolean;
}

/** Why a proposal cannot be shared through the relay; null when it can. */
export function publishBlocker(p: Proposal): string | null {
	if (p.meta.kind !== "user-signed") {
		return "Only user-signed actions can be shared through the relay.";
	}
	if (p.payload.vaultAddress !== null || p.payload.expiresAfter !== null) {
		return "A proposal with a vault address or an expiry cannot be shared through the relay.";
	}
	return null;
}

export function publishRow(p: Proposal): PublishRow {
	return {
		network: p.payload.network,
		treasury: p.payload.multiSigUser,
		digest: p.digest,
		document: bareDocument(p),
		finaliser: p.payload.outerSigner,
		nonce: p.payload.nonce,
	};
}

export function planPush(i: PushInput): PushOp[] {
	const { doc, me, relay } = i;
	if (!me) return [];
	const ops: PushOp[] = [];

	const publishing =
		relay === null &&
		i.publish &&
		i.storedSigner &&
		publishBlocker(doc) === null;
	if (publishing) ops.push({ kind: "publish", row: publishRow(doc) });
	if (relay === null && !publishing) return [];

	// the relay refuses signatures on a closed or expired proposal
	const collecting =
		relay === null || (relay.status === "open" && !relay.expired);
	const mine = doc.signatures.find((s) => s.signer === me);
	if (
		mine &&
		collecting &&
		!relay?.signers.includes(me) &&
		// a signature taken back is not re-sent behind the signer's back
		(i.explicit || !i.removed.has(me))
	) {
		ops.push({ kind: "sign", signature: { r: mine.r, s: mine.s, v: mine.v } });
	}

	const receipt = doc.receipt;
	if (
		receipt &&
		me === doc.payload.outerSigner &&
		relay?.status !== "accepted" &&
		!relay?.receiptTimes.includes(receipt.submittedAt)
	) {
		ops.push({ kind: "receipt", receipt });
	}
	return ops;
}
