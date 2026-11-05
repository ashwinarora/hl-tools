/**
 * The numbers the docs quote, read from the protocol core's rule files so a
 * page never says something the app no longer does. A page writes
 * `<Fact id="activationFee" />`; the docs' remark step (`remark.ts`) puts the
 * text in its place, in the page, its search record and its Markdown copy.
 *
 * The rule files are imported by path, not through `@hl-tools/core` (which
 * pulls in viem), because this module also runs while the docs are compiled.
 * No React and no stores here. Numbers the app keeps outside the rule files
 * (the drafts' week, the signing window's two choices) are written out here
 * and held to the app's own constants by `docs.test.ts`.
 */
import { MAX_SIGNERS } from "../../../packages/hl-core/src/rules/multisig.ts";
import {
	MAX_PENDING_RETURNS,
	RETURN_QUEUE,
	STAKE_LOCKUP,
} from "../../../packages/hl-core/src/rules/staking.ts";
import {
	ACTIVATION_FEE_USDC,
	WITHDRAWAL_FEE_USDC,
} from "../../../packages/hl-core/src/rules/transfers.ts";
import {
	VAULT_LOCKUP,
	VAULT_MIN_DEPOSIT_USDC,
} from "../../../packages/hl-core/src/rules/vaults.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A wait in words: "1 day", "7 days", "2 minutes", "20 seconds". */
export function waitText(ms: number): string {
	const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
	if (ms % DAY === 0) return unit(ms / DAY, "day");
	if (ms % HOUR === 0) return unit(ms / HOUR, "hour");
	if (ms % MINUTE === 0) return unit(ms / MINUTE, "minute");
	return unit(Math.round(ms / 1000), "second");
}

/** How long a draft of a Multisig form is kept, in days (`DRAFT_MAX_AGE_MS`). */
export const DRAFT_DAYS = 7;
/** The two signing windows the propose form offers, in days. */
export const WINDOW_DAYS = { normal: 2, longer: 3 } as const;
/** A nickname's longest length (`NICKNAME_MAX`). */
export const NICKNAME_LENGTH = 40;

export const FACTS = {
	activationFee: `${ACTIVATION_FEE_USDC} USDC`,
	withdrawalFee: `${WITHDRAWAL_FEE_USDC} USDC`,
	maxSigners: String(MAX_SIGNERS),
	vaultMinDeposit: `${VAULT_MIN_DEPOSIT_USDC} USDC`,
	hlpLockup: waitText(VAULT_LOCKUP.hlp.mainnet.ms),
	hlpLockupTestnet: waitText(VAULT_LOCKUP.hlp.testnet.ms),
	vaultLockup: waitText(VAULT_LOCKUP.user.mainnet.ms),
	vaultLockupTestnet: waitText(VAULT_LOCKUP.user.testnet.ms),
	stakeLockup: waitText(STAKE_LOCKUP.mainnet.ms),
	stakeLockupTestnet: waitText(STAKE_LOCKUP.testnet.ms),
	returnWait: waitText(RETURN_QUEUE.mainnet.ms),
	returnWaitTestnet: waitText(RETURN_QUEUE.testnet.ms),
	maxPendingReturns: String(MAX_PENDING_RETURNS),
	draftKept: `${DRAFT_DAYS} days`,
	windowNormal: `${WINDOW_DAYS.normal} days`,
	windowLonger: `${WINDOW_DAYS.longer} days`,
	nicknameLength: `${NICKNAME_LENGTH} characters`,
} as const;

export type FactId = keyof typeof FACTS;

export function isFactId(id: string): id is FactId {
	return Object.hasOwn(FACTS, id);
}
