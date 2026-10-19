/**
 * The connected wallet is itself a treasury: someone converted an account and
 * came back with that account's own wallet. Its key cannot act for the
 * treasury on Hyperliquid, so nothing here can be signed with it. The section
 * says so the same way everywhere: a quiet tag in the wallet box, and one
 * sentence on that treasury's own pages. Nothing is blocked and nothing asks
 * for a click.
 */
import { joinParts, type Part, say, whoPart } from "./parts";

/** How long the answer "is this wallet a treasury?" is kept before asking again. */
export const SELF_STALE_MS = 5 * 60_000;

/** The wallet box's tag: "treasury account · 2 of 3". */
export function selfTag(policy: {
	readonly threshold: number;
	readonly authorizedUsers: readonly string[];
}): string {
	return `treasury account · ${policy.threshold} of ${policy.authorizedUsers.length}`;
}

/** The wallet is the account a page is about. */
export function isItself(
	wallet: string | null | undefined,
	treasury: string | null | undefined,
): boolean {
	return (
		!!wallet && !!treasury && wallet.toLowerCase() === treasury.toLowerCase()
	);
}

/**
 * The sentence for a treasury's own pages. The signers are named so the
 * reader knows which account to pick in the wallet; when they are not known
 * (not read yet), the sentence does without them.
 */
export function switchSentence(signers: readonly string[]): Part[] {
	if (signers.length === 0)
		return say`You are connected as the treasury itself. Switch to one of its signers in your wallet.`;
	const list = joinParts(
		signers.map((a) => [whoPart(a)]),
		", ",
	);
	return say`You are connected as the treasury itself. Switch to one of its signers: ${list}.`;
}
