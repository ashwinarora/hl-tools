/**
 * After a conversion the account tells the relay "I am a treasury now", and
 * the relay looks that up on Hyperliquid itself. Its look-up can come a moment
 * too early (its request reaches another Hyperliquid node than the one that
 * took the conversion), so "not a multi-sig" is asked again, twice, before the
 * page gives up and leaves the registering to a signer. Anything else the
 * relay says is final. The conversion itself stands either way.
 */
import type { RequestRow } from "./rows";

/** How many times the account asks in all, and how long it waits in between. */
export const REGISTER = { attempts: 3, retryAfterMs: 2_500 } as const;

export type RegisterStep =
	/** The relay has not answered this request yet. */
	| { readonly kind: "wait" }
	/** Registered: its signers find it in their list. */
	| { readonly kind: "done" }
	/** Ask once more after `afterMs`. */
	| { readonly kind: "retry"; readonly afterMs: number }
	/** Given up: said on the page, a signer can add it. */
	| { readonly kind: "failed" };

/**
 * What to do next. `request` is the relay's row for the latest attempt (null
 * when the relay refused to take it at all, e.g. the hourly limit), `attempt`
 * its number, from 1.
 */
export function registerStep(
	request: Pick<RequestRow, "status" | "reason"> | null,
	attempt: number,
): RegisterStep {
	if (!request) return { kind: "failed" };
	if (request.status === "pending") return { kind: "wait" };
	if (request.status === "done") return { kind: "done" };
	const early =
		request.reason === "not_multisig" || request.status === "failed";
	return early && attempt < REGISTER.attempts
		? { kind: "retry", afterMs: REGISTER.retryAfterMs }
		: { kind: "failed" };
}
