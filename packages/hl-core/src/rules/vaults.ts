import type { Network } from "../network.ts";
import { defineRuleSet, docs } from "./meta.ts";
import type { Wait } from "./staking.ts";

export const VAULT_RULES = defineRuleSet({
	id: "vaults",
	title: "Vault deposits and withdrawals",
	version: "1.0.0",
	verifiedAt: "2026-10-13",
	summary:
		"A vault is an account a leader trades with; others deposit USDC into it and share its profit and loss. One action moves the money both ways: `vaultTransfer` with `isDeposit` and the amount as an integer of millionths of a dollar. It is an L1 action: it is signed as a hash under chain 1337, and it carries no number of its own. A deposit is taken from the perps balance (from the one balance of a unified account) and has to be at least 5 USDC; it cannot be withdrawn for a while, and adding to a deposit starts that wait again for all of it. A withdrawal arrives in the perps balance (the one balance of a unified account), less the leader's share of the profit.",
	sources: [
		docs("hypercore/vaults/hypercore-vaults-legacy", "HyperCore vaults"),
		docs(
			"hypercore/vaults/for-vault-depositors-legacy",
			"For vault depositors",
		),
		docs("hypercore/vaults/protocol-vaults", "Protocol vaults (HLP)"),
		docs(
			"for-developers/api/exchange-endpoint",
			"Exchange endpoint (deposit or withdraw from a vault)",
		),
		docs(
			"for-developers/api/info-endpoint",
			"Info endpoint (vault details, a user's vault deposits)",
		),
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-10-13",
			note: 'Measured on testnet through 2-of-3 multi-sigs, the inner signatures made as L1 hashes (fixtures/multisig/vaults.json, 17 requests). A deposit takes from what the perps balance can release, not from the account value and not from spot: in a manual account with the USDC in spot it is refused until some is moved to perps; in a unified account it takes from the one balance. Recorded word for word: "Vault deposits must be at least $5.", "Vault is closed.", "This vault does not accept deposits.", "Vault not registered: <address>", "Insufficient funds available to deposit." (the same text a staking deposit gets), "Cannot withdraw during lockup period after depositing." and "Insufficient vault equity for withdrawal". The HLP vault locked a deposit for exactly 96 hours and a user vault for 20 seconds on testnet; adding to a deposit moved the lockup of all of it. A withdrawal after the lockup came back less the leader\'s commission (a tenth of the profit in the vault used), and withdrawing everything left a fraction of a cent behind. Ledger rows: `vaultDeposit {vault, usdc}` and `vaultWithdraw {vault, user, requestedUsd, commission, closingCost, basis, netWithdrawnUsd}`. From the docs and not measured: a user vault\'s lockup on mainnet (1 day), HLP\'s on mainnet (4 days). Not measured: which refusal Hyperliquid names when two apply at once.',
		},
	],
});

/** The one action that moves USDC into and out of a vault. */
export const VAULT_ACTION_TYPE = "vaultTransfer";

/** The action carries dollars as an integer with this many decimals: 5000000 is 5 USDC. */
export const VAULT_USD_DECIMALS = 6;

/** The least a deposit can be, in USDC ("Vault deposits must be at least $5."). */
export const VAULT_MIN_DEPOSIT_USDC = "5";

/** Hyperliquid's own vault, the Hyperliquidity Provider. */
export const HLP_VAULT: Readonly<Record<Network, `0x${string}`>> = {
	mainnet: "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303",
	testnet: "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0",
};

const SECOND = 1_000;
const DAY = 24 * 60 * 60 * SECOND;

/**
 * How long a deposit cannot be withdrawn after it was made or added to. An
 * account's own deposits carry the moment it ends (`lockedUntilTimestamp`),
 * so this is needed only to say what a new deposit will be held for.
 */
export const VAULT_LOCKUP: {
	readonly hlp: Readonly<Record<Network, Wait>>;
	readonly user: Readonly<Record<Network, Wait>>;
} = {
	hlp: {
		mainnet: { ms: 4 * DAY, measured: false },
		testnet: { ms: 4 * DAY, measured: true },
	},
	user: {
		mainnet: { ms: DAY, measured: false },
		testnet: { ms: 20 * SECOND, measured: true },
	},
};

/**
 * How long after a lockup's end a withdrawal is held back: clocks differ,
 * and a refusal uses up the proposal.
 */
export const VAULT_LOCKUP_MARGIN_MS = 5_000;
