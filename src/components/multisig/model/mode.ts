/**
 * The treasury's account mode in words, for the screens. The rules are the
 * core's (`accountMode`, rules/transfers): manual and unified were measured,
 * the other two are taken from Hyperliquid's documentation and said to be so.
 */
import type { AccountMode } from "@hl-tools/core";

export interface ModeLabel {
	/** A few words for a tag. */
	readonly tag: string;
	/** One sentence saying what it means for the money. */
	readonly text: string;
	/** Something the reader should know is uncertain. */
	readonly caution: boolean;
}

export function modeLabel(mode: AccountMode): ModeLabel {
	if (mode.kind === "unknown")
		return {
			tag: "unknown mode",
			text: `Hyperliquid reports the mode "${mode.raw}", which this page has no rule for. Sends are offered as for a manual account, and may be refused.`,
			caution: true,
		};
	if (mode.kind === "unified")
		return mode.verified
			? {
					tag: "unified account",
					text: "One balance for perps and spot. Payments are taken from it.",
					caution: false,
				}
			: {
					tag: "portfolio margin",
					text: "Treated here like a unified account, with one balance. This mode was not tested with this tool.",
					caution: true,
				};
	return mode.verified
		? {
				tag: "manual account",
				text: "Perps and spot are separate balances. A payment says which one it is taken from.",
				caution: false,
			}
		: {
				tag: "DEX abstraction",
				text: "A discontinued mode, treated here like a manual account. It was not tested with this tool.",
				caution: true,
			};
}
