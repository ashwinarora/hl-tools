/**
 * The example treasury the home page's pictures show. Made up, addresses
 * included, and labelled as an example wherever it appears: nobody should
 * look one of these up and find someone's account.
 */
export const SAMPLE = {
	name: "Community treasury",
	network: "testnet" as const,
	address: "0x7a3d…e019",
	threshold: 2,
	signers: [
		{ name: "Alice", address: "0x1c4f…a902" },
		{ name: "Bob", address: "0x8be2…3d71" },
		{ name: "Carol", address: "0xd05a…6c18" },
	],
	balances: [
		{ label: "Perps account value", value: "48,250.00", unit: "USDC" },
		{ label: "Spot USDC", value: "12,400.00", unit: "USDC" },
		{ label: "Staked", value: "1,500", unit: "HYPE" },
	],
	proposal: {
		title: "Pay the meetup venue",
		kind: "Send",
		amount: "4,800",
		unit: "USDC",
		to: "0x4e91c27a85d3f06b19ae7c42d8f5b03e61a9c7d2",
		toName: "Harbour Hall",
		toShort: "0x4e91…c7d2",
		finaliser: "Alice",
		window: "can be sent until Fri 14:00 (47 h left)",
	},
	pending: [
		{ title: "Pay the meetup venue", what: "Send 4,800 USDC", signed: 1 },
		{
			title: "Stake idle HYPE",
			what: "Stake 500 HYPE",
			signed: 0,
		},
	],
} as const;

/** The section's title colour (`BRAND_TEXT` in the Multisig's kit), which the home page may not import. */
export const TEAL_TEXT = "text-[oklch(0.45_0.1_178)] dark:text-brand";
