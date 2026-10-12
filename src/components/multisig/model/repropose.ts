/**
 * "Re-propose" starts a new proposal from an old one: its action, finaliser
 * and label. That is only ever right for the same treasury on the same
 * network. An address can be a treasury on testnet and on mainnet at once
 * (rehearsing on testnet first makes exactly that), and a testnet rehearsal
 * must never arrive in a mainnet form filled in.
 */
import type { Network, Proposal } from "@hl-tools/core";
import { shortAddress } from "./parts";

export type ReproposeSource =
	| { readonly ok: true; readonly proposal: Proposal }
	| {
			readonly ok: false;
			readonly reason: "other-network" | "other-treasury";
			/** What the form says instead of filling itself in. */
			readonly text: string;
	  };

export function reproposeSource(
	old: Proposal,
	/** The form's network and treasury. */
	network: Network,
	treasury: string,
): ReproposeSource {
	if (old.payload.network !== network)
		return {
			ok: false,
			reason: "other-network",
			text: `That proposal is for ${old.payload.network} and this form is for ${network}. Nothing was copied from it: a proposal is never carried from one network to the other.`,
		};
	if (old.payload.multiSigUser.toLowerCase() !== treasury.toLowerCase())
		return {
			ok: false,
			reason: "other-treasury",
			text: `That proposal belongs to another treasury, ${shortAddress(old.payload.multiSigUser)}. Nothing was copied from it.`,
		};
	return { ok: true, proposal: old };
}
