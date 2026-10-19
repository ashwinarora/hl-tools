/**
 * What the proposal page says under an answer Hyperliquid refused with.
 *
 * The core's catalogue is written for the inspector, for someone holding the
 * envelope's bytes: it names actions by their type ("usdSend", "withdraw3").
 * Where it does, this section says the same in the words of its own forms.
 * An answer it does not know yet gets a plain sentence here in place of
 * advice about the code (audit F-010, F-011).
 */
import type { ErrorExplanation } from "@hl-tools/core";

export const UNKNOWN_REFUSAL =
	"This tool does not know that answer yet, so it cannot say more than Hyperliquid did.";

/** The catalogue's answers that name action types, in the section's words. */
export const PLAIN_REFUSALS: Readonly<Record<string, string>> = {
	"transfer-balance":
		"The amount is more than the treasury can move from its perps balance. Lower it, or move USDC from spot to perps first (Perps ↔ spot). Margin held by open positions cannot be moved.",
	"nonce-used":
		"A newer USDC send of this treasury was carried out first, and Hyperliquid takes its USDC sends and withdrawals only in that order. Look at Hyperliquid's record: if this action is there, nothing is left to do. If not, propose it again: it gets a new number, and every signer signs once more.",
	"unified-disabled":
		"The treasury is a unified account (one balance), where a USDC send from perps, a spot send and a move between perps and spot are switched off. Propose it again as Send USDC or Send spot token, which work in this mode.",
	"unified-spot-only":
		"The treasury is a unified account, where everything is held as spot, so a send has to come from spot. Propose it again with spot as the source.",
	"transfer-below-fee":
		"The destination was never used on Hyperliquid, and this kind of send pays the one-time 1 USDC fee out of the amount, so an amount of 1 USDC or less is refused. Send more than 1 USDC, or propose it as Send USDC, which charges the fee on top.",
	"withdrawal-below-fee":
		"The bridge keeps 1 USDC of every withdrawal as its fee, so a withdrawal has to be more than 1 USDC: the destination receives the amount less 1.",
	"bridge-withdraw":
		"The withdrawal could not be made: Hyperliquid answered this for an amount above what the account could move. Check the amount against the treasury's balance, the bridge's 1 USDC fee included.",
	"agent-missing":
		"The treasury has no API wallet of that name any more: it was removed or replaced already, it expired, or the name is spelled differently. Look at the treasury's API wallets again; if it is gone, there is nothing to remove.",
	"token-balance":
		"The amount is more than the balance it comes from can release now: for a unified account, its spot total less what positions and open orders hold. Lower the amount, or close positions and cancel orders first.",
	"self-transfer":
		"The destination is the treasury itself. To move USDC between its own perps and spot balances, propose Perps ↔ spot instead.",
	"send-invalid":
		"The send goes from the treasury into the same balance of itself, so nothing would move. Send to another account, or use Perps ↔ spot.",
	"evm-multisig":
		"The destination is one of HyperEVM's own addresses, which would move the token to HyperEVM, and Hyperliquid does not do that for a multi-sig account. Send to an account on Hyperliquid instead.",
	"token-invalid":
		"Only USDC moves into or out of a perps balance. Send this token from spot to spot; to move its value into perps, sell it for USDC first.",
	"deposit-funds":
		"The amount is more than the balance it is taken from can release now: HYPE in spot not on hold for a stake, or what the perps balance can withdraw for a vault deposit (the one balance of a unified account). Lower the amount; for a vault deposit from a manual account, move USDC from spot to perps first.",
};

export function refusalNote(e: ErrorExplanation): string {
	const plain = PLAIN_REFUSALS[e.id];
	if (plain) return plain;
	if (e.id !== "unknown") return `${e.cause} ${e.fix}`;
	// a transport note ("HTTP 502: …") is still worth reading
	const rest = e.cause.replace(/^Not in the error catalogue\.?\s*/, "");
	return rest ? `${rest} ${UNKNOWN_REFUSAL}` : UNKNOWN_REFUSAL;
}
