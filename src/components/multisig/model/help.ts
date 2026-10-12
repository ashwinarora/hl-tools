/**
 * What the small "?" marks say. Written for someone who has never used a
 * multi-sig: one term each, in plain words, with what it means for their
 * money. Checked (help.test.ts) like the relay's copy: nothing here promises
 * secrecy, a price or the absence of a server, nothing uses the developer's
 * words, and every text is short enough to be read in one go.
 */
export interface HelpText {
	readonly title: string;
	readonly body: string;
}

export const HELP = {
	treasury: {
		title: "Treasury",
		body: "A Hyperliquid account that its signers control together. Its own key no longer works by itself: every action needs the agreed number of signers.",
	},
	signer: {
		title: "Signer",
		body: "One of the wallets the treasury lists as allowed to approve its actions. A signer approves with their own wallet. Nobody can sign for them, and this site never holds a key.",
	},
	threshold: {
		title: "Threshold",
		body: "How many signers must approve before anything can happen. With “2 of 3”, any two of the three are enough, and no single signer can move funds alone.",
	},
	finaliser: {
		title: "Finaliser",
		body: "The signer chosen to send the proposal to Hyperliquid once enough signers have approved. Only the finaliser can send it, and only exactly as it was signed: the amount and the destination cannot be changed.",
	},
	proposal: {
		title: "Proposal",
		body: "A request for the treasury to do one thing, such as a payment. Nothing happens until enough signers have approved it and the finaliser has sent it.",
	},
	signingWindow: {
		title: "Signing window",
		body: "How long a proposal can still be sent: two days from when it was made. After that Hyperliquid refuses it and its signatures are worth nothing. It can then be proposed again.",
	},
	signingChain: {
		title: "Signed under a chain",
		body: "Your wallet asks which network a signature is for, so Hyperliquid's actions name one. Nothing is sent to that network and nothing is paid there. The action goes to Hyperliquid only.",
	},
	apiWallet: {
		title: "API wallet",
		body: "A separate key the treasury has allowed to act for it, usually for a bot. Without the signers it can trade with everything the treasury holds and move it into vaults. It cannot send funds to another account or withdraw them. Approve one only for a bot you trust.",
	},
	treasuryAccount: {
		title: "Treasury account",
		body: "The wallet you are connected with is itself a treasury. Its own key can no longer act for it on Hyperliquid. To use that treasury, switch to one of its signers in your wallet.",
	},
	ownKey: {
		title: "The account's own key",
		body: "The key of the treasury account itself. While the account is a treasury that key cannot act for it on Hyperliquid. It still controls the same address on other networks, and it gets the account back if the signers convert it back.",
	},
	changeSigners: {
		title: "Change signers",
		body: "Replaces the list of signers and the number that must sign, in one step. The current signers decide, by the current number. It takes effect the moment Hyperliquid accepts it.",
	},
	convertBack: {
		title: "Convert back",
		body: "Turns the treasury into a normal account again. From then on whoever holds the account's own key controls it alone, and the signers decide nothing. If nobody holds that key, the account is locked for good.",
	},
	stolenLost: {
		title: "Stolen and lost keys",
		body: "The number that must sign trades two risks. A higher number means more keys have to be stolen before the money can be taken. It also means fewer keys can be lost before nobody can act at all.",
	},
	lastSigned: {
		title: "Last signed",
		body: "When this signer last signed one of this treasury's proposals here. “No signature here yet” does not mean they cannot sign. It only means none has been seen.",
	},
	movable: {
		title: "Can be moved now",
		body: "What a payment can use right now. In a manual account it is the part of the perps balance not tied up as margin for open positions. In a unified account it is the balance less what positions and waiting orders reserve.",
	},
	inUse: {
		title: "In use",
		body: "The part of the balance that open positions and waiting orders reserve. It is freed when a position is closed or an order is cancelled, and it cannot be paid out until then.",
	},
	accountMode: {
		title: "Account mode",
		body: "How Hyperliquid keeps this account's money. A manual account has two balances, perps and spot. A unified account has one. The mode decides which ways of sending work, and this page follows it.",
	},
	pockets: {
		title: "From and into",
		body: "A manual account holds USDC in two places: the perps balance, which backs positions, and the spot balance. Choose which one the payment is taken from and which one the receiver gets it in. A unified account has one balance, so there is nothing to choose.",
	},
	activationFee: {
		title: "First send to a new address",
		body: "Hyperliquid charges 1 USDC the first time anything is sent to an address it has never seen. The receiver still gets the full amount. The 1 USDC is taken from the treasury on top, once. Sending to an address already in use costs nothing.",
	},
	perpsSpot: {
		title: "Perps and spot",
		body: "Hyperliquid keeps two balances per account. Perps holds the USDC that backs futures positions. Spot holds tokens owned outright. Money is moved between the two with a proposal.",
	},
	onHold: {
		title: "On hold",
		body: "The part of a balance reserved by open orders, and in a unified account by open positions too. It comes back when the order is cancelled and is spent when the order fills.",
	},
	unrealised: {
		title: "Unrealised profit",
		body: "What an open position would gain or lose if it were closed at the current price. It moves with the market and becomes real only when the position is closed.",
	},
	liquidation: {
		title: "Liquidation price",
		body: "The market price at which Hyperliquid would close this position by force, because the margin no longer covers it. The further away it is, the safer the position.",
	},
	funding: {
		title: "Funding",
		body: "A small payment between holders of long and short positions, settled every hour. A positive number was received, a negative one was paid.",
	},
	live: {
		title: "Live figures",
		body: "Balances, positions and orders are pushed by Hyperliquid as they change, so there is no need to reload. If the connection drops, the badge says so and the page reconnects by itself.",
	},
	checked: {
		title: "Checked a moment ago",
		body: "Signers and API wallets are read from Hyperliquid once a minute while this page is open. The round arrow reads them again at once.",
	},
	staking: {
		title: "Staking",
		body: "HYPE staked with a validator helps secure Hyperliquid and earns rewards, which are added to the stake. It stays the treasury's: it sits in the staking balance or with a validator, and only the signers can bring it back to spot.",
	},
	stakingBalance: {
		title: "Staking balance",
		body: "HYPE that was moved out of spot for staking and is not staked with a validator. It earns nothing there. It can be staked at once, or returned to spot, which takes 7 days (5 minutes on testnet).",
	},
	stakeLockup: {
		title: "Lockup",
		body: "After HYPE is staked with a validator it cannot be unstaked for 1 day (2 minutes on testnet). Adding to a stake starts that wait again for everything staked with that validator.",
	},
	returnQueue: {
		title: "Return to spot",
		body: "HYPE going from the staking balance back to spot waits 7 days (5 minutes on testnet) and then lands by itself, with no further signature. Hyperliquid lets five returns wait at once.",
	},
	validatorState: {
		title: "Validator state",
		body: "Active validators produce blocks and are paid. A jailed one was voted out by the others for not responding, and an inactive one has too little stake to be among them. A stake with either earns nothing until that changes.",
	},
	expectedRate: {
		title: "Expected rate",
		body: "Hyperliquid's own estimate of what a stake with this validator earns in a year, after its commission, from the last 7 days: the figure Hyperliquid's staking page shows first. It is an estimate and it changes. Nobody is recommended here.",
	},
	signingCode: {
		title: "Signing a code",
		body: "Hyperliquid has two ways of signing. For most actions a wallet shows every field. For a vault action it shows only a code that stands for the action. This page works the same code out from the proposal, so the two can be compared before signing.",
	},
	signingNetwork: {
		title: "The signing network",
		body: "A wallet signs a code only while it is on a network numbered 1337, so the wallet has to hold one. Nothing is ever sent on that network and it holds no money. After signing, the wallet goes back to the network it was on.",
	},
	moveSteps: {
		title: "Two steps, one move",
		body: "Hyperliquid takes one action at a time, and this takes two. They are two proposals, shown as one. Each signer signs both, and the finaliser sends the second only once Hyperliquid has accepted the first.",
	},
	stakingChecked: {
		title: "Read once a minute",
		body: "Hyperliquid does not send staking figures live, so this page asks for them once a minute while it is open, and again after a staking step. Balances, positions and orders arrive as they happen.",
	},
	inboxFinish: {
		title: "Ready for you to finish",
		body: "Enough signers have approved, or your signature is the last one missing, and you are the finaliser. Open one, check it, and send it. Start with the oldest.",
	},
	inboxSign: {
		title: "Waiting for your signature",
		body: "Proposals from your co-signers that still need approvals. Open one, check the destination and the amount, and sign if you agree. Signing by itself sends nothing.",
	},
	inboxWaiting: {
		title: "Waiting on others",
		body: "Nothing for you to do. Each of these needs more signatures, is ready and waits for its finaliser to send it, or is one you said no to.",
	},
	inboxDead: {
		title: "Cannot be finished",
		body: "These cannot go ahead as they stand. Either Hyperliquid would refuse them (a newer payment was sent first, or the finaliser is no longer a signer), or enough signers said no. Open one to see which, and to propose it again.",
	},
	sendOrder: {
		title: "Payments go in order",
		body: "Hyperliquid takes two kinds of payment only in the order they were proposed: a USDC send written as raw JSON, and a withdrawal to Arbitrum. If a newer one goes first, the older ones are refused and have to be proposed again. The Send forms here are not bound by this.",
	},
	waysOut: {
		title: "Take back, say no, withdraw",
		body: "Take back removes your own signature. Saying no tells the others you are against it, and ends nothing. Only the proposer can withdraw a proposal for everyone. A signature already given still counts on Hyperliquid until the signing window closes: these are agreements, not locks.",
	},
	sayNo: {
		title: "Saying no",
		body: "A no tells your co-signers you are against this proposal. It ends nothing: the others can still sign and submit it if enough of them agree. While the proposal is open you can take your no back, or sign, which replaces it.",
	},
	seen: {
		title: "Seen",
		body: "A signer opened this proposal while signed in, and when. It tells “has not looked yet” from “looked and has not signed”. Every signer of this treasury sees these marks, the one about themselves too.",
	},
	nickname: {
		title: "Nickname",
		body: "A name the signers give an address, used only in this treasury. The address is always shown next to it, and it is the address you sign, never the name. Any signer can set one, so check the address before a payment.",
	},
	noneOnRecord: {
		title: "None on record",
		body: "This transfer left the treasury and no proposal known here explains it. It was signed and sent some other way, for example with another tool. If none of the signers knows it, find out who signed it.",
	},
	recordAndLog: {
		title: "Two records",
		body: "The Signing log is what happened here: who proposed, signed and sent. “On Hyperliquid” is the account's own record of every transfer, trade and order, whoever caused it. The second is the proof. The first explains it.",
	},
	outside: {
		title: "Carried out, not reported here",
		body: "Hyperliquid carried this action out, but its result was never reported here: it was submitted while signed out, or some other way. The transaction was looked up on Hyperliquid and the proposal closed, so that nobody signs it a second time.",
	},
	away: {
		title: "While you were away",
		body: "What finished or changed since you last pressed “Got it”: actions sent without your signature, changes to signers and API wallets, and money that left with no proposal. Showing it marks nothing as read.",
	},
	signIn: {
		title: "Signing in",
		body: "One wallet prompt proves which wallet you are. It approves nothing and cannot move funds. It lets this site show your treasuries and what your co-signers have proposed. Each wallet signs in once: after that you can switch between them in your wallet.",
	},
	signsAndSends: {
		title: "Signs & sends",
		body: "This part of the site can ask your wallet for a signature and can send actions to Hyperliquid. Your wallet shows every request first, and nothing happens without your approval there.",
	},
} as const satisfies Record<string, HelpText>;

export type HelpKey = keyof typeof HELP;

/** The longest a help text may be: what fits the small box without scrolling. */
export const HELP_MAX = 290;

/** Words of the trade that a newcomer should not have to know. */
export const HELP_JARGON: readonly RegExp[] = [
	/\bnonce\b/i,
	/\bdigest\b/i,
	/\bEIP-?\d+/i,
	/\benvelope\b/i,
	/\bpayload\b/i,
	/\bthe relay\b/i,
	/\bRPC\b/,
	/\bL1\b/,
	/\bHyperCore\b/i,
	/\bon-?chain\b/i,
];
