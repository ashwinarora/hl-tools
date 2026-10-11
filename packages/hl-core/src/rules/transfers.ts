import { defineRuleSet, docs } from "./meta.ts";

export const TRANSFER_RULES = defineRuleSet({
	id: "transfers",
	title: "Account modes, transfers and the activation fee",
	version: "1.0.0",
	verifiedAt: "2026-10-11",
	summary:
		"An account is in one mode (`userAbstraction`): `default` and `disabled` keep a perps and a spot balance apart, `unifiedAccount` has one balance, reported as spot. A manual account can send with `usdSend` (perps to perps), `spotSend` (spot to spot) and `sendAsset` (any pocket to any pocket). A unified account can send only with `sendAsset` from the spot balance. The receiver's mode never refuses a send: a manual receiver gets it in the pocket named, a unified one in its single balance. Sending to an address never used costs 1 USDC once: `usdSend` takes it out of the amount, `spotSend` and `sendAsset` charge it on top. Sending to an address in use costs nothing.",
	sources: [
		docs("trading/account-abstraction-modes", "Account abstraction modes"),
		docs(
			"for-developers/api/exchange-endpoint",
			"Exchange endpoint (send asset, core USDC transfer, core spot transfer)",
		),
		docs("for-developers/api/activation-gas-fee", "Activation gas fee"),
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-10-11",
			note: "Measured on testnet (fixtures/multisig/send-modes.json, activation-fee.json): three sender modes against three receiver modes for six ways of sending, own-account moves, a token that is not the collateral, the same through a multi-sig; and sends to addresses never used, per method. Beyond the docs: `default` behaves as `disabled`; in unified mode `usdSend`, `spotSend` and `usdClassTransfer` are switched off and `sendAsset` works only from spot; what a unified account can send is its spot total minus `hold`; the 1 USDC for a new address comes out of the amount for `usdSend` and on top for the others, from spot USDC when what is left there covers it and from perps otherwise. Not measured: portfolio margin, the discontinued DEX abstraction, mainnet.",
		},
	],
});

/** Values of the `userAbstraction` info request. */
export const ACCOUNT_MODES = [
	"default",
	"disabled",
	"unifiedAccount",
	"portfolioMargin",
	"dexAbstraction",
] as const;
export type AccountModeName = (typeof ACCOUNT_MODES)[number];

/**
 * How an account's balances are kept, as far as sending is concerned.
 *   manual   a perps balance and a spot balance, moved between by hand
 *   unified  one balance, reported as the spot balance
 */
export type ModeKind = "manual" | "unified";

/**
 * What each mode is treated as, and whether that was measured. `default`
 * (never chose a mode) and `disabled` (chose manual) behaved the same in
 * every test. Portfolio margin needs an account too large for the lab and is
 * taken to send like a unified account (the docs describe both as one
 * balance); the DEX abstraction is discontinued and, per the docs, keeps USDC
 * in perps.
 */
export const MODE_KINDS: Readonly<
	Record<
		AccountModeName,
		{ readonly kind: ModeKind; readonly verified: boolean }
	>
> = {
	default: { kind: "manual", verified: true },
	disabled: { kind: "manual", verified: true },
	unifiedAccount: { kind: "unified", verified: true },
	portfolioMargin: { kind: "unified", verified: false },
	dexAbstraction: { kind: "manual", verified: false },
};

/** `sendAsset` names an account's balances by dex: the first perp dex is the empty string. */
export const PERPS_DEX = "";
export const SPOT_DEX = "spot";

/** The collateral of the first perp dex: the only token that moves into or out of it. */
export const COLLATERAL_TOKEN = "USDC";

/** Actions an account in unified mode is refused ("Action disabled when unified account is active"). */
export const UNIFIED_DISABLED_ACTIONS: readonly string[] = [
	"usdSend",
	"spotSend",
	"usdClassTransfer",
];

/** Charged once, in USDC, for the first transfer that names an address never used. */
export const ACTIVATION_FEE_USDC = "1";
