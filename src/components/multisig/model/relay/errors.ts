/**
 * Relay failures as issues the page can show: the relay's own refusals (it
 * raises stable `relay.*` messages), Postgres and PostgREST codes, Supabase
 * Auth errors, and requests that never got an answer.
 */
import { type Issue, issue } from "@hl-tools/core";

interface Known {
	readonly message: string;
	readonly fix?: string;
	readonly severity?: Issue["severity"];
}

const REFUSALS: Record<string, Known> = {
	// The gate in front of the API (relay_live_sessions): the token is still
	// within its hour, but the session it was issued for has been ended.
	"relay.session_ended": {
		severity: "warning",
		message: "This wallet's sign-in here has ended.",
		fix: "Sign in again.",
	},
	"relay.rate_limited": {
		message: "The sharing service's hourly limit for this was reached.",
		fix: "Wait a while and retry; links and files have no limit.",
	},
	"relay.busy": {
		message: "The sharing service is working through a backlog of look-ups.",
		fix: "Try again in a few minutes.",
	},
	"relay.pending_cap": {
		message: "Too many proposals are pending.",
		fix: "Cancel or finish some of them first.",
	},
	"relay.document_mismatch": {
		message:
			"The sharing service refused the proposal: it does not match what was sent with it, or it is not a kind of proposal the service takes.",
		fix: "Reload the proposal and retry. If it persists, pass it on as a file.",
	},
	"relay.treasury_frozen": {
		message:
			"This account is no longer a multi-sig, so nothing new can be shared for it.",
	},
	"relay.finaliser_not_signer": {
		message:
			"The finaliser is not in the sharing service's copy of this treasury's signers.",
		fix: "Open the treasury page so the signer list is re-checked, or pick another finaliser.",
	},
	"relay.proposal_closed": {
		message: "This proposal is already closed.",
		fix: "Reload the page to see what closed it.",
	},
	"relay.proposal_expired": {
		message: "This proposal's signing window has closed.",
		fix: "Propose it again.",
	},
	"relay.nonce_too_far": {
		message:
			"This proposal is dated more than a day ahead, so it cannot be shared.",
		fix: "Create it again.",
	},
	"relay.not_finaliser": {
		message: "Only the finaliser can do this.",
		fix: "Connect the finaliser's wallet.",
	},
	"relay.report_ambiguous": {
		message:
			"Another proposal has the same action and number with a different finaliser, so Hyperliquid's record cannot tell which one was carried out.",
	},
	"relay.report_unnumbered": {
		message:
			"This kind of action carries no number of its own, so Hyperliquid's record of a transaction cannot say which proposal it came from.",
	},
	"relay.nickname_invalid": {
		message: "That nickname cannot be used.",
	},
	"relay.nickname_not_yours": {
		message: "Only that signer can choose the nickname of their own address.",
	},
	"relay.nickname_taken": {
		message: "Another address in this treasury already has that nickname.",
	},
	"relay.nickname_cap": {
		message: "A treasury keeps at most 500 nicknames.",
		fix: "Take away one that is no longer needed.",
	},
	"relay.mark_invalid": {
		message: "That could not be marked as read.",
		fix: "Reload the page and try again.",
	},
	// an older page offering the finaliser's "Decline", which the relay no longer takes
	"relay.decline_retired": {
		message:
			"A proposal is no longer declined. Its finaliser says no like any other signer, and only its proposer can end it.",
		fix: "Reload the page and use “Say no”.",
	},
	"relay.not_proposer": {
		message: "Only the wallet that proposed it can cancel a proposal.",
	},
};

/** Every fixed sentence above, for the copy check. */
export const REFUSAL_TEXTS: readonly string[] = Object.values(REFUSALS).flatMap(
	(k) => (k.fix ? [k.message, k.fix] : [k.message]),
);

const str = (v: unknown): string | null =>
	typeof v === "string" && v.length > 0 ? v : null;

/** A request that never reached the relay (offline, stack down, DNS). */
export function isUnreachable(e: unknown): boolean {
	if (!e || typeof e !== "object") return false;
	const o = e as {
		name?: unknown;
		message?: unknown;
		status?: unknown;
		code?: unknown;
		hint?: unknown;
	};
	const message = str(o.message) ?? "";
	return (
		o.name === "AuthRetryableFetchError" ||
		o.status === 0 ||
		// the data client wraps a failed fetch as an error with no code: a real answer always has one
		(o.code === "" && o.hint === "") ||
		/failed to fetch|fetch failed|networkerror|load failed|network request failed|econnrefused|unable to connect/i.test(
			message,
		)
	);
}

/** The stable message of the gate in front of the API (relay_live_sessions). */
export const SESSION_ENDED = "relay.session_ended";

/**
 * Whether an answer from the relay says "the session this token was issued
 * for has ended". Not an expired token (the client renews that by itself) and
 * not a refusal of one row: the wallet is no longer signed in.
 */
export function saysSessionEnded(status: number, body: unknown): boolean {
	return (
		status === 401 &&
		!!body &&
		typeof body === "object" &&
		(body as { message?: unknown }).message === SESSION_ENDED
	);
}

/** The relay already has that row: for a publish or a signature, as good as success. */
export function isDuplicate(e: unknown): boolean {
	return (
		!!e && typeof e === "object" && (e as { code?: unknown }).code === "23505"
	);
}

export function relayIssue(e: unknown): Issue {
	if (isUnreachable(e)) {
		return issue(
			"relay.unreachable",
			"warning",
			"The sharing service could not be reached. Links and files still work.",
		);
	}
	const o = (e && typeof e === "object" ? e : {}) as {
		code?: unknown;
		message?: unknown;
		details?: unknown;
		status?: unknown;
		name?: unknown;
	};
	const message = str(o.message) ?? (typeof e === "string" ? e : "");
	const code = str(o.code);

	const refusal = REFUSALS[message];
	if (refusal) {
		const detail = str(o.details);
		return issue(
			message,
			refusal.severity ?? "error",
			detail ?? refusal.message,
			refusal.fix ? { fix: refusal.fix } : {},
		);
	}
	if (code === "42501") {
		return issue(
			"relay.not_allowed",
			"error",
			"The sharing service refused this: your wallet is not in its copy of this treasury's signers.",
			{
				fix: "If you were added recently, open the treasury page so the list is re-checked, then retry.",
			},
		);
	}
	if (code === "23505") {
		return issue(
			"relay.duplicate",
			"info",
			"The sharing service already has this.",
		);
	}
	if (code === "23503") {
		return issue(
			"relay.unknown_proposal",
			"error",
			"The sharing service does not have this proposal.",
			{ fix: "Share it first." },
		);
	}
	if (code === "23514" || code === "22P02" || code === "23502") {
		return issue(
			"relay.invalid",
			"error",
			"The sharing service refused the data as malformed.",
			{ fix: "Reload the page and try again." },
		);
	}
	if (code === "PGRST301" || code === "PGRST303" || o.status === 401) {
		return issue(
			"relay.session_expired",
			"warning",
			"Your sign-in has expired.",
			{ fix: "Sign in again." },
		);
	}

	// Supabase Auth
	if (o.status === 429 || code === "over_request_rate_limit") {
		return issue(
			"relay.signin_rate_limited",
			"warning",
			"Too many sign-ins from this network in the last few minutes.",
			{ fix: "Wait five minutes and retry." },
		);
	}
	if (/siwe|ethereum message|signature does not match/i.test(message)) {
		return issue(
			"relay.signin_rejected",
			"error",
			`The sharing service did not accept the sign-in message: ${message}`,
			{
				fix: "Check that this device's date and time are set automatically, then sign in again.",
			},
		);
	}
	return issue(
		"relay.error",
		"error",
		message
			? `The sharing service answered with an error: ${message}`
			: "The sharing service answered with an error.",
		{ fix: "Try again. Links and files still work." },
	);
}
