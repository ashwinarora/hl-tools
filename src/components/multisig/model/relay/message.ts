/**
 * The text behind "Copy message": something to paste into the team's own
 * chat. It names the treasury and links to the proposal, nothing else. Amounts
 * and destinations stay out of chat logs; the link shows them to signers only.
 */
import type { Address, Hex } from "@hl-tools/core";
import { shortAddress } from "../stage";
import { PROPOSAL_PATH } from "../transport";

export function proposalUrl(origin: string, digest: Hex): string {
	return `${origin.replace(/\/+$/, "")}${PROPOSAL_PATH}?digest=${digest}`;
}

export function coSignerMessage(i: {
	readonly origin: string;
	readonly treasury: Address;
	readonly digest: Hex;
}): string {
	return `A proposal for treasury ${shortAddress(i.treasury)} is waiting for signatures: ${proposalUrl(i.origin, i.digest)}`;
}
