import type { Network } from "../network.ts";
import { defineRuleSet, docs } from "./meta.ts";

export const STAKING_RULES = defineRuleSet({
	id: "staking",
	title: "Staking HYPE",
	version: "1.0.0",
	verifiedAt: "2026-10-12",
	summary:
		"HYPE is in one of three places: the spot balance, the staking balance, or staked with a validator. Three user-signed actions move it: `cDeposit` (spot to the staking balance), `tokenDelegate` (stake with a validator, or unstake) and `cWithdraw` (the staking balance back to spot). Amounts are integers with 8 decimals. A stake cannot be removed for a while after it is made, and adding to a stake starts that wait again for all of it. A return to spot waits in a queue and then lands by itself; at most five can wait at once. Hyperliquid accepts a stake with a validator that is jailed or outside the working set, and such a stake earns nothing.",
	sources: [
		docs("hypercore/staking", "Staking"),
		docs(
			"for-developers/api/exchange-endpoint",
			"Exchange endpoint (staking deposit, staking withdrawal, delegation)",
		),
		docs(
			"for-developers/api/info-endpoint",
			"Info endpoint (delegator summary, delegations, history)",
		),
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-10-12",
			note: 'Measured on testnet through a multi-sig (fixtures/multisig/staking.json): all three actions go through the envelope, and the second step of a pair can follow the first within seconds (move in then stake, unstake then return, unstake from one validator then stake with another). Beyond the docs: adding to a stake restarts the lockup of everything staked with that validator; a stake removed completely leaves the list of delegations; a stake with a jailed or an inactive validator is accepted; the lockup ends sharply (refused 2 seconds before, accepted 1.5 seconds after); testnet\'s lockup is 2 minutes and its return queue 5 minutes. Seven refusals recorded word for word (rule set "errors" 1.8.0). From the docs and not measured: the mainnet lengths (1 day, 7 days). Not in the docs: the request that lists validators (`validatorSummaries`).',
		},
	],
});

/** The token that is staked, and the decimals of the integer the actions carry. */
export const STAKING_TOKEN = "HYPE";
export const HYPE_WEI_DECIMALS = 8;

/** The three actions that move HYPE between spot, the staking balance and a validator. */
export const STAKING_ACTION_TYPES = [
	"cDeposit",
	"tokenDelegate",
	"cWithdraw",
] as const;
export type StakingActionType = (typeof STAKING_ACTION_TYPES)[number];

export interface Wait {
	readonly ms: number;
	/** False when the length is taken from the docs and was not measured. */
	readonly measured: boolean;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * How long a stake cannot be removed after it was made or added to. An
 * account's own stakes carry the moment it ends (`lockedUntilTimestamp`), so
 * this is needed only to say what a new stake will be held for.
 */
export const STAKE_LOCKUP: Readonly<Record<Network, Wait>> = {
	mainnet: { ms: DAY, measured: false },
	testnet: { ms: 2 * MINUTE, measured: true },
};

/**
 * How long a return to spot waits before it lands. Hyperliquid reports how
 * many returns wait and their total, not when each lands: that is the moment
 * it was started plus this.
 */
export const RETURN_QUEUE: Readonly<Record<Network, Wait>> = {
	mainnet: { ms: 7 * DAY, measured: false },
	testnet: { ms: 5 * MINUTE, measured: true },
};

/** Returns to spot that can wait at once; one more is refused. */
export const MAX_PENDING_RETURNS = 5;

/**
 * How long after a lockup's end an unstake is held back: the end is sharp
 * and clocks differ (accepted 1.5 seconds after it on testnet).
 */
export const LOCKUP_MARGIN_MS = 5_000;
