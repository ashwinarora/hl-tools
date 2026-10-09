/**
 * Per-browser history of multi-sig proposals (IndexedDB, keyed by digest).
 * This is not chain data: the chain has no notion of a proposal until it is
 * submitted. It lets a signer find the proposal they opened yesterday, and it
 * is where copies arriving by link, file or paste are merged.
 *
 * Saving never appends blindly: the incoming copy is merged with the stored
 * one through the core's `mergeProposals` (one signature per signer, anything
 * that does not recover to its claimed signer is dropped).
 *
 * Every write of a proposal is read, decide, write; two of them at once (a
 * signature made on the page while a relay update arrives, or two tabs) would
 * lose one. They take turns per digest: across tabs through the Web Locks API
 * where the browser has it, within the tab otherwise.
 */
import {
	type Address,
	decodeProposal,
	deepEqual,
	encodeProposal,
	explainExchangeError,
	type Hex,
	type Issue,
	issue,
	type Kind,
	mergeProposals,
	type Network,
	type Proposal,
	type Receipt,
} from "@hl-tools/core";
import { idbRequest } from "#/lib/idb";

export interface StoredProposal {
	readonly digest: Hex;
	readonly network: Network;
	readonly multiSigUser: Address;
	readonly title: string | null;
	readonly kind: Kind;
	readonly actionType: string;
	readonly signatures: number;
	/** Outcome of the submission recorded in the document, if any. */
	readonly submitted: "ok" | "error" | null;
	readonly updatedAt: number;
	/** `encodeProposal` text: the document is stored as it travels. */
	readonly doc: string;
}

export function receiptOk(r: Receipt): boolean {
	return explainExchangeError(r.response, r.httpStatus).id === "ok";
}

/** An accepted submission beats a rejected one; otherwise the later attempt wins. */
export function betterReceipt(
	a: Receipt | null,
	b: Receipt | null,
): Receipt | null {
	if (!a) return b;
	if (!b) return a;
	const aOk = receiptOk(a);
	if (aOk !== receiptOk(b)) return aOk ? a : b;
	return b.submittedAt > a.submittedAt ? b : a;
}

export function toStored(
	p: Proposal,
	now: number = Date.now(),
): StoredProposal {
	return {
		digest: p.digest,
		network: p.payload.network,
		multiSigUser: p.payload.multiSigUser,
		title: p.meta.title,
		kind: p.meta.kind,
		actionType: String(p.payload.action.type),
		signatures: p.signatures.length,
		submitted: p.receipt ? (receiptOk(p.receipt) ? "ok" : "error") : null,
		updatedAt: now,
		doc: encodeProposal(p),
	};
}

const turns = new Map<string, Promise<unknown>>();

/** Run `fn` when no other write of this proposal is in progress. */
export function withProposalLock<T>(
	digest: string,
	fn: () => Promise<T>,
): Promise<T> {
	const locks =
		typeof navigator === "undefined"
			? undefined
			: (navigator as { locks?: LockManager }).locks;
	if (locks) {
		// resolves with what `fn` resolves with (the DOM types say a promise of a promise)
		return locks.request(
			`hl-tools:proposal:${digest}`,
			fn,
		) as unknown as Promise<T>;
	}
	const before = turns.get(digest) ?? Promise.resolve();
	const mine = before.then(fn, fn);
	const settled = mine.catch(() => undefined);
	turns.set(digest, settled);
	void settled.then(() => {
		if (turns.get(digest) === settled) turns.delete(digest);
	});
	return mine;
}

export interface LoadResult {
	readonly proposal: Proposal | null;
	readonly issues: readonly Issue[];
}

export async function loadProposal(digest: string): Promise<LoadResult> {
	const row = await idbRequest<StoredProposal | undefined>(
		"proposals",
		"readonly",
		(s) => s.get(digest) as IDBRequest<StoredProposal | undefined>,
	);
	if (!row) return { proposal: null, issues: [] };
	const d = decodeProposal(row.doc);
	return { proposal: d.proposal, issues: d.issues };
}

export interface SaveResult {
	/** What is in the store after the call (the stored copy when nothing was written). */
	readonly proposal: Proposal;
	readonly saved: boolean;
	readonly issues: readonly Issue[];
}

/**
 * Merge `incoming` with the stored copy of the same digest and write the
 * result. A copy whose payload differs from the stored one is refused: for
 * user-signed actions `vaultAddress` and `expiresAfter` are outside the digest,
 * so an equal digest does not prove an equal payload.
 */
export function saveProposal(
	incoming: Proposal,
	deps: { now?: number } = {},
): Promise<SaveResult> {
	return withProposalLock(incoming.digest, async () => {
		const existing = (await loadProposal(incoming.digest)).proposal;
		if (existing && !deepEqual(existing.payload, incoming.payload)) {
			return conflict(existing);
		}
		// Merging with an empty copy still verifies every signature of a first-time document.
		const m = await mergeProposals(
			incoming,
			existing ?? { ...incoming, signatures: [] },
		);
		/* v8 ignore next 3 -- equal digests always merge; kept so a core change cannot write garbage */
		if (!m.merged) {
			return { proposal: existing ?? incoming, saved: false, issues: m.issues };
		}
		const next: Proposal = {
			...m.merged,
			receipt: betterReceipt(existing?.receipt ?? null, incoming.receipt),
		};
		await put(next, deps.now);
		return { proposal: next, saved: true, issues: m.issues };
	});
}

function conflict(existing: Proposal): SaveResult {
	return {
		proposal: existing,
		saved: false,
		issues: [
			issue(
				"history.payload_conflict",
				"error",
				"This copy has the same digest as a stored proposal but a different payload (vault address or expiry). It was not merged.",
				{
					fix: "Compare both copies in the Multisig Inspector; delete the stored one only if you trust the new copy.",
				},
			),
		],
	};
}

function put(p: Proposal, now?: number): Promise<IDBValidKey> {
	return idbRequest(
		"proposals",
		"readwrite",
		(s) => s.put(toStored(p, now)) as IDBRequest<IDBValidKey>,
	);
}

/**
 * Replace the stored copy with whatever `decide` makes of it. Unlike saving,
 * this can remove a signature: it is how a signature taken back on the relay
 * leaves this browser's history too. `decide` gets the stored copy (null when
 * there is none) and returns the copy to store, or null to leave things as
 * they are; it must return something already verified, nothing is re-checked
 * here. A copy with a different payload under the same digest is refused, as
 * when saving.
 */
export function rewriteProposal(
	digest: string,
	decide: (stored: Proposal | null) => Promise<Proposal | null>,
	deps: { now?: number } = {},
): Promise<SaveResult | null> {
	return withProposalLock(digest, async () => {
		const existing = (await loadProposal(digest)).proposal;
		const next = await decide(existing);
		if (!next || next.digest !== digest) return null;
		if (existing && !deepEqual(existing.payload, next.payload)) {
			return conflict(existing);
		}
		if (existing && encodeProposal(existing) === encodeProposal(next)) {
			return { proposal: existing, saved: false, issues: [] };
		}
		await put(next, deps.now);
		return { proposal: next, saved: true, issues: [] };
	});
}

/** Newest first; optionally only one network. */
export async function listProposals(
	network?: Network,
): Promise<StoredProposal[]> {
	const all = await idbRequest<StoredProposal[]>(
		"proposals",
		"readonly",
		(s) => s.getAll() as IDBRequest<StoredProposal[]>,
	);
	return all
		.filter((r) => !network || r.network === network)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProposal(digest: string): Promise<void> {
	await idbRequest<undefined>(
		"proposals",
		"readwrite",
		(s) => s.delete(digest) as IDBRequest<undefined>,
	);
}
