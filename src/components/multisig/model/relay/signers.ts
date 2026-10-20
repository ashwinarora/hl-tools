/**
 * The live signer set (what the chain says now) against the relay's stored
 * copy. A difference is what makes a signer's browser ask for a re-check.
 */
import type { Address, Policy } from "@hl-tools/core";

export interface StoredPolicy {
	readonly signers: readonly Address[];
	readonly threshold: number;
	readonly frozen: boolean;
}

export interface SignerDiff {
	readonly same: boolean;
	readonly added: readonly Address[];
	readonly removed: readonly Address[];
	readonly thresholdChanged: boolean;
	/** The chain no longer reports a signer set, and the copy does not know yet. */
	readonly noLongerMultisig: boolean;
	/** The copy is frozen but the chain reports a signer set again. */
	readonly multisigAgain: boolean;
}

/**
 * What a page knows about the live signer set, in the shape `compareSigners`
 * takes. "The chain says this account is not a multi-sig" is an answer, and a
 * different one from "not known yet": the first must reach the relay (it is
 * how a treasury gets frozen), the second must not.
 */
export function livePolicy(
	isMultiSig: boolean | null,
	policy: Policy | null,
	observedAt = 0,
): Policy | null {
	if (isMultiSig === null) return null;
	if (!isMultiSig) return { authorizedUsers: [], threshold: 0, observedAt };
	return policy;
}

/**
 * `live` is null while it is unknown (still loading, or the read failed): no
 * verdict then. An empty signer list means "not a multi-sig".
 */
export function compareSigners(
	live: Policy | null | undefined,
	stored: StoredPolicy,
): SignerDiff | null {
	if (!live) return null;
	const isMultisig = live.authorizedUsers.length > 0;
	if (!isMultisig) {
		return {
			same: stored.frozen,
			added: [],
			removed: [],
			thresholdChanged: false,
			noLongerMultisig: !stored.frozen,
			multisigAgain: false,
		};
	}
	const added = live.authorizedUsers.filter((a) => !stored.signers.includes(a));
	const removed = stored.signers.filter(
		(a) => !live.authorizedUsers.includes(a),
	);
	const thresholdChanged = live.threshold !== stored.threshold;
	return {
		same:
			!stored.frozen &&
			added.length === 0 &&
			removed.length === 0 &&
			!thresholdChanged,
		added,
		removed,
		thresholdChanged,
		noLongerMultisig: false,
		multisigAgain: stored.frozen,
	};
}

/**
 * The relay answers a re-check asked within 30 s of its last lookup with
 * "that answer stands", so a page that still sees a difference asks again a
 * little later than that, and keeps asking while the difference lasts. A
 * handful of times only: if the relay cannot resolve it (it cannot reach
 * Hyperliquid, say), asking forever would just spend the wallet's hourly
 * allowance.
 */
export const RECHECK_EVERY_MS = 35_000;
export const RECHECK_MAX = 6;

/**
 * How long a page that sees a difference waits before asking the relay to
 * look again: 0 for the first time, then `RECHECK_EVERY_MS` after the
 * previous ask. Null once it has asked `RECHECK_MAX` times for this
 * difference.
 */
export function nextRecheck(
	lastAskedAt: number | null,
	asked: number,
	now: number,
): number | null {
	if (asked >= RECHECK_MAX) return null;
	if (lastAskedAt === null) return 0;
	return Math.max(0, lastAskedAt + RECHECK_EVERY_MS - now);
}

/** What a page that sees a difference knows about its asks for a re-check. */
export interface RecheckState {
	/** The relay is looking the account up now. */
	readonly checking: boolean;
	/** Why the last ask did not get through, in the relay's words; null when it did. */
	readonly refused: string | null;
	/** Asked `RECHECK_MAX` times, and the difference is still there. */
	readonly gaveUp: boolean;
}

/**
 * What is being done about the difference. An ask that was refused, or a
 * difference that outlasts every ask, is said: "has been asked to look again"
 * is true only of an ask that got through and is still being answered.
 */
export function recheckLine(s: RecheckState): string {
	if (s.checking)
		return "The hl-tools server is checking this treasury on Hyperliquid now…";
	if (s.refused !== null)
		return `The copy could not be brought up to date. ${s.refused}`;
	if (s.gaveUp)
		return `The hl-tools server was asked ${RECHECK_MAX} times and its copy of the signers still differs from Hyperliquid's. It may not be reaching Hyperliquid right now; try again later.`;
	return "The hl-tools server has been asked to look again; this page updates by itself.";
}

/** A page may ask by hand once the asking by itself has stopped or was refused. */
export const mayAskAgain = (s: RecheckState): boolean =>
	!s.checking && (s.refused !== null || s.gaveUp);

/**
 * What the difference means for the counts on a treasury's page: its lists
 * are made from the copy, a proposal's own page judges against the live list.
 */
export const COUNTED_MEANWHILE =
	"Until the two match, the lists on this page count signatures against the copy. A proposal's own page counts them against Hyperliquid's list, as Hyperliquid does.";

/** Why the relay finished a request without doing what was asked, by its `reason`. */
export const REQUEST_REASONS: Readonly<Record<string, string>> = {
	not_a_signer:
		"The hl-tools server looked the account up on Hyperliquid, and your wallet is not one of its signers.",
	not_multisig:
		"The hl-tools server looked the account up on Hyperliquid, and it is not a treasury there.",
	lookup_failed:
		"The hl-tools server could not reach Hyperliquid for this look-up. Try again in a minute.",
};

/**
 * What the relay said of a request it finished without success; null for one
 * still pending, one that was done, or none at all.
 */
export function requestRefusal(
	request: { readonly status: string; readonly reason: string | null } | null,
): string | null {
	if (!request) return null;
	if (request.status !== "rejected" && request.status !== "failed") return null;
	return (
		REQUEST_REASONS[request.reason ?? ""] ??
		"The hl-tools server refused the request."
	);
}
