/**
 * The same payment proposed twice is paid twice: Hyperliquid carries out each
 * proposal once, and two proposals are two numbers (audit F-026, F-106,
 * decision D4 of 2026-10-20). A proposal page and the form say so, in one
 * amber line, when a proposal like this one is still waiting. Nothing is
 * blocked, and nothing is kept of what was paid before: a payment can also be
 * made outside this tool.
 */
import { Decimal, sendShape } from "@hl-tools/core";
import { type OnRecord, waitingProposals } from "./signerSet";

/** What a payment out of the treasury pays, and to whom. */
interface Payment {
	readonly kind: "send" | "withdrawal";
	readonly destination: string;
	readonly token: string;
	readonly amount: Decimal;
}

/** The payment an action makes to another account or out through the bridge; null for anything else. */
export function paymentOf(action: unknown, self?: string): Payment | null {
	const shape = sendShape(action);
	if (shape?.destination && shape.amount) {
		// a move between the treasury's own balances pays nobody
		if (self && shape.destination === self.toLowerCase()) return null;
		return {
			kind: "send",
			destination: shape.destination,
			token: shape.token,
			amount: shape.amount,
		};
	}
	const a = action as Record<string, unknown> | null;
	if (a?.type === "withdraw3" && typeof a.destination === "string") {
		const amount =
			typeof a.amount === "string" ? Decimal.tryParse(a.amount) : null;
		return amount
			? {
					kind: "withdrawal",
					destination: a.destination.toLowerCase(),
					token: "USDC",
					amount,
				}
			: null;
	}
	return null;
}

/** Two actions that pay the same amount of the same token to the same place. */
export function samePayment(a: Payment, b: Payment): boolean {
	return (
		a.kind === b.kind &&
		a.destination === b.destination &&
		a.token === b.token &&
		a.amount.eq(b.amount)
	);
}

/**
 * The first proposal still waiting that pays what `action` pays: same
 * treasury (the list is one treasury's), same kind of payment, destination,
 * token and amount. Never the proposal itself (`except`).
 */
export function likeWaiting<T extends OnRecord>(
	action: unknown,
	known: readonly T[],
	opts: {
		readonly self?: string;
		readonly except?: string;
		readonly now: number;
	},
): T | null {
	const mine = paymentOf(action, opts.self);
	if (!mine) return null;
	for (const k of waitingProposals(known, opts.now)) {
		if (k.digest === opts.except) continue;
		const theirs = paymentOf(k.proposal.payload.action, opts.self);
		if (theirs && samePayment(mine, theirs)) return k;
	}
	return null;
}

/** The amber line, before the link to the other proposal. */
export const LIKE_WAITING =
	"A proposal like this one is already waiting: sending both pays twice.";
