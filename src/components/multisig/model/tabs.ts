/** The sections of a treasury page, and what older links to them mean now. */

export type TreasuryTab =
	| "overview"
	| "pending"
	| "staking"
	| "vaults"
	| "log"
	| "chain";

export const TREASURY_TABS: readonly TreasuryTab[] = [
	"overview",
	"pending",
	"staking",
	"vaults",
	"log",
	"chain",
];

/** Where a treasury page opens when its link names no section. */
export const DEFAULT_TREASURY_TAB: TreasuryTab = "overview";

/**
 * The section a link asks for; undefined when it asks for none that exists.
 * Links made before the sections were renamed still land where their content
 * went: "history" is the Signing log, "signers" is part of the Overview.
 */
export function treasuryTab(raw: unknown): TreasuryTab | undefined {
	if (raw === "history") return "log";
	if (raw === "signers") return "overview";
	return TREASURY_TABS.find((t) => t === raw);
}

/** What a treasury page follows besides what the account holds. */
export interface TabWants {
	/** The ledger with trades, orders and funding. */
	readonly history: boolean;
	/** The ledger: deposits, withdrawals and transfers. */
	readonly ledger: boolean;
	/** Whether ledger rows are looked up on Hyperliquid's explorer. */
	readonly lookUps: boolean;
	/** Whether accepted proposals are checked against Hyperliquid's record (the explorer's list of the treasury's newest transactions). */
	readonly record: boolean;
}

/**
 * What a treasury page follows live for the section on screen, `pending`
 * being how many of the treasury's proposals are waiting. A page asks for no
 * more than it shows:
 *   history  only on "On Hyperliquid"
 *   ledger   there, while a proposal waits (that is how the page notices one
 *            that was carried out without the tool), and on the Vaults tab,
 *            whose history is the ledger's vault rows
 *   lookUps  where a row's transaction is compared with a proposal: on "On
 *            Hyperliquid" and while a proposal waits. A vault row needs no
 *            look-up, so the Vaults tab by itself spends nothing of the
 *            explorer's daily allowance.
 *   record   on the Signing log, whose entries report submissions accepted:
 *            one read of the treasury's newest transactions, the one "On
 *            Hyperliquid" makes, and nothing from the daily allowance.
 */
export function tabWants(tab: TreasuryTab, pending: number): TabWants {
	const chain = tab === "chain";
	const waiting = pending > 0;
	return {
		history: chain,
		ledger: chain || waiting || tab === "vaults",
		lookUps: chain || waiting,
		record: tab === "log",
	};
}
