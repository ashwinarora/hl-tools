/**
 * The network a wallet has to be on to sign a code.
 *
 * Hyperliquid has two ways of signing. A send, a withdrawal or a stake is
 * typed data a wallet can show field by field, under an ordinary chain the
 * action names itself. A vault deposit belongs to the other family: what is
 * signed is a code that stands for the action, and its typed data says chain
 * 1337, which is no real network. Wallets refuse typed data for a chain they
 * are not on (measured in Rabby: "chainId should be same as current
 * chainId"), so a wallet has to hold a network with that number before it can
 * sign one.
 */
import {
	type Hex,
	L1_DOMAIN,
	type PlainObject,
	signingFamilyFor,
} from "@hl-tools/core";
import { chainIdToNumber, chainLabel } from "./chains";

/** The chain id inside every code signature: 1337. */
export const SIGNING_CHAIN_ID: number = L1_DOMAIN.chainId;
export const SIGNING_CHAIN_HEX = `0x${SIGNING_CHAIN_ID.toString(16)}` as Hex;

export interface SigningChain {
	readonly hex: Hex;
	readonly id: number;
	readonly label: string;
}

/**
 * The chain a wallet has to be on to give its signature on an action: the
 * one a readable action names for itself, the signing network for a code.
 * Null when a readable action names none this page can read. Worked out from
 * the action's own type, never from a proposal's unsigned part.
 */
export function signingChainOf(action: PlainObject): SigningChain | null {
	if (typeof action.type !== "string") return null;
	const family = signingFamilyFor(action.type);
	if (family === "l1")
		return {
			hex: SIGNING_CHAIN_HEX,
			id: SIGNING_CHAIN_ID,
			label: chainLabel(SIGNING_CHAIN_ID),
		};
	if (family !== "user-signed") return null;
	const id = chainIdToNumber(action.signatureChainId);
	return id === null
		? null
		: {
				hex: String(action.signatureChainId).toLowerCase() as Hex,
				id,
				label: chainLabel(id),
			};
}
