/**
 * Health assessment of a multi-sig account from what the info API says about
 * it. Pure: every input is passed in (observed elsewhere), nothing is fetched.
 */
import type { UserRole } from "../adapter/info.ts";
import type { Address } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { MAX_SIGNERS } from "../rules/multisig.ts";
import type { Policy } from "./types.ts";

export interface AgentInput {
	readonly name: string;
	readonly address: string;
	readonly validUntil: number;
}

export interface AccountInput {
	readonly address: Address;
	/** `userToMultiSigSigners`: null when not a multi-sig user. */
	readonly policy: Policy | null;
	/** `userRole`, fetched only for non-multisig addresses; null when not fetched. */
	readonly role: UserRole | null;
	/** `extraAgents`; null when the call failed. */
	readonly agents: readonly AgentInput[] | null;
	/** Per-signer policy: a Policy = nested multi-sig, null = plain user, undefined = not checked. */
	readonly signerPolicies: Readonly<Record<string, Policy | null | undefined>>;
	/** HyperEVM balance of the same address in wei; null = not checked. */
	readonly evmBalanceWei: bigint | null;
	readonly now: number;
}

export interface SignerAssessment {
	readonly address: Address;
	readonly nested: boolean | "unchecked";
}

export interface AgentAssessment extends AgentInput {
	readonly address: Address;
	readonly expired: boolean;
}

export interface AccountAssessment {
	readonly address: Address;
	readonly isMultiSig: boolean;
	readonly threshold: number | null;
	readonly signers: readonly SignerAssessment[];
	readonly agents: readonly AgentAssessment[];
	/** Plain-language account state: "2 of 3 must sign" or the role explanation. */
	readonly summary: string;
	readonly flags: readonly Issue[];
}

function roleSummary(role: UserRole | null): string {
	if (!role) return "Not a multi-sig user.";
	switch (role.role) {
		case "user":
			return "A normal user: its own key signs every action. It may have been a multi-sig user before (load recent actions to see conversions).";
		case "agent":
			return `An API wallet (agent) of ${role.data.user}. Agents sign L1 actions for their master and cannot be multi-sig users or inner signers.`;
		case "vault":
			return "A vault. Vaults are driven by their leader's account; multi-sig applies to the leader, not the vault address.";
		case "subAccount":
			return `A sub-account of ${role.data.master}. Sub-accounts are driven by their master; multi-sig applies to the master.`;
		case "missing":
			return "Never seen on Hyperliquid: no deposit has ever reached this address, so it cannot be a signer or a multi-sig user yet.";
	}
}

export function assessAccount(input: AccountInput): AccountAssessment {
	const flags: Issue[] = [];
	const address = input.address.toLowerCase() as Address;
	const agents: AgentAssessment[] = (input.agents ?? []).map((a) => ({
		...a,
		address: a.address.toLowerCase() as Address,
		expired: a.validUntil <= input.now,
	}));
	if (input.agents === null) {
		flags.push(
			issue(
				"account.agents_unknown",
				"warning",
				"Approved API wallets could not be loaded; an agent would trade for this account without the multi-sig.",
			),
		);
	}
	const live = agents.filter((a) => !a.expired);
	if (live.length) {
		flags.push(
			issue(
				"account.agents_bypass",
				"warning",
				`${live.length} approved API wallet${live.length > 1 ? "s" : ""} (${live.map((a) => a.name || "main").join(", ")}) can place and cancel orders for this account without any multi-sig signatures. Agents cannot move funds, and they survive a revert to a normal user.`,
				{
					fix: "Treat every approveAgent proposal as 'make trading single-key'; revoke agents you do not recognise.",
				},
			),
		);
	}
	for (const a of agents.filter((x) => x.expired)) {
		flags.push(
			issue(
				"account.agent_expired",
				"info",
				`API wallet ${a.name || "main"} (${a.address}) expired on ${new Date(a.validUntil).toISOString()} and can no longer sign.`,
			),
		);
	}
	if (input.evmBalanceWei === null) {
		flags.push(
			issue(
				"evm.unchecked",
				"info",
				"HyperEVM balance not checked. The original key keeps full control of this address on HyperEVM even after conversion, and CoreWriter does not work for multi-sig users.",
			),
		);
	} else if (input.evmBalanceWei > 0n) {
		flags.push(
			issue(
				"account.evm_funds_under_dead_key",
				"warning",
				`This address holds ${formatHype(input.evmBalanceWei)} HYPE on HyperEVM. Multi-sig does not protect it: the original private key still controls the HyperEVM side.`,
				{
					fix: "Move HyperEVM funds to an address whose key is still safely held, or to Core.",
				},
			),
		);
	}

	const policy = input.policy;
	if (!policy || policy.authorizedUsers.length === 0 || policy.threshold < 1) {
		flags.unshift(
			issue("account.not_multisig", "info", roleSummary(input.role)),
		);
		return {
			address,
			isMultiSig: false,
			threshold: null,
			signers: [],
			agents,
			summary: roleSummary(input.role),
			flags,
		};
	}
	const signers: SignerAssessment[] = policy.authorizedUsers.map((s) => {
		const p = input.signerPolicies[s];
		return {
			address: s,
			nested:
				p === undefined
					? "unchecked"
					: p !== null && p.authorizedUsers.length > 0,
		};
	});
	const n = signers.length;
	const t = policy.threshold;
	const summary = `${t} of ${n} authorized user${n > 1 ? "s" : ""} must sign every action.`;
	if (n > 1 && t === n) {
		flags.push(
			issue(
				"lockout.all_keys_required",
				"warning",
				`All ${n} signers are required: losing any one key locks the account forever (there is no recovery path).`,
				{
					fix: "Lower the threshold or add a spare signer while every key is still available.",
				},
			),
		);
	}
	if (t === 1 && n > 1) {
		flags.push(
			issue(
				"account.single_signer",
				"info",
				`Any one of the ${n} signers can act alone (threshold 1); the multi-sig adds redundancy, not control.`,
			),
		);
	}
	if (n >= MAX_SIGNERS) {
		flags.push(
			issue(
				"signers.at_max",
				"info",
				`The signer set is at the chain's maximum of ${MAX_SIGNERS}; a signer must be removed before another can be added.`,
			),
		);
	}
	const nested = signers.filter((s) => s.nested === true);
	if (nested.length) {
		flags.push(
			issue(
				"signers.nested",
				"warning",
				`${nested.map((s) => s.address).join(", ")} ${nested.length > 1 ? "are themselves" : "is itself"} a multi-sig user. Nesting is nominal: that signer's own raw key signs and leads here, and its own threshold is not consulted.`,
			),
		);
	}
	if (signers.some((s) => s.nested === "unchecked")) {
		flags.push(
			issue(
				"signers.nested_unchecked",
				"info",
				"Signers were not checked for being multi-sig users themselves (one userToMultiSigSigners call per signer).",
			),
		);
	}
	return {
		address,
		isMultiSig: true,
		threshold: t,
		signers,
		agents,
		summary,
		flags,
	};
}

/** Wei → HYPE with up to 6 decimals, trailing zeros trimmed. */
export function formatHype(wei: bigint): string {
	const whole = wei / 1_000_000_000_000_000_000n;
	const frac = (wei % 1_000_000_000_000_000_000n)
		.toString()
		.padStart(18, "0")
		.slice(0, 6)
		.replace(/0+$/, "");
	return frac ? `${whole}.${frac}` : whole.toString();
}
