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
	"relay.rate_limited": {
		message: "The relay's hourly limit for this was reached.",
		fix: "Wait a while and retry; links and files have no limit.",
	},
	"relay.busy": {
		message: "The relay is working through a backlog of lookups.",
		fix: "Try again in a few minutes.",
	},
	"relay.pending_cap": {
		message: "Too many proposals are pending.",
		fix: "Withdraw or finish some of them first.",
	},
	"relay.document_mismatch": {
		message:
			"The relay refused the document: it does not match the row it was sent with.",
		fix: "Reload the proposal and retry. If it persists, pass it on as a file.",
	},
	"relay.treasury_frozen": {
		message:
			"This account is no longer a multi-sig, so nothing new can be shared for it.",
	},
	"relay.finaliser_not_signer": {
		message:
			"The finaliser is not in the relay's copy of this treasury's signers.",
		fix: "Open the treasury page so the signer list is re-checked, or pick another finaliser.",
	},
	"relay.proposal_closed": {
		message: "This proposal is already closed on the relay.",
	},
	"relay.proposal_expired": {
		message: "This proposal's signing window has closed.",
		fix: "Re-propose it.",
	},
	"relay.nonce_too_far": {
		message: "The proposal's nonce is more than a day ahead.",
	},
	"relay.not_finaliser": {
		message: "Only the finaliser can do this.",
	},
	"relay.not_proposer": {
		message: "Only the wallet that proposed it can withdraw a proposal.",
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
	const o = e as { name?: unknown; message?: unknown; status?: unknown };
	const message = str(o.message) ?? "";
	return (
		o.name === "AuthRetryableFetchError" ||
		o.status === 0 ||
		/failed to fetch|fetch failed|networkerror|load failed|network request failed|econnrefused/i.test(
			message,
		)
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
			"The relay could not be reached. Links and files still work.",
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
			"The relay refused this: your wallet is not in its copy of this treasury's signers.",
			{
				fix: "If you were added recently, open the treasury page so the list is re-checked, then retry.",
			},
		);
	}
	if (code === "23505") {
		return issue("relay.duplicate", "info", "The relay already has this.");
	}
	if (code === "23503") {
		return issue(
			"relay.unknown_proposal",
			"error",
			"The relay does not have this proposal.",
			{ fix: "Share it first." },
		);
	}
	if (code === "23514" || code === "22P02" || code === "23502") {
		return issue(
			"relay.invalid",
			"error",
			"The relay refused the data as malformed.",
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
			`The relay did not accept the sign-in message: ${message}`,
			{ fix: "Check the clock on this device and retry." },
		);
	}
	return issue(
		"relay.error",
		"error",
		message
			? `The relay answered with an error: ${message}`
			: "The relay answered with an error.",
	);
}
