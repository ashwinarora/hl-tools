/**
 * The treasury's account mode in words, for the screens. The rules are the
 * core's (`accountMode`, rules/transfers): manual and unified were measured,
 * the other two are taken from Hyperliquid's documentation and said to be so.
 */
import { type AccountMode, Decimal } from "@hl-tools/core";
import { spotAvailable } from "./send";

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

/**
 * Which balance figures a treasury's screens show. A manual account has two
 * balances, and the perps one says how much of it is free. A unified account
 * has one, reported with the spot balances: its USDC total, of which open
 * positions and resting orders hold a part, and what can be sent is exactly
 * the rest (measured: one cent more is refused). A figure is null while it
 * has not been read.
 */
export type BalanceView =
	| {
			readonly kind: "one";
			readonly balance: string | null;
			readonly movable: string | null;
			readonly inUse: string | null;
	  }
	| {
			readonly kind: "two";
			readonly perpsValue: string | null;
			readonly perpsMovable: string | null;
			readonly spotUsdc: string | null;
	  };

/** A figure as Hyperliquid wrote it, without trailing zeros: "0.0" and "8" read alike. */
const plain = (v: string | null): string | null =>
	v === null ? null : (Decimal.tryParse(v)?.toString() ?? v);

export function balanceView(
	mode: AccountMode | null,
	perp: {
		readonly accountValue: string;
		readonly withdrawable: string;
	} | null,
	spot:
		| readonly {
				readonly coin: string;
				readonly total: string;
				readonly hold?: string;
		  }[]
		| null,
): BalanceView {
	const usdc = spot ? (spot.find((b) => b.coin === "USDC") ?? null) : null;
	const total = spot ? (usdc?.total ?? "0") : null;
	// a mode that could not be read, or that this page has no rule for, is shown
	// the way Hyperliquid reports any account: perps and spot apart
	if (mode?.kind !== "unified")
		return {
			kind: "two",
			perpsValue: plain(perp?.accountValue ?? null),
			perpsMovable: plain(perp?.withdrawable ?? null),
			spotUsdc: plain(total),
		};
	return {
		kind: "one",
		balance: plain(total),
		movable: plain(spotAvailable(spot, "USDC")),
		inUse: plain(spot ? (usdc?.hold ?? "0") : null),
	};
}
/**
 * Beside the balances while the account mode could not be read: they are laid
 * out as Hyperliquid reports any account, which for a unified treasury puts
 * its whole balance under spot (audit F-060). Unread means warn, not guess.
 */
export const MODE_UNREAD =
	"The account mode could not be read from Hyperliquid, so the balances are laid out as for a manual account. If this treasury is a unified account, its whole balance is the spot figure.";
