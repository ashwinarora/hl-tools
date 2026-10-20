/**
 * Every sentence of the refined Bento (C2), from the owner's review of
 * 2026-10-20: inclusive (not only teams that build), selling as well as
 * reassuring, and no more detail than a visitor needs to decide.
 * `copy.test.ts` holds each one to the Multisig's forbidden claims and words.
 */

export const HERO = {
	title: "Manage, test and build on Hyperliquid.",
	sub: "A multisig treasury manager, a faucet for testnet USDC and developer tools for Hyperliquid. Open source.",
} as const;

export const MULTISIG_TILE = {
	label: "Multisig",
	title: "Manage money together on Hyperliquid.",
	pitch:
		"The most seamless way to run a multisig on Hyperliquid. No more passing signatures around by hand: propose, sign and send in one place, with your co-signers live alongside you.",
	points: [
		"Keys stay in your wallets",
		"Every signature verified",
		"Open source",
	],
	create: "Create a new treasury",
	add: "Add an existing one",
	testnet:
		"Want to try it first? Everything works on testnet too: switch the network at the top of the page.",
	returning: "Go to your treasuries",
} as const;

export const FAUCET_TILE = {
	label: "Testnet Faucet Miner",
	problem:
		"Hyperliquid's testnet faucet gives each account 1,000 USDC, once, and never again. Need more? Mine as much as you like.",
	from: "mainnet USDC",
	to: "testnet USDC",
	points: ["No daily cap", "No IP limit", "Runs by itself"],
	fee: "The $1 is Hyperliquid's own fee for activating a new account. hl-tools keeps none of it.",
	open: "Open the faucet miner",
	how: "How it works",
} as const;

export const TOOLS_TILE = {
	label: "Developer tools",
	tag: "Read-only, no wallet",
	title: "Debug a Hyperliquid integration.",
	paste:
		"Paste a tx hash, an address, an error, a signed request or CoreWriter bytes.",
	placeholder: "Paste a hash, address, error or payload…",
	idle: "It opens the tool that reads it.",
	unknown: "Not recognised. Pick a tool below.",
} as const;

/** One line per tool under its name: what you would come to it with. */
export const TOOL_LINES: Record<string, string> = {
	assets: "Every ID a symbol maps to",
	signing: "Why a signature does not recover",
	corewriter: "Decode or build action bytes",
	trace: "Follow an EVM transaction",
	orders: "Explain an order error",
	websocket: "Watch a feed, spot the gaps",
	rpc: "What an RPC really supports",
	multisig: "Read any multi-sig account",
};

export const MULTISIG_BAND = {
	title: "How multisig works here",
	lead: "A treasury is one Hyperliquid account that several wallets control together. Any action needs the agreed number of them, and no single signer can move funds alone.",
	steps: [
		{
			title: "Propose",
			body: "Any signer writes down a payment, a stake or any other action.",
		},
		{
			title: "Sign",
			body: "Each co-signer approves it in their own wallet. Signing alone sends nothing.",
		},
		{
			title: "Send",
			body: "Once enough have signed, the finaliser sends it to Hyperliquid. Done.",
		},
	],
	actionsTitle: "What a treasury can do",
	soon: "Trading",
	soonTag: "Coming soon",
	whyTitle: "Why teams and friends use it",
	why: [
		{
			title: "Work together, live",
			body: "Proposals and signatures appear for every signer as they happen, with one “Needs you” list across all your treasuries.",
		},
		{
			title: "Send in one visit",
			body: "The finaliser adds the last signature and sends it. Nobody has to come back to finish.",
		},
		{
			title: "Staking and vaults in one move",
			body: "Ask for the end result. The form works out the steps, and everyone signs them together.",
		},
		{
			title: "Nothing slips through",
			body: "A signing log for every proposal and Hyperliquid's record of the treasury beside it, both ready as CSV.",
		},
		{
			title: "No account needed",
			body: "Sign in with your wallet to work live, or pass a proposal on as a link or a file.",
		},
		{
			title: "Open source",
			body: "Every line is public. Read it, run it yourself, or check it before you trust it with money.",
		},
	],
} as const;

export const FAUCET_BAND = {
	title: "More testnet USDC than one drip",
	lead: "The testnet faucet stops at 1,000 USDC per account, for good. The miner gets you as much as your tests need: choose an amount, press start, and it does the rest.",
	ask: "How much will you put in?",
	askHint: "Each $1 of mainnet USDC brings about 1,000 testnet USDC.",
	youGet: "You get",
	youPut: "You put in",
	back: "Back to you at the end",
	net: "Cost in all",
	wallets: (n: number) =>
		`${n} fresh ${n === 1 ? "wallet" : "wallets"}, one after another, all automatic.`,
	points: [
		{
			title: "No limits to wait out",
			body: "No daily cap, no IP limit, no queue to wait in. Need more tomorrow, or in five minutes? Run it again.",
		},
		{
			title: "A few clicks, then hands off",
			body: "Connect your wallet, choose the amount, approve once. A short run is done in about 30 seconds.",
		},
		{
			title: "The $1 is Hyperliquid's",
			body: "Every new account costs $1 of mainnet USDC to activate. That is how Hyperliquid works, and none of it goes to hl-tools.",
		},
	],
	needs: "Needs mainnet USDC in your Hyperliquid account to start.",
	open: "Open the faucet miner",
	how: "How it works, step by step",
} as const;
