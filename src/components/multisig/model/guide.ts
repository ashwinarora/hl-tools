/**
 * What the section says to someone new: the first-run card, the banner on a
 * first proposal to sign, the two ways in without a wallet, and the
 * glossary. Every sentence here is checked against the forbidden claims and
 * the jargon list (`guide.test.ts`); the glossary alone names an expert's
 * word, beside the plain one.
 */

/** One numbered step of the first-run card. */
export interface WalkStep {
	readonly title: string;
	readonly body: string;
}

export const FIRST_RUN = {
	title: "How this works",
	hide: "Hide this",
	/** For a build where nobody signs in: proposals travel by link or file only. */
	steps: (sharing: boolean): readonly WalkStep[] => [
		{
			title: "What this is",
			body: "A treasury is a Hyperliquid account that several wallets control together. Every action needs the agreed number of them.",
		},
		{
			title: "Get a treasury",
			body: "Create one from your wallet's own account, or add one you are already a signer of. Try it on testnet first: switch in the header.",
		},
		{
			title: "How a payment works",
			body: "Propose: any signer writes it down. Sign: each signer approves it in their wallet, and nothing is sent. Send: once enough have signed, the finaliser sends it to Hyperliquid, and it is final once accepted.",
		},
		sharing
			? {
					title: "Sharing",
					body: "Sign in to see your co-signers' proposals here, or pass proposals on by link or file. Signing in approves nothing and cannot move funds.",
				}
			: {
					title: "Sharing",
					body: "Pass proposals on to your co-signers by link or file. Each one opens here, in their own browser.",
				},
		{
			title: "What your wallet will show",
			body: "Before every signature, check the treasury, the destination and the amount in your wallet. For a vault step your wallet shows a code instead: compare it with the code on the page.",
		},
		{
			title: "Then",
			body: sharing
				? "Your inbox lists what needs you. Start with the oldest."
				: "Open a proposal from its link or file, check it, and sign.",
		},
	],
	glossary: "Words used here",
} as const;

/** One line above a proposal the reader can sign, until the first-run card is hidden. */
export const FIRST_SIGN = {
	text: "You have been asked to sign. Check the destination and the amount in your wallet, then sign. Signing alone sends nothing.",
	ok: "Got it",
} as const;

/** The two ways in that need no wallet, always on the start page. */
export const START = {
	createBody:
		"Connect the wallet whose Hyperliquid account should become the treasury. Its signers then act for it together.",
	lookTitle: "Look at a treasury",
	lookBody:
		"Read any treasury's signers, balances and history on Hyperliquid. No wallet needed.",
	lookButton: "Open the multi-sig inspector",
} as const;

/** One term of the glossary. */
export interface Term {
	readonly term: string;
	readonly body: string;
	/** The expert's word for it, where screens avoid that word. */
	readonly expert?: string;
}

export const GLOSSARY_TITLE = "Glossary";
export const GLOSSARY_META = "The words this section uses, in plain terms.";

export const GLOSSARY: readonly Term[] = [
	{
		term: "Treasury",
		body: "A Hyperliquid account controlled by several wallets together. Its own key can no longer act alone.",
	},
	{
		term: "Signer",
		body: "A wallet allowed to approve the treasury's actions.",
	},
	{
		term: "Threshold",
		body: "How many signers must approve, as in “2 of 3”.",
	},
	{
		term: "Proposal",
		body: "A request for the treasury to do one thing. Nothing happens until enough signers approve and the finaliser sends it.",
	},
	{
		term: "Finaliser",
		body: "The one signer who sends an approved proposal to Hyperliquid, chosen when the proposal is made.",
	},
	{
		term: "Sign",
		body: "Approve a proposal in your wallet. Signing alone sends nothing.",
	},
	{
		term: "Send to Hyperliquid",
		body: "The finaliser's last step. Once Hyperliquid accepts it, it cannot be undone.",
	},
	{
		term: "Say no",
		body: "Tells your co-signers you object. It does not stop the proposal: only its proposer can cancel it.",
	},
	{
		term: "Cancel for everyone",
		body: "The proposer takes a proposal off everyone's list. Signatures already given stay valid until its signing window closes, so the finaliser could still send it.",
	},
	{
		term: "Signing window",
		body: "How long a proposal can still be sent: about two days from when it was made.",
	},
	{
		term: "Proposal number",
		body: "Every proposal has its own number, and Hyperliquid takes each number once, even when it refused it. That is why a refused proposal is proposed again rather than sent again.",
		expert: "nonce", // jargon: the glossary names the expert's word
	},
	{
		term: "Hyperliquid's record",
		body: "The account's own history on Hyperliquid, shown in the “On Hyperliquid” tab. It is the proof of what happened.",
	},
	{
		term: "Signing log",
		body: "What happened here: who proposed, signed, said no and sent.",
	},
	{
		term: "hl-tools server",
		body: "Stores proposals and signatures you share, so your co-signers see them. Optional: links and files work without it.",
		expert: "relay", // jargon: the glossary names the code's word
	},
	{
		term: "Signing network",
		body: "The network your wallet signs under. Nothing is sent or paid there. A vault step is signed under one numbered 1337.",
	},
	{
		term: "Move",
		body: "Two proposals that together do one thing, such as moving funds from perps into a vault. They are signed together and sent in order.",
	},
	{
		term: "API wallet",
		body: "A key the treasury allows to trade for it without the signers. It can trade with everything the treasury holds and move it into vaults, but cannot send funds to another account or withdraw them.",
	},
	{
		term: "Account mode",
		body: "Manual keeps separate perps and spot balances. Unified keeps one balance for both.",
	},
];
