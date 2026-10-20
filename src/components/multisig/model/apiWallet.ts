/**
 * What an API wallet can do with a treasury, in the words every screen uses.
 * Measured on testnet (core rule set `multisig`, facts `agent-bypass` and
 * `agent-reach`; fixtures/multisig/agent-reach.json): it trades, and with no
 * signer it can also put the treasury's money into a vault and move it
 * between the treasury's own balances, so money kept in spot is within its
 * reach. It cannot send to another account or withdraw.
 */
export const API_WALLET_CAN =
	"trade with everything the treasury holds and move it into vaults";
export const API_WALLET_CANNOT =
	"It cannot send funds to another account or withdraw them.";

/** Under a treasury's list of API wallets. */
export const API_WALLET_SENTENCE = `An API wallet acts for this treasury without the signers: it can ${API_WALLET_CAN}. ${API_WALLET_CANNOT}`;

/** The same, once the account is no longer a multi-sig: there are no signers to act without. */
export const API_WALLET_FORMER =
	"An API wallet still acts for this account: it can trade with everything the account holds and move it into vaults. It cannot send funds to another account or withdraw them.";

/** In the form that proposes one, after the protocol's own sentence. */
/**
 * The core's fact `agent-bypass` in the section's words: no "envelope", and
 * "Convert back" for a revert (audit F-084; the inspector keeps the core's).
 */
export const API_WALLET_ACTS =
	"An API wallet approved by the signers acts for the treasury directly, with no proposal and no signers, and it keeps acting after a Convert back. It can trade with everything the treasury holds and move it into vaults; it cannot send it to another account or withdraw it.";

export const API_WALLET_PROPOSE =
	"Whoever holds this key can do all of that on their own, with the perps and the spot balance alike.";

/** The label of the row that lists them on the treasury strip. */
export const API_WALLET_ROW = "API wallets (act without the signers)";
