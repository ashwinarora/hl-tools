/**
 * Two proposals that are one move.
 *
 * Hyperliquid's multi-sig takes one action per request, and some things a
 * treasury wants take two: staking HYPE that is still in spot is a move into
 * the staking balance and then a stake. The two stay ordinary proposals, each
 * signed and judged by itself. What ties them is `meta.steps`, the same list
 * of two digests in both documents, so that a page can show them as one item
 * and send the second only after the first.
 *
 * `meta` is not signed, so the tie is a claim. It is honoured only when the
 * two proposals themselves bear it out (`judgeMove`): same account, same
 * finaliser, same proposer, and actions that are exactly one of the moves
 * named here. A forged tie can therefore never show a send as "staking", and
 * the worst a false one does is put two honest proposals on one page.
 *
 * A vault deposit from a manual account whose USDC is in spot is the fourth
 * move: USDC to the perps balance, then the deposit. Its second step is an
 * L1 action, signed as a hash under chain 1337; that mix of the two kinds of
 * signature is taken for this move and for no other.
 */
import { Decimal } from "../decimal.ts";
import { type StakingAction, stakingActionOf } from "./staking.ts";
import type { Hex, Proposal } from "./types.ts";
import { type VaultAction, vaultActionOf, vaultHeadline } from "./vault.ts";

/**
 * stake   move HYPE into the staking balance, then stake with a validator
 * return  unstake from a validator, then start the return to spot
 * switch  unstake from one validator, then stake with another
 * vault   move USDC from spot to the perps balance, then deposit it into a vault
 */
export type MoveKind = "stake" | "return" | "switch" | "vault";

export interface Move {
	readonly kind: MoveKind;
	/** The two proposals, in the order they are submitted. */
	readonly steps: readonly [Proposal, Proposal];
	/**
	 * What the move comes to. HYPE for the staking moves: staked, back in
	 * spot, or moved across. USDC for a vault deposit.
	 */
	readonly amount: string;
	/** Staked with (stake), unstaked from (return, switch). Empty for a vault deposit. */
	readonly validator: string;
	/** Switch only: the validator the HYPE goes to. */
	readonly to: string | null;
	/** Vault only: the vault the USDC goes into. */
	readonly vault?: string | null;
}

/** What a move comes to, without its two proposals. */
export type MoveShape = Pick<
	Move,
	"kind" | "amount" | "validator" | "to" | "vault"
>;

/** Why two proposals are not one move. */
export type MoveFlaw =
	| "untied"
	| "other-list"
	| "not-on-list"
	| "network"
	| "account"
	| "finaliser"
	| "proposer"
	| "form"
	| "order"
	| "shape";

/** `second` minus `first` is not negative: the first step never moves more than the move comes to. */
const within = (first: string, second: string): boolean =>
	Decimal.parse(first).lte(Decimal.parse(second));

/**
 * The move two staking actions make in this order, or null. The first step
 * brings no more than the second uses, so the headline (the second step's
 * amount) never understates what happens.
 */
export function moveShape(
	first: StakingAction,
	second: StakingAction,
): MoveShape | null {
	if (
		first.kind === "moveIn" &&
		second.kind === "stake" &&
		within(first.amount, second.amount)
	)
		return {
			kind: "stake",
			amount: second.amount,
			validator: second.validator,
			to: null,
		};
	if (
		first.kind === "unstake" &&
		second.kind === "return" &&
		within(first.amount, second.amount)
	)
		return {
			kind: "return",
			amount: second.amount,
			validator: first.validator,
			to: null,
		};
	if (
		first.kind === "unstake" &&
		second.kind === "stake" &&
		first.amount === second.amount &&
		first.validator !== second.validator
	)
		return {
			kind: "switch",
			amount: second.amount,
			validator: first.validator,
			to: second.validator,
		};
	return null;
}

/**
 * The move a transfer from spot to perps and a vault deposit make in this
 * order, or null. As with staking, the first step brings no more than the
 * second uses: the headline is the deposit, and it never understates.
 */
export function vaultMoveShape(
	first: unknown,
	second: VaultAction,
): MoveShape | null {
	const a =
		first && typeof first === "object" && !Array.isArray(first)
			? (first as Record<string, unknown>)
			: null;
	const moved =
		a?.type === "usdClassTransfer" &&
		a.toPerp === true &&
		typeof a.amount === "string"
			? Decimal.tryParse(a.amount)
			: null;
	if (
		!moved?.isPositive() ||
		second.kind !== "deposit" ||
		!within(moved.toString(), second.amount)
	)
		return null;
	return {
		kind: "vault",
		amount: second.amount,
		validator: "",
		to: null,
		vault: second.vault,
	};
}

/** Write the tie into both proposals, once both exist. Their digests do not change: `meta` is outside them. */
export function tieSteps(
	first: Proposal,
	second: Proposal,
): readonly [Proposal, Proposal] {
	const steps: readonly [Hex, Hex] = [first.digest, second.digest];
	return [
		{ ...first, meta: { ...first.meta, steps } },
		{ ...second, meta: { ...second.meta, steps } },
	];
}

/** The digest of the other step, for a proposal that says it is part of a move. */
export function otherStep(p: Proposal): Hex | null {
	const [first, second] = p.meta.steps ?? [];
	return first === p.digest
		? (second as Hex)
		: second === p.digest
			? (first as Hex)
			: null;
}

/** Which step of its move a proposal says it is: 1 or 2; null when it stands alone. */
export function stepNumber(p: Proposal): 1 | 2 | null {
	const [first, second] = p.meta.steps ?? [];
	return first === p.digest ? 1 : second === p.digest ? 2 : null;
}

/**
 * Whether two proposals are one move, and if not, the first reason. `by`
 * names who proposed each as someone other than the documents says it (the
 * relay stamps that itself); without it the documents' own `createdBy` is
 * compared, and a proposal that names nobody is tied to nothing.
 */
export function judgeMove(
	a: Proposal,
	b: Proposal,
	by?: { readonly a: string | null; readonly b: string | null },
):
	| { readonly move: Move; readonly flaw: null }
	| { readonly move: null; readonly flaw: MoveFlaw } {
	const no = (flaw: MoveFlaw) => ({ move: null, flaw });
	const list = a.meta.steps;
	if (!list || !b.meta.steps) return no("untied");
	if (list[0] !== b.meta.steps[0] || list[1] !== b.meta.steps[1])
		return no("other-list");
	const first = [a, b].find((p) => p.digest === list[0]);
	const second = [a, b].find((p) => p.digest === list[1]);
	if (!first || !second) return no("not-on-list");
	if (first.payload.network !== second.payload.network) return no("network");
	if (first.payload.multiSigUser !== second.payload.multiSigUser)
		return no("account");
	if (first.payload.outerSigner !== second.payload.outerSigner)
		return no("finaliser");
	const proposers = by ? [by.a, by.b] : [a.meta.createdBy, b.meta.createdBy];
	if (!proposers[0] || proposers[0] !== proposers[1]) return no("proposer");
	// Nothing outside the digest in either, and one of two forms: both signed
	// as readable data under one chain (the staking moves), or a readable
	// first step and a vault deposit, which is signed as a hash.
	const deposit =
		second.meta.kind === "l1" ? vaultActionOf(second.payload.action) : null;
	const readable =
		second.meta.kind === "user-signed" &&
		first.payload.action.signatureChainId ===
			second.payload.action.signatureChainId;
	if (
		first.meta.kind !== "user-signed" ||
		!(readable || deposit?.kind === "deposit") ||
		[first, second].some(
			(p) => p.payload.vaultAddress !== null || p.payload.expiresAfter !== null,
		)
	)
		return no("form");
	if (first.payload.nonce >= second.payload.nonce) return no("order");
	const one = stakingActionOf(first.payload.action);
	const two = stakingActionOf(second.payload.action);
	const shape = deposit
		? vaultMoveShape(first.payload.action, deposit)
		: one && two
			? moveShape(one, two)
			: null;
	if (!shape) return no("shape");
	return { move: { ...shape, steps: [first, second] }, flaw: null };
}

/** The move two proposals make, or null when they are not one (see `judgeMove`). */
export function moveOf(
	a: Proposal,
	b: Proposal,
	by?: { readonly a: string | null; readonly b: string | null },
): Move | null {
	return judgeMove(a, b, by).move;
}

/** One line for a move: what it comes to, in Hyperliquid's own words. */
export function moveHeadline(m: MoveShape): string {
	switch (m.kind) {
		case "vault":
			return vaultHeadline("deposit", `${m.amount} USDC`, m.vault ?? "");
		case "stake":
			return `Stake ${m.amount} HYPE with validator ${m.validator}`;
		case "return":
			return `Return ${m.amount} HYPE to the spot balance`;
		default:
			return `Move ${m.amount} HYPE from validator ${m.validator} to validator ${m.to}`;
	}
}
