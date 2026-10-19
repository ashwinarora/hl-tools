import type { Issue } from "@hl-tools/core";
import { RELAY_COPY } from "./copy";

/**
 * What a sign-in that did not finish says: one short line, shown as a toast.
 * The exact reason (the sharing service's own words, or the wallet's) is kept
 * for "Details", where it helps when someone reports a problem, and is never
 * the line itself.
 */
export interface SignInNotice {
	readonly tone: "error" | "info";
	readonly title: string;
	readonly details: string | null;
}

export function signInNotice(issue: Issue, cancelled: boolean): SignInNotice {
	// the signer said no in the wallet: nothing went wrong
	if (cancelled)
		return { tone: "info", title: RELAY_COPY.signInCancelled, details: null };
	// the one refusal with something to do about it: wait
	if (issue.code === "relay.signin_rate_limited")
		return { tone: "error", title: RELAY_COPY.signInTooMany, details: null };
	return {
		tone: "error",
		title: RELAY_COPY.signInFailed,
		details: issue.message || null,
	};
}
