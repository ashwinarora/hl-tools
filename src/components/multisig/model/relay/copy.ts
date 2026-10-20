import { weiToHype } from "@hl-tools/core";
import { type Part, say } from "../parts";

/**
 * Every sentence the relay-era screens say about what happens to your data,
 * in one place so it can be checked (copy.test.ts): nothing here may promise
 * secrecy the relay does not provide, a price, or the absence of a server.
 * What the operator can see is stated in the Privacy Policy, which the
 * sign-in small print links to.
 */
export const RELAY_COPY = {
	/** On a proposal page while the hl-tools server cannot be reached (audit F-121). */
	copyOnly:
		"The hl-tools server can't be reached, so this is this browser's copy: newer signatures, a no or a cancel may be missing from it.",
	signInButton: "Sign in with your wallet",
	// a failed sign-in is one short line in a toast; the exact reason waits under "Details"
	signInFailed: "Sign-in didn't go through. Please try again.",
	signInCancelled: "Sign-in cancelled in your wallet.",
	signInTooMany:
		"Too many sign-ins from this network. Try again in a few minutes.",
	signInDetails: "Details",
	smallPrintBefore: "By signing in you agree to the ",
	smallPrintLink: "Privacy Policy",
	signedOutRail:
		"Sign in to see your treasuries and what your co-signers have proposed.",
	landingMeta:
		"Propose, sign and send native Hyperliquid multi-sig actions with your own wallet.",
	teamTitle: "With your team",
	teamBody:
		"Sign in with your wallet to see your treasuries, what is waiting for your signature, and who signed what.",
	teamSmall:
		"One wallet prompt. It approves nothing and moves nothing, whatever network the message names.",
	soloTitle: "Without signing in",
	soloBody:
		"Everything also works with links and files passed by hand. Nothing is stored for you.",
	withoutUs: "You can always do this without us.",
	recentHere:
		"Proposals you made or opened here, saved in this browser. Hyperliquid sees nothing until one is sent. Clearing this site's data removes them.",
	unreachable:
		"Can't reach the hl-tools server. Your co-signers' updates will not show until it is back. You can still share by link or file.",
	// Several wallets can stay signed in in one browser; only the connected one is in use.
	othersHow:
		"Choose one of them in your wallet to use it, with no new signature. While another wallet is connected, nothing is read or sent for these.",
	// a proposal made while the hl-tools server is not in use stays where it was made
	notSignedInLocal:
		"You are not signed in, so it stays in this browser until you pass it on: your co-signers do not see it in their lists.",
	unreachableLocal:
		"The hl-tools server cannot be reached, so it stays in this browser until you pass it on.",
	connectOneOf:
		"Connect a wallet that is signed in here to continue, or sign in with another one.",
	signOutAll: "Sign out all wallets",
	underSign:
		"Your wallet will show the treasury, the finaliser, the destination and the amount. Check them there.",
	shareOnlyHere:
		"This proposal is only in this browser. Share it and your co-signers see it in their pending list.",
	shareMoveOnlyHere:
		"This move is only in this browser. Share it and your co-signers see its two steps as one item in their pending list.",
	shareMoveHalf:
		"Only one step of this move has been shared, so your co-signers see half of it. Share the other step too.",
	createdShared:
		"Your co-signers see it in their pending list as soon as it is created.",
	// A signer's no: an objection the others see, never an ending.
	sayNo: "Say no",
	takeBackNo: "Take back my no",
	saidNoAfterSigning:
		"Saying no takes your signature back here. On Hyperliquid a signature already given still counts until the signing window closes.",
	reportedReceipt:
		"As reported by the finaliser's browser. Hyperliquid's record is the proof.",
	takeBackHint:
		"Removes it from this page. A copy someone already has still counts on Hyperliquid until the signing window closes.",
	/** Under the button that sends: it is final. */
	sendIsFinal: "Once Hyperliquid accepts it, it cannot be undone.",
	addMeta:
		"Paste its address once. After that, every co-signer who signs in sees it automatically.",
	// Nicknames. They are shared with the treasury's signers through the relay,
	// so none of this may call them the reader's own secret.
	nicknameScope:
		"Used only in this treasury: its signers see it, and it is shown nowhere else. The address stays visible next to it.",
	// beside "you" in a treasury's signer list, while your address has no nickname there
	nameYourself: "Name yourself",
	nameYourselfTitle: "Give your own address a nickname in this treasury",
	nicknameOwn:
		"This is your own address: nobody else can choose its nickname here.",
	nicknameTreasury: "Any signer of this treasury can change it.",
	nicknameOther:
		"Any signer of this treasury can change it. Nothing is signed.",
	nicknameHint: "Up to 40 characters. A nickname cannot look like an address.",
	nicknameWhere: "Used only in this treasury.",
	nicknamePick: "Nicknamed in this treasury:",
	// "Seen" marks are shared with the treasury's signers, the reader's own included.
	seenNote:
		"\u201cSeen\u201d means that signer opened this page while signed in. Every signer of this treasury sees these marks, including the one next to their own name.",
	// "While you were away". What a signer has marked as read is not shown to
	// co-signers; nothing here may say more than that.
	awayTitle: "While you were away",
	awayGotIt:
		"Got it. Your co-signers are not shown what you have marked as read.",
	awayAll: "Marked as read. It all stays in the Signing log and the tables.",
	awayDot: "Something changed while you were away",
	awayChecking: "Checking API wallets and transfers on Hyperliquid…",
	awayFailed:
		"Hyperliquid did not answer, so API wallets and transfers could not be checked.",
	awayPartly:
		"Some transfers could not be checked yet: Hyperliquid did not answer. They stay unread and are tried again.",
	awayRested:
		"Some transfers could not be checked yet: Hyperliquid's explorer refused more look-ups for today. They stay unread and are tried again later.",
	awayNotChecked:
		"API wallets and transfers are checked when you open this treasury.",
	awayOthers:
		"API wallets and transfers were checked for your first ten treasuries. The others are checked when you open them.",
	addExisting: "Add an existing one",
	// a proposal that can no longer be signed or sent: its copy is a record now
	recordCopy:
		"Nothing more can be signed or sent here. A copy keeps who signed it, as a file.",
	downloadCopy: "Download a copy",
	// Creating a treasury: the account that was converted registers itself.
	createSignIn:
		"Sign in with the wallet whose account you want to convert into a treasury.",
	registering: "Adding it to its signers' lists…",
	registered: "Its signers find it in their list when they sign in.",
	registerFailed:
		"The account is converted, but it could not be added to its signers' lists just now. Any signer can add it under “Add an existing one”.",
	registeredByAccount:
		"Registered by the account itself when it was first converted",
	registerSelfTitle: "this is the wallet you are signed in with",
	registerSelfBody:
		"Register it so that its signers find it in their list. You can then follow its proposals here too; signing them is for its signers.",
	registerSelfButton: "Register it",
	selfSeesNothing:
		"The hl-tools server does not hold this treasury yet. Once it is registered, its signers find it in their list and you can follow its proposals here:",
	addedByOther:
		"You did not add this treasury. Anyone can create a multi-sig that lists your address; signing its proposals acts on that account only, never on yours.",
} as const;

/**
 * What cancelling a proposal for everyone does, and what it does not: it
 * leaves every list, but the signatures already given stay valid on
 * Hyperliquid until the window closes (`until`), so the finaliser could
 * still send it. Shown before the proposer confirms.
 */
export function cancelNote(until: number): Part[] {
	return say`This cannot be undone. It leaves everyone's list, but it does not stop the proposal on Hyperliquid: the signatures already given stay valid until ${{ text: `${new Date(until).toISOString().slice(0, 16).replace("T", " ")} UTC`, when: until }}, and the finaliser could still send it.`;
}

/**
 * Beside Create, for a USDC send or a withdrawal while the hl-tools server's
 * list could not be read: its number is worked out from this browser's
 * copies only (audit F-083). Nothing is blocked: a read that fails stops
 * nothing.
 */
export const NUMBERED_HERE =
	"The hl-tools server could not be read, so this is numbered after this browser's copies only: a send a co-signer proposed elsewhere may be missed, and Hyperliquid takes sends only in order.";

/**
 * Under "Your part" of a proposal only this browser holds: nobody else signs
 * before it is passed on (audit F-125).
 */
export const SHARE_FIRST =
	"Your co-signers see it only once you pass it on: share it below.";

/**
 * What can be said after "Hyperliquid did not accept …" from the history
 * entry alone, which carries only the HTTP status. An answer from Hyperliquid
 * itself (200) is a refusal or "already used" (most likely sent before, the
 * answer lost): the history cannot tell which, so the proposal's page says.
 * Anything else never reached Hyperliquid's record of numbers (pages no longer
 * report such an answer; older history entries may hold one).
 */
export function afterRejection(httpStatus: unknown, here = false): string {
	if (httpStatus === 200)
		return here ? "The top of this page says why." : "Its page says why.";
	if (typeof httpStatus === "number")
		return `The request did not get through (HTTP ${httpStatus}), so it can be sent again.`;
	return "Open it to see why.";
}

/**
 * What to check in the wallet before signing a proposal, by what the action
 * is: the prompt shows the treasury and the finaliser every time, and then
 * the fields of the action itself.
 */
/** "the amount as 10000000, which is 0.1 HYPE": the figure the wallet shows, and what it is. */
function weiAmount(wei: unknown): string {
	const hype = weiToHype(wei);
	return hype === null
		? "the amount as a whole number of HYPE's smallest unit (100000000 is 1 HYPE)"
		: `the amount as ${String(wei)}, which is ${hype} HYPE`;
}
const STAKING_WEI_HINT = (wei: unknown) =>
	`Your wallet will show the treasury, the finaliser and ${weiAmount(wei)}. Check them there.`;
const UNSTAKE_HINT = (wei: unknown) =>
	`Your wallet will show the treasury, the finaliser, the validator's address and ${weiAmount(wei)}. “isUndelegate” reads false for a stake and true for an unstake. Check them there.`;
const SIGN_HINTS: Readonly<Record<string, string>> = {
	convertToMultiSigUser:
		"Your wallet will show the treasury, the finaliser and the new list of signers with the number that must sign. Check them there.",
	approveAgent:
		"Your wallet will show the treasury, the finaliser and the address of the API wallet. Check them there.",
	usdClassTransfer:
		"Your wallet will show the treasury, the finaliser, the amount and the direction. Check them there.",
	userSetAbstraction:
		"Your wallet will show the treasury, the finaliser and the mode by Hyperliquid's own word for it: “unifiedAccount” is a unified account, “disabled” a manual one. Check them there.",
	// signed as a code: the wallet shows no field of the action
	vaultTransfer:
		"Your wallet will show a code, not the action: the field “connectionId”. Compare it with the code on this page before you sign.",
};

/** The staking actions carry HYPE as a whole number with 8 decimals: said with its figure. */
const WEI_HINTS: Readonly<Record<string, (wei: unknown) => string>> = {
	cDeposit: STAKING_WEI_HINT,
	cWithdraw: STAKING_WEI_HINT,
	tokenDelegate: UNSTAKE_HINT,
};

/** The actions that pay someone: the prompt names a destination and an amount. */
const PAYS = ["sendAsset", "usdSend", "spotSend", "withdraw3"];
const SIGN_HINT_OTHER =
	"Your wallet will show the treasury, the finaliser and every field of the action. Check them there.";

/** The conversion back carries no list: the prompt shows the word the chain takes for it. */
const SIGN_HINT_BACK =
	"Your wallet will show the treasury, the finaliser and “signers” as “null”, which is the conversion back to a normal account. Check them there.";

/**
 * A removal carries no wallet's address: the prompt shows the address of all
 * zeros, which is how Hyperliquid takes "nobody", and the name being removed.
 */
const SIGN_HINT_REMOVAL =
	"Your wallet will show the treasury, the finaliser, an address of all zeros and the name of the API wallet being removed, which is empty for the one without a name. Check them there.";

export function signHint(action: {
	readonly type?: unknown;
	readonly signers?: unknown;
	readonly agentAddress?: unknown;
	readonly wei?: unknown;
}): string {
	const type = action.type;
	if (typeof type !== "string") return SIGN_HINT_OTHER;
	const wei = WEI_HINTS[type];
	if (wei) return wei(action.wei);
	if (PAYS.includes(type)) return RELAY_COPY.underSign;
	if (type === "convertToMultiSigUser" && action.signers === "null")
		return SIGN_HINT_BACK;
	if (
		type === "approveAgent" &&
		typeof action.agentAddress === "string" &&
		/^0x0{40}$/i.test(action.agentAddress)
	)
		return SIGN_HINT_REMOVAL;
	return SIGN_HINTS[type] ?? SIGN_HINT_OTHER;
}

/**
 * The finaliser's own prompt, the one around the signers' signatures: it
 * never shows the action, whatever kind the action is.
 */
const FINALISER_ONLY =
	"Your wallet will show “multiSigActionHash”: it stands for the action together with the signatures collected. This is your signature as finaliser.";
const FINALISER_LAST =
	"The last prompt is your signature as finaliser: it shows “multiSigActionHash”, which stands for the action together with the signatures collected.";

/**
 * Under the steps while a finaliser's click runs. With `adds`, the
 * finaliser's own signature on the action comes first; `explained` when the
 * page already says what that prompt shows (the panel with the code).
 */
export function finishHint(
	action: Parameters<typeof signHint>[0],
	adds: boolean,
	explained = false,
): string {
	if (!adds) return FINALISER_ONLY;
	return explained ? FINALISER_LAST : `${signHint(action)} ${FINALISER_LAST}`;
}

export const SIGN_HINT_TEXTS: readonly string[] = [
	...Object.values(SIGN_HINTS),
	...Object.values(WEI_HINTS).flatMap((hint) => [hint(10_000_000), hint(null)]),
	SIGN_HINT_OTHER,
	SIGN_HINT_BACK,
	SIGN_HINT_REMOVAL,
	FINALISER_ONLY,
	FINALISER_LAST,
];

/**
 * The line that opens the list of wallets signed in in this browser besides
 * the connected one (all of them when no wallet is connected).
 */
export function othersSummary(count: number, connected: boolean): string {
	const more = connected ? "more " : "";
	return count === 1
		? `1 ${more}wallet is signed in here`
		: `${count} ${more}wallets are signed in here`;
}

/**
 * Under a sign-in gate, when the connected wallet is not signed in but
 * others are: why what was on screen a moment ago is gone.
 */
export function gateOthers(count: number, connected = true): string {
	// with no wallet connected there is no "this one", and nothing the others are other than
	if (!connected)
		return count === 1
			? "A wallet is signed in here. Connect it to go on as that one, or sign in with another."
			: `${count} wallets are signed in here. Connect one of them to go on as that one, or sign in with another.`;
	return count === 1
		? "Another wallet is signed in here. Choose it in your wallet to go on as that one, or sign in with this one."
		: `${count} other wallets are signed in here. Choose one of them in your wallet to go on as that one, or sign in with this one.`;
}

/** Wording that must never appear in relay-era copy. */
export const FORBIDDEN_CLAIMS: readonly RegExp[] = [
	/\bprivate\b(?! key)/i,
	/\bprivately\b/i,
	/encrypt/i,
	/\bonly you\b/i,
	/\bconfidential/i,
	/\bsecret/i,
	/free forever/i,
	/\bfree\b/i,
	/no server/i,
	/without a server/i,
	/no backend/i,
	/never leaves/i,
	/browser only/i,
];
