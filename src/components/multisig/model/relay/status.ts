/**
 * What the signed-in wallet may do to a shared proposal besides signing.
 * Mirrors the relay's rules so the page offers only what the relay accepts;
 * the relay enforces them regardless.
 */
import type { Address } from "@hl-tools/core";
import type { ProposalStatus } from "./rows";

export interface RelayActionsInput {
	/** The relay has this proposal. */
	readonly known: boolean;
	readonly status: ProposalStatus;
	readonly expired: boolean;
	readonly me: Address | null;
	readonly createdBy: Address;
	readonly finaliser: Address;
	/** Signers with a signature on the relay. */
	readonly relaySigners: readonly Address[];
}

export interface RelayActions {
	/** Remove your own signature (before submission only). */
	readonly takeBack: boolean;
	/** The proposer ends it for everyone. */
	readonly withdraw: boolean;
	/** The finaliser says it will not be submitted. */
	readonly decline: boolean;
}

const NONE: RelayActions = { takeBack: false, withdraw: false, decline: false };

export function relayActions(i: RelayActionsInput): RelayActions {
	if (!i.known || !i.me || i.status !== "open" || i.expired) return NONE;
	const proposer = i.me === i.createdBy;
	return {
		takeBack: i.relaySigners.includes(i.me),
		withdraw: proposer,
		// a proposer who is also the finaliser withdraws; "decline" would say the same thing twice
		decline: i.me === i.finaliser && !proposer,
	};
}
