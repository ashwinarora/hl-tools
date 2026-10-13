/**
 * Whose word a receipt is. Pure.
 *
 * A receipt says what Hyperliquid answered when a proposal was submitted. It
 * travels in the document, which anyone can edit, and nothing in the answer
 * itself is signed by Hyperliquid. What can be checked is who reports it: the
 * receipt carries the signature its finaliser put under the submission, and
 * that signature is over the exact request that was sent. So a receipt whose
 * signature is the finaliser's is the finaliser's report, and any other
 * receipt is nobody's: it is left out, and the proposal stays what it was.
 *
 * This does not make the report true. A finaliser can sign a submission and
 * then write down another answer than the one Hyperliquid gave; only
 * Hyperliquid's own record settles that.
 *
 * The request holds the signatures that counted when it was sent, in the order
 * the finaliser's copy had them. A copy read later can hold more of them, or
 * hold them in another order, so the check tries the likely selections first
 * and then the others, up to a budget.
 */
import type { Address } from "../identity.ts";
import { envelopeDigest } from "./digest.ts";
import { recoverInnerSigner, trimSig } from "./signature.ts";
import type {
	EnvelopeRequest,
	Proposal,
	ProposalSignature,
	Receipt,
} from "./types.ts";

/** How many selections of signatures are tried at most (each is one hash and one recovery). */
export const RECEIPT_BUDGET = 2_000;
/** Up to this many signatures every order of every selection is tried too. */
const EVERY_ORDER_UP_TO = 5;

/** finaliser: signed by the proposal's finaliser. unverified: not shown to be. */
export type ReceiptCheck = "finaliser" | "unverified";

export interface ReceiptCheckOptions {
	/** The signatures to choose from; the proposal's own when left out. */
	readonly signatures?: readonly ProposalSignature[];
	/** They were recovered a moment ago (by a merge): not recovered again. */
	readonly verified?: boolean;
	readonly budget?: number;
}

/** Every selection of `list` that keeps its order, largest first, the whole list first of all. */
function* inOrder<T>(list: readonly T[]): Generator<readonly T[]> {
	const n = list.length;
	const masks = Array.from({ length: 2 ** n }, (_, m) => m).sort(
		(a, b) => ones(b) - ones(a) || b - a,
	);
	for (const m of masks) yield list.filter((_, i) => (m >> i) & 1);
}

const ones = (m: number): number => {
	let n = 0;
	for (let x = m; x > 0; x >>= 1) n += x & 1;
	return n;
};

/** Every order of every selection of `list`. */
function* everyOrder<T>(
	list: readonly T[],
	picked: readonly T[] = [],
): Generator<readonly T[]> {
	yield picked;
	for (const item of list) {
		if (!picked.includes(item)) yield* everyOrder(list, [...picked, item]);
	}
}

/**
 * Whether `receipt` is the word of `p`'s finaliser: its outer signature
 * recovers to `payload.outerSigner` over a submission of this proposal that
 * carries some of the signatures given. Signatures that do not recover to the
 * signer they are filed under are not considered. Never throws.
 */
export async function checkReceipt(
	p: Proposal,
	receipt: Receipt,
	opts: ReceiptCheckOptions = {},
): Promise<ReceiptCheck> {
	// one per signer, and only what verifies: nothing else is ever sent
	const valid: ProposalSignature[] = [];
	const seen = new Set<Address>();
	for (const s of opts.signatures ?? p.signatures) {
		if (seen.has(s.signer)) continue;
		if (!opts.verified && (await recoverInnerSigner(p.digest, s)) !== s.signer)
			continue;
		seen.add(s.signer);
		valid.push(s);
	}
	const tried = new Set<string>();
	let left = opts.budget ?? RECEIPT_BUDGET;
	const isFinalisers = async (
		chosen: readonly ProposalSignature[],
	): Promise<boolean> => {
		const key = chosen.map((s) => s.signer).join(",");
		if (tried.has(key) || left <= 0) return false;
		tried.add(key);
		left -= 1;
		const request: EnvelopeRequest = {
			action: {
				type: "multiSig",
				signatureChainId: receipt.signatureChainId,
				signatures: chosen.map((s) => trimSig({ r: s.r, s: s.s, v: s.v })),
				payload: {
					multiSigUser: p.payload.multiSigUser,
					outerSigner: p.payload.outerSigner,
					action: p.payload.action,
				},
			},
			nonce: p.payload.nonce,
			vaultAddress: p.payload.vaultAddress,
			expiresAfter: p.payload.expiresAfter,
		};
		const { digest } = envelopeDigest(request, p.payload.network);
		/* v8 ignore next -- a proposal that has a digest hashes as a submission too */
		if (!digest) return false;
		const by = await recoverInnerSigner(digest, receipt.outerSignature);
		return by === p.payload.outerSigner;
	};

	// what was on record when it was sent, as far as the copy says
	const before = valid.filter(
		(s) => s.at === null || s.at <= receipt.submittedAt,
	);
	if (await isFinalisers(before)) return "finaliser";
	for (const chosen of inOrder(valid)) {
		if (left <= 0) return "unverified";
		if (await isFinalisers(chosen)) return "finaliser";
	}
	if (valid.length <= EVERY_ORDER_UP_TO) {
		for (const chosen of everyOrder(valid)) {
			if (left <= 0) return "unverified";
			if (await isFinalisers(chosen)) return "finaliser";
		}
	}
	return "unverified";
}
