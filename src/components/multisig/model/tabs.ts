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
