/**
 * Every sentence the relay-era screens say about what happens to your data,
 * in one place so it can be checked (copy.test.ts): nothing here may promise
 * secrecy the relay does not provide, a price, or the absence of a server.
 * What the operator can see is stated in the Privacy Policy, which the
 * sign-in small print links to.
 */
export const RELAY_COPY = {
	signInButton: "Sign in with your wallet",
	smallPrintBefore: "By signing in you agree to the ",
	smallPrintLink: "Privacy Policy",
	signedOutRail:
		"Sign in to see your treasuries and what your co-signers have proposed.",
	landingMeta:
		"Propose, sign and submit native Hyperliquid multi-sig actions with your own wallet.",
	teamTitle: "With your team",
	teamBody:
		"Sign in with your wallet to see your treasuries, what is waiting for your signature, and who signed what.",
	teamSmall: "One wallet prompt. It approves nothing and moves nothing.",
	soloTitle: "Without signing in",
	soloBody:
		"Everything also works with links and files passed by hand. Nothing is stored for you.",
	withoutUs: "You can always do this without us.",
	recentHere:
		"Proposals you made or opened here, as this browser keeps them (IndexedDB). The chain knows nothing of a proposal until it is submitted.",
	unreachable: "Relay unreachable. Links and files still work.",
	// Several wallets can stay signed in in one browser; only the connected one is in use.
	othersHow:
		"Choose one of them in your wallet to use it, with no new signature. While another wallet is connected, nothing is read or sent for these.",
	// a proposal made while the relay is not in use stays where it was made
	notSignedInLocal:
		"You are not signed in, so it stays in this browser until you pass it on: your co-signers do not see it in their lists.",
	unreachableLocal:
		"The relay cannot be reached, so it stays in this browser until you pass it on.",
	connectOneOf:
		"Connect a wallet that is signed in here to continue, or sign in with another one.",
	signOutAll: "Sign out all wallets",
	firstUseTitle: "This section signs and sends real transactions",
	firstUseBody:
		"You approve every signature in your own wallet, and a submitted action cannot be undone. Read the destination and amount in the wallet prompt each time, and rehearse on testnet first.",
	// the same notice in a build without a relay: how a proposal travels there
	firstUseBodySolo:
		"Proposals are signed with your wallet and submitted to Hyperliquid from this browser. A proposal travels as a link or a file, and every signature is verified here before anything is sent. Rehearse on testnet first.",
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
	endingNote:
		"It leaves everyone's pending list and cannot be brought back. Signatures already given stay valid until the signing window closes.",
	reportedReceipt:
		"As reported by the finaliser's browser. The ledger is the proof.",
	addMeta:
		"Paste its address once. After that, every co-signer who signs in sees it automatically.",
	// Nicknames. They are shared with the treasury's signers through the relay,
	// so none of this may call them the reader's own secret.
	nicknameScope:
		"Used only in this treasury: its signers see it, and it is shown nowhere else. The address stays visible next to it.",
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
	awayNotChecked:
		"API wallets and transfers are checked when you open this treasury.",
	awayOthers:
		"API wallets and transfers were checked for your first ten treasuries. The others are checked when you open them.",
	addExisting: "Add an existing one",
	// Creating a treasury: the account that was converted registers itself.
	createSignIn:
		"Sign in with the wallet whose account you want to convert into a treasury.",
	registering: "Adding it to its signers' lists…",
	registered: "Its signers find it in their list when they sign in.",
	registerFailed:
		"The account is converted, but it could not be added to its signers' lists just now. Any signer can add it under “Add an existing one”.",
	registeredByAccount: "Registered by the account itself when it was converted",
	registerSelfTitle: "this is the wallet you are signed in with",
	registerSelfBody:
		"Register it so that its signers find it in their list. You will not see it here yourself: sign in as one of its signers for that.",
	registerSelfButton: "Register it",
	selfSeesNothing:
		"Its proposals and its signing log are shown to its signers, not to the account itself. If they do not find it in their list:",
	addedByOther:
		"You did not add this treasury. Anyone can create a multi-sig that lists your address; signing its proposals acts on that account only, never on yours.",
} as const;

/**
 * What can be said after "Hyperliquid rejected …" from the history entry
 * alone, which carries only the HTTP status. An answer from Hyperliquid
 * itself (200) has used up the proposal's number, whatever the reason was
 * (see the core's `numberSpent`): it is never called retryable. Anything
 * else never reached Hyperliquid's record of numbers.
 */
export function afterRejection(httpStatus: unknown): string {
	if (httpStatus === 200)
		return "It cannot be sent again as it is: open it to see why, and propose it again if it is still wanted.";
	if (typeof httpStatus === "number")
		return `The request did not get through (HTTP ${httpStatus}), so it can be sent again.`;
	return "Open it to see why.";
}

/**
 * What to check in the wallet before signing a proposal, by what the action
 * is: the prompt shows the treasury and the finaliser every time, and then
 * the fields of the action itself.
 */
const STAKING_WEI_HINT =
	"Your wallet will show the treasury, the finaliser and the amount as a whole number: 100000000 is 1 HYPE. Check them there.";
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
	// the staking actions carry HYPE as a whole number with 8 decimals
	cDeposit: STAKING_WEI_HINT,
	cWithdraw: STAKING_WEI_HINT,
	tokenDelegate:
		"Your wallet will show the treasury, the finaliser, the validator's address and the amount as a whole number: 100000000 is 1 HYPE. “isUndelegate” reads false for a stake and true for an unstake. Check them there.",
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
}): string {
	const type = action.type;
	if (typeof type !== "string") return SIGN_HINT_OTHER;
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
