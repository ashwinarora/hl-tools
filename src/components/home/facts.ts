/**
 * The routes the home page links to and the facts it states that belong to
 * the product rather than to the page's own sentences (`copy.ts`). Every
 * string here is held to the same rules as the page (`copy.test.ts`).
 */

/** Routes the home page links to, with the search they need. */
export const LINKS = {
	multisig: "/multisig",
	lookAtTreasury: { to: "/tools/multisig", search: { view: "account" } },
	glossary: "/multisig/glossary",
	faucet: "/faucet-miner",
	faucetHow: "/faucet-miner/how-to-use",
	changes: "/changes",
	repo: "https://github.com/ashwinarora/hl-tools",
} as const;

export const MULTISIG = {
	/** what a treasury can propose (`multisig/model/actions.ts`, the propose form's list) */
	actions: [
		"Send USDC",
		"Send a spot token",
		"Perps ↔ spot",
		"Withdraw to Arbitrum",
		"Stake HYPE",
		"Move to another validator",
		"Return to spot",
		"Deposit in a vault",
		"Withdraw from a vault",
		"Approve an API wallet",
		"Remove an API wallet",
		"Switch account mode",
		"Change signers",
		"Any other action as JSON",
	],
} as const;

/** The page's title and description, for the browser tab and for search. */
export const SITE = {
	title:
		"hl-tools — Multisig for Hyperliquid, a testnet USDC faucet and developer tools",
	description:
		"The most seamless way to run a multisig on Hyperliquid: propose, sign and send with your own wallets. Plus a faucet for testnet USDC and read-only developer tools. Open source.",
} as const;
