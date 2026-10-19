/**
 * Outcome shares among a treasury's spot balances. Hyperliquid lists a share
 * of a HIP-4 outcome as a spot balance named "+<encoding>" ("+102251"); the
 * Overview shows those apart, under "Outcomes", named as Hyperliquid's own
 * lists name them (core `outcomeName`), and keeps them out of "Balances" and
 * of everything that counts or offers tokens to send.
 */
import {
	type OutcomeShare,
	outcomeName,
	outcomeShare,
	type RawOutcomeMeta,
	type RawOutcomeTemplate,
	type SpotBalanceRow,
	shownLine,
} from "@hl-tools/core";
import { isNonZero } from "./chain/columns";

/** The longest outcome name a row shows: the rest is in its hover. */
export const OUTCOME_TITLE_MAX = 140;

/** Hyperliquid's two lists an outcome's name is read from; null while not read. */
export interface OutcomeLists {
	readonly meta: RawOutcomeMeta | null;
	readonly templates: readonly RawOutcomeTemplate[] | null;
}

export interface OutcomeRow {
	readonly key: string;
	/** The balance's own name, "+102251". */
	readonly coin: string;
	readonly share: OutcomeShare;
	/** As Hyperliquid's lists name it, cut to `OUTCOME_TITLE_MAX`. */
	readonly title: string;
	/** The whole name, for the hover. */
	readonly fullTitle: string;
	readonly side: string;
	readonly total: string;
	readonly hold: string;
}

/** A spot balance that is an outcome share. */
export const isOutcomeShare = (b: { readonly coin: string }): boolean =>
	outcomeShare(b.coin) !== null;

/** What the treasury holds, split: tokens for "Balances", shares for "Outcomes". */
export function splitHoldings(
	spot: readonly SpotBalanceRow[] | null,
	lists: OutcomeLists | null,
): { readonly balances: SpotBalanceRow[]; readonly outcomes: OutcomeRow[] } {
	const balances: SpotBalanceRow[] = [];
	const outcomes: OutcomeRow[] = [];
	for (const b of spot ?? []) {
		if (!isNonZero(b.total)) continue;
		const share = outcomeShare(b.coin);
		if (!share) {
			balances.push(b);
			continue;
		}
		const name = outcomeName(
			share,
			lists?.meta ?? null,
			lists?.templates ?? null,
		);
		const fullTitle = shownLine(name.title);
		outcomes.push({
			key: b.key,
			coin: b.coin,
			share,
			title: shownLine(name.title, OUTCOME_TITLE_MAX),
			fullTitle,
			side: shownLine(name.side, 40),
			total: b.total,
			hold: b.hold,
		});
	}
	return { balances, outcomes };
}
