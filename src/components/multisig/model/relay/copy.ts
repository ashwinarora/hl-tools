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
	unreachable: "Relay unreachable. Links and files still work.",
	suspended:
		"The connected wallet is not the one signed in, so nothing is read from or sent to the relay.",
	firstUseTitle: "This section signs and sends real transactions",
	firstUseBody:
		"You approve every signature in your own wallet, and a submitted action cannot be undone. Read the destination and amount in the wallet prompt each time, and rehearse on testnet first.",
	underSign:
		"Your wallet will show the treasury, the finaliser, the destination and the amount. Check them there.",
	shareOnlyHere:
		"This proposal is only in this browser. Share it and your co-signers see it in their pending list.",
	createdShared:
		"Your co-signers see it in their pending list as soon as it is created.",
	endingNote:
		"It leaves everyone's pending list and cannot be brought back. Signatures already given stay valid until the signing window closes.",
	reportedReceipt:
		"As reported by the finaliser's browser. The ledger is the proof.",
	addMeta:
		"Paste its address once. After that, every co-signer who signs in sees it automatically.",
	addedByOther:
		"You did not add this treasury. Anyone can create a multi-sig that lists your address; signing its proposals acts on that account only, never on yours.",
} as const;

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
];
