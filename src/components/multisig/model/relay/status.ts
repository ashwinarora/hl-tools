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
	/** `me` is one of the treasury's signers now (a former multi-sig has none). */
	readonly isSigner: boolean;
	/** Signers with a no on the relay. */
	readonly objected: readonly Address[];
}

export interface RelayActions {
	/** Remove your own signature (before submission only). */
	readonly takeBack: boolean;
	/** The proposer ends it for everyone. Nobody else can end a proposal. */
	readonly withdraw: boolean;
	/** Say no: an objection the others see. The finaliser's too (there is no "decline" any more). */
	readonly sayNo: boolean;
	/** Take your own no back. */
	readonly takeBackNo: boolean;
}

const NONE: RelayActions = {
	takeBack: false,
	withdraw: false,
	sayNo: false,
	takeBackNo: false,
};

export function relayActions(i: RelayActionsInput): RelayActions {
	if (!i.known || !i.me || i.status !== "open" || i.expired) return NONE;
	const mine = i.objected.includes(i.me);
	return {
		takeBack: i.relaySigners.includes(i.me),
		withdraw: i.me === i.createdBy,
		// one position at a time: a no that stands is taken back, not said again
		sayNo: i.isSigner && !mine,
		takeBackNo: mine,
	};
}
