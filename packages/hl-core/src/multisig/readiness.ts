/**
 * Can this proposal be submitted right now? Judged against a policy (the
 * current on-chain signer set), the classified signatures and the clock.
 */
import type { Address } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { POLICY_STALE_MS } from "../rules/multisig.ts";
import { nonceWindow } from "./proposal.ts";
import type {
	ClassifiedSignature,
	LeaderStatus,
	Policy,
	Proposal,
	Readiness,
	ReadinessStatus,
} from "./types.ts";

/**
 * Whether the leader may submit. "needs-lookup" means the address is not a
 * signer but could be a *funded* API wallet of one, which only the info API
 * (`userRole` + a non-zero balance) can confirm.
 */
export function leaderStatus(p: Proposal, policy: Policy): LeaderStatus {
	const leader = p.payload.outerSigner;
	if (leader === p.payload.multiSigUser) return "not-authorized";
	if (policy.authorizedUsers.includes(leader)) return "authorized";
	return "needs-lookup";
}

export function readiness(
	p: Proposal,
	policy: Policy | null,
	classified: readonly ClassifiedSignature[],
	opts: { now?: number } = {},
): Readiness {
	const now = opts.now ?? Date.now();
	const window = nonceWindow(p.payload.nonce);
	const issues: Issue[] = [];
	const counted: Address[] = [];
	for (const c of classified) {
		if (
			c.status === "valid-authorized" &&
			c.recovered &&
			!counted.includes(c.recovered)
		) {
			counted.push(c.recovered);
		}
	}
	const base = {
		have: counted.length,
		counted,
		validFrom: window.validFrom,
		validUntil: window.validUntil,
	};
	if (!policy) {
		issues.push(
			issue(
				"policy.unknown",
				"warning",
				"No signer set was supplied; fetch userToMultiSigSigners to judge readiness.",
			),
		);
		return {
			...base,
			status: "unknown",
			need: null,
			missing: [],
			leader: null,
			issues,
		};
	}
	if (policy.authorizedUsers.length === 0 || policy.threshold < 1) {
		issues.push(
			issue(
				"policy.not_multisig",
				"error",
				`${p.payload.multiSigUser} is not a multi-sig user (as of ${new Date(policy.observedAt).toISOString()}); the chain answers "Invalid multi-sig user".`,
			),
		);
		return {
			...base,
			status: "not-multisig",
			need: null,
			missing: [],
			leader: null,
			issues,
		};
	}
	if (now - policy.observedAt > POLICY_STALE_MS) {
		issues.push(
			issue(
				"policy.stale",
				"warning",
				`The signer set was observed ${Math.round((now - policy.observedAt) / 60_000)} minutes ago; refresh it before trusting readiness.`,
			),
		);
	}
	const leader = leaderStatus(p, policy);
	if (leader === "not-authorized") {
		issues.push(
			issue(
				"leader.not_authorized",
				"error",
				"The leader is the multi-sig account itself; only an authorized user (or a funded API wallet of one) can submit.",
				{ path: "payload.outerSigner" },
			),
		);
	} else if (leader === "needs-lookup") {
		issues.push(
			issue(
				"leader.needs_lookup",
				"warning",
				`${p.payload.outerSigner} is not in the signer set. It can still lead if it is an API wallet of a signer *and* holds a deposit; check userRole and its balance.`,
				{ path: "payload.outerSigner" },
			),
		);
	}
	const missing = policy.authorizedUsers.filter((a) => !counted.includes(a));
	const need = policy.threshold;
	let status: ReadinessStatus;
	const expiryPassed =
		p.payload.expiresAfter !== null && now >= p.payload.expiresAfter;
	if (now >= window.validUntil || expiryPassed) {
		status = "expired";
		issues.push(
			issue(
				"proposal.expired",
				"error",
				expiryPassed
					? "expiresAfter has passed."
					: "The nonce window has closed.",
			),
		);
	} else if (now < window.validFrom) {
		status = "not-yet-valid";
	} else if (counted.length >= need && leader !== "not-authorized") {
		status = "ready";
	} else {
		status = "not-ready";
	}
	return { ...base, status, need, missing, leader, issues };
}
