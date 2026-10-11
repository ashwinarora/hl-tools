import { defineRuleSet, docs, PYTHON_SDK, type RuleSource } from "./meta.ts";

export const NKTKAS_SIGNING: RuleSource = {
	label: "@nktkas/hyperliquid signing (TypeScript SDK)",
	url: "https://github.com/nktkas/hyperliquid/blob/main/src/signing/mod.ts",
};

export const MULTISIG_RULES = defineRuleSet({
	id: "multisig",
	title: "Native multi-sig",
	version: "1.2.0",
	verifiedAt: "2026-10-11",
	summary:
		"A multi-sig user is an ordinary account whose own key can no longer send; up to 10 authorized users sign, a leader (an authorized user, or a funded API wallet of one) collects at least `threshold` distinct signatures and submits a `multiSig` envelope. Inner L1 actions are hashed as `[multiSigUser, outerSigner, action]` with the envelope's nonce, vault and expiry; inner user-signed actions gain `payloadMultiSigUser` and `outerSigner` after `hyperliquidChain`. The leader signs `HyperliquidTransaction:SendMultiSig{hyperliquidChain, multiSigActionHash, nonce}` over the envelope with inner signatures trimmed. Only the leader's nonce set is used; the multi-sig user's rate limit is charged. An envelope Hyperliquid refuses still uses up its number for that leader, so a refused proposal has to be made again. An account's USDC sends (`usdSend`) are taken only in increasing order of their `time`: once a newer one is carried out, an older pending send or bridge withdrawal is refused. Every other kind of action is taken in any order.",
	sources: [
		docs("hypercore/multi-sig", "Multi-sig"),
		docs("for-developers/api/nonces-and-api-wallets", "Nonces and API wallets"),
		PYTHON_SDK,
		NKTKAS_SIGNING,
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-10-07",
			note: "Envelope hashing, signer-set rules, nonce window, agent and leader behaviour verified on testnet (163 recorded requests).",
		},
		{
			version: "1.1.0",
			date: "2026-10-11",
			note: 'USDC sends are ordered: after an account carried out a `usdSend`, a `usdSend` with an older `time` is refused with "Nonce already used.", whoever leads and whatever the destination (12 pairs recorded on testnet through multi-sig envelopes). `usdClassTransfer`, `spotSend` and `approveAgent` are taken in any order; a failed attempt does not move the mark. Not documented by Hyperliquid.',
		},
		{
			version: "1.2.0",
			date: "2026-10-11",
			note: "The order lab: 247 questions put to a plain account and to a multi-sig on testnet (fixtures/multisig/nonce-order.json), 27 kinds of action. Only `usdSend` is ordered, on a plain account exactly as through an envelope, and its mark stays with the account when it becomes a multi-sig or a plain account again. The mark is the highest `time` carried out: a send dated ahead shuts out every send dated earlier until the clock has passed it. A bridge withdrawal (`withdraw3`) older than the mark is refused the same way; whether a withdrawal moves the mark was not measured (no withdrawal is made in testing). `sendAsset`, `spotSend`, `usdClassTransfer`, approvals, staking, account settings and every L1 kind tried are taken in any order, before or after a send. The order check comes before the balance check. Separately: an envelope that was refused (threshold not met, a stranger's signature, an action that failed, a number outside the window) is answered \"duplicate nonce\" when sent again, so a refused proposal cannot be retried; and the leader's 100 highest numbers bound what it can still lead.",
		},
	],
});

/**
 * Kinds of action an account's chain state takes only in increasing order of
 * their own number (`time`), each with the kinds that shut it out: once one
 * of those is carried out, an action with a number that is not greater is
 * refused. Measured, not documented; see `multisig/order.ts`.
 *
 *   usdSend    shut out by a later usdSend
 *   withdraw3  shut out by a later usdSend. Whether a withdrawal moves the
 *              mark itself, and so shuts sends out, is not known: no
 *              withdrawal is made in testing.
 */
export const SHUT_OUT_BY: Readonly<Record<string, readonly string[]>> = {
	usdSend: ["usdSend"],
	withdraw3: ["usdSend"],
};

/** The kinds above: every other kind is taken in any order. */
export const ORDERED_ACTION_TYPES: readonly string[] = Object.keys(SHUT_OUT_BY);

/** The chain rejects an 11th authorized user (`Too many multi-sig signers`). */
export const MAX_SIGNERS = 10;
/** `threshold` must be in [1, signers.length] (`Invalid multi-sig threshold`). */
export const MIN_THRESHOLD = 1;
/**
 * The only `signers` value that converts a multi-sig user back to a normal
 * user. Empty lists are rejected with `Invalid multi-sig threshold`, a missing
 * `authorizedUsers` key with `Unexpected error (code=148)`.
 */
export const REVERT_SIGNERS = "null";

/** Inner L1 payload hashed in place of the action: a 3-element array. */
export const INNER_L1_ENVELOPE = [
	"multiSigUser",
	"outerSigner",
	"action",
] as const;
/** Key order of the envelope action when hashed and sent (`type` is excluded from the hash). */
export const OUTER_KEY_ORDER = [
	"signatureChainId",
	"signatures",
	"payload",
] as const;
export const PAYLOAD_KEY_ORDER = [
	"multiSigUser",
	"outerSigner",
	"action",
] as const;
export const SIGNATURE_KEY_ORDER = ["r", "s", "v"] as const;

/**
 * The chain re-serialises inner signatures without leading zero bytes before
 * re-hashing the envelope, so untrimmed inner r/s make the *outer* signature
 * fail (`Invalid multi-sig outer signer`). The outer signature itself may be
 * sent padded.
 */
export const TRIM_INNER_SIGNATURES = true;
/** The envelope's `signatureChainId` is not checked against the network (0xa4b1 and 0x1 were accepted on testnet). */
export const OUTER_SIGNATURE_CHAIN_ID_CHECKED = false;

/** Bounded search budget for `diagnoseSignature` (recoveries per signature). */
export const DIAGNOSE_MAX_ATTEMPTS = 40;
/** Policy snapshots older than this are flagged stale by readiness checks. */
export const POLICY_STALE_MS = 10 * 60_000;
/** Share/relay documents larger than this get a warning. */
export const PROPOSAL_SIZE_WARN_BYTES = 16 * 1024;
/** Nonces are millisecond timestamps; anything below this looks like seconds. */
export const MIN_NONCE_MS = 1_000_000_000_000;

/**
 * Behaviour verified on testnet that the module encodes. `verified` says how:
 * every entry is backed by a recorded request in labs/multisig/FINDINGS.md.
 */
export const MULTISIG_FACTS: readonly {
	readonly id: string;
	readonly text: string;
}[] = [
	{
		id: "own-key-dead",
		text: "After conversion every action from the account's own key fails with `Multi-sig required`; the key still identifies the account and is needed only to be the revert target.",
	},
	{
		id: "leader-authorized",
		text: "The leader must be an authorized user; the multi-sig user itself, removed signers and strangers get `Invalid multi-sig outer signer`.",
	},
	{
		id: "leader-funded-agent",
		text: "An API wallet of an authorized user may lead only once the agent address itself holds a deposit; otherwise `Multi-sig outer signer must be an L1 user.`",
	},
	{
		id: "leader-need-not-sign",
		text: "The leader does not have to be among the inner signers; it only has to be authorized.",
	},
	{
		id: "agents-cannot-sign-inner",
		text: "Inner signatures must come from authorized users' own keys; an agent's signature is `Invalid multi-sig inner signer` for both hashing schemes.",
	},
	{
		id: "agent-bypass",
		text: "An API wallet approved through the multi-sig trades for the account directly, without an envelope, and survives a revert. It cannot perform user-signed actions.",
	},
	{
		id: "distinct-signers",
		text: "Signatures count by distinct recovered address; a signer twice is one vote (`Multi-sig threshold not met`). Extra valid signatures are fine.",
	},
	{
		id: "identical-inputs",
		text: "Every inner signature must bind the same action, nonce, leader, multi-sig user, vault address, expiry and network domain; any divergence is `Invalid multi-sig inner signer`.",
	},
	{
		id: "nonce-window",
		text: "The envelope nonce must be within (now − 2 days, now + 1 day) and unused by the leader; different leaders may reuse a nonce.",
	},
	{
		id: "inner-nonce-equals-envelope",
		text: "A user-signed inner action's own `nonce`/`time` must equal the envelope nonce (`Nonce mismatch.`).",
	},
	{
		id: "signer-set",
		text: "Authorized users must exist on L1, cannot include the account itself, are deduplicated silently, stored lowercase and sorted, at most 10; threshold 1..n; the current threshold governs a change.",
	},
	{
		id: "revert-null",
		text: 'Reverting to a normal user requires `"signers": "null"`; empty lists are rejected.',
	},
	{
		id: "nested-nominal",
		text: "A multi-sig user may be an authorized user of another; its raw key signs and leads regardless of its own policy.",
	},
	{
		id: "no-signer-trail",
		text: "The explorer records only the inner action under the multi-sig user; leader and signatures are not visible on chain.",
	},
	{
		id: "rate-limit-treasury",
		text: "The multi-sig user's address-based rate limit is consumed, not the leader's.",
	},
	{
		id: "hyperevm",
		text: "The original key still controls the HyperEVM side of the address, and CoreWriter does not work for multi-sig users.",
	},
];
