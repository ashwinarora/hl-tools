/**
 * Where a proposal stands for the wallet looking at it: what phase it is in,
 * what role the wallet has, and whether "sign" and "sign and submit" are
 * allowed, with the reason when they are not. Pure: the page feeds it the
 * document, the judgement and the connected wallet.
 */
import {
	type Address,
	type ErrorExplanation,
	explainExchangeError,
	type Hex,
	isoTime,
	type Network,
	numberSpent,
	type PlainObject,
	type Policy,
	type Proposal,
	parseSignersString,
	type Readiness,
	vaultActionOf,
} from "@hl-tools/core";
import { unmeasuredSwitch } from "./modeSwitch";
import { describeWindow, type WindowInfo } from "./nonce";
import {
	joinParts,
	type Part,
	partsText,
	say,
	shortAddress,
	whoPart,
} from "./parts";
import {
	blockedText,
	type Objection,
	type Standing,
	saidNo,
	standing,
} from "./relay/positions";
import { switchSentence } from "./selfTreasury";
import { CODE_COPY, isVaultAction, signingChainOf } from "./signingNetwork";

export { shortAddress };

/**
 * `unknown`: a wallet is connected, but the signer set has not been read yet.
 * `treasury`: the wallet is the treasury account itself, whose own key cannot
 * act for it.
 */
export type WalletRole =
	| "disconnected"
	| "unknown"
	| "outsider"
	| "treasury"
	| "signer"
	| "finaliser"
	| "signer-finaliser";

export type Phase =
	| "judging"
	| "unsupported"
	| "submitted"
	| "carried-out"
	| "in-effect"
	| "closed"
	| "stuck"
	| "overtaken"
	| "refused"
	| "cannot-pass"
	| "finaliser-no"
	| "withdrawn"
	| "declined"
	| "expired"
	| "not-yet-valid"
	| "not-multisig"
	| "unknown"
	| "ready"
	| "collecting";

export interface StageInput {
	readonly proposal: Proposal;
	/** Null while signatures are being recovered. */
	readonly readiness: Readiness | null;
	/** Null until the signer set is known; an empty set when the user is not a multi-sig. */
	readonly policy: Policy | null;
	readonly wallet: string | null;
	readonly walletChainId: number | null;
	readonly now?: number;
	/**
	 * Set when the proposal was ended on the relay: withdrawn by its proposer or
	 * declined by its finaliser. A shared signal, not a cancellation on chain.
	 */
	readonly ended?: {
		readonly kind: "withdrawn" | "declined";
		readonly by: Address;
	} | null;
	/**
	 * Set when the proposal was carried out and its result was never reported
	 * here. By the relay: it closed the proposal after checking the
	 * transaction on Hyperliquid itself. By this page (`seenBy: "page"`): a
	 * staking step leaves no row in the ledger, so the page looked the
	 * transaction up in Hyperliquid's own list of the account's staking steps.
	 */
	readonly carriedOut?: {
		readonly txHash: Hex | null;
		/**
		 * "ledger": this page tied a row of Hyperliquid's ledger of the account
		 * to this proposal by its number, with the transaction read from
		 * Hyperliquid's explorer. That is Hyperliquid's own record, and it counts
		 * over whatever a receipt in the copy reports.
		 */
		readonly seenBy?: "relay" | "page" | "ledger";
	} | null;
	/**
	 * Hyperliquid's record of the account holds an action like this one that
	 * could not be compared with it (the explorer did not answer, or the action
	 * carries no number). Said beside a reported refusal: it may be carried out.
	 */
	readonly likeOnRecord?: boolean;
	/** The relay closed the proposal in a way this version of the page does not know. */
	readonly closedUnknown?: boolean;
	/**
	 * A newer action of the same ordered kind (a USDC send) has been carried out
	 * for this treasury: Hyperliquid will refuse this one. See the core's
	 * `overtakenBy`. A recorded attempt that Hyperliquid refused for that reason
	 * says the same, and is read from the receipt here.
	 */
	readonly overtaken?: boolean;
	/**
	 * The network selected in the header. When given and different from the
	 * proposal's, nothing can be signed until the reader switches: what gets
	 * signed is decided by the proposal, and the reader must be looking at it.
	 */
	readonly headerNetwork?: Network;
	/**
	 * Who said no, as the relay holds it. A no is an objection the others see,
	 * not an ending; it is counted here against the live signer set, like a
	 * signature.
	 */
	readonly objections?: readonly Objection[];
	/**
	 * Hyperliquid would refuse the action before this moment (unix ms): an
	 * unstake while the stake it takes from is still locked. Signing is open
	 * all the same; only submitting waits.
	 */
	readonly heldUntil?: number | null;
	/**
	 * This build has the signing network (model/signingNetwork.ts), so a vault
	 * action, which is signed as a code under it, can be signed here.
	 */
	readonly codeSigning?: boolean;
}

/**
 * What a submission that has to wait for a lockup takes from: a stake (an
 * unstake) or a vault deposit (a withdrawal from a vault).
 */
export const heldWhat = (action: PlainObject): "stake" | "deposit" =>
	vaultActionOf(action) ? "deposit" : "stake";

export interface Stage {
	readonly phase: Phase;
	readonly role: WalletRole;
	/** The connected wallet has a valid, counted signature in the document. */
	readonly hasSigned: boolean;
	/** The chain signers must sign under; null when the action does not state one. */
	readonly requiredChain: {
		readonly hex: Hex;
		readonly id: number;
		readonly label: string;
	} | null;
	readonly onRequiredChain: boolean;
	/**
	 * The action is signed as a code (a vault action): the wallet cannot show
	 * it, and the page shows the code it will show instead.
	 */
	readonly signsCode: boolean;
	readonly canSign: boolean;
	readonly signReason: string | null;
	readonly canExecute: boolean;
	/** True when the finaliser's own signature would complete the threshold. */
	readonly executeAddsSignature: boolean;
	readonly executeReason: string | null;
	/**
	 * Set while time is the only thing between the finaliser and Submit (see
	 * `StageInput.heldUntil`): the moment it opens.
	 */
	readonly opensAt: number | null;
	/**
	 * The lockup ends only after the proposal has closed: as things stand
	 * nobody can ever submit it. A sentence for every reader, while it is
	 * still open; null otherwise.
	 */
	readonly closesFirst: readonly Part[] | null;
	/** The live signer set differs from the one recorded when the proposal was made. */
	readonly policyChanged: boolean;
	/** The header is on the other network than the proposal: signing is refused until it is switched. */
	readonly networkMismatch: boolean;
	/** The explanation of a recorded submission that the chain rejected. */
	readonly failedAttempt: ErrorExplanation | null;
	readonly window: WindowInfo;
	/**
	 * Who of the live signers said no, and whether the proposal can still go
	 * ahead as things stand. Null until the signer set is known.
	 */
	readonly standing: Standing | null;
	/** The connected wallet's own position is a no. */
	readonly saidNo: boolean;
	readonly headline: string;
	readonly detail: string;
	/** The two sentences with their addresses and moments marked (see model/parts). */
	readonly headlineParts: readonly Part[];
	readonly detailParts: readonly Part[];
}

function policyChanged(p: Proposal, live: Policy | null): boolean {
	const then = p.meta.policyAtCreation;
	if (!then || !live) return false;
	return (
		then.threshold !== live.threshold ||
		then.authorizedUsers.length !== live.authorizedUsers.length ||
		then.authorizedUsers.some((a) => !live.authorizedUsers.includes(a))
	);
}

/**
 * The finaliser was one of the signers when the proposal was made and is not
 * one any more. Hyperliquid accepts an envelope only from a current signer, so
 * nobody can submit it. (A finaliser that never was a signer is left alone:
 * a document made elsewhere may name a signer's funded API wallet, which can
 * submit.)
 */
export function finaliserLeft(p: Proposal, live: Policy | null): boolean {
	const then = p.meta.policyAtCreation;
	const leader = p.payload.outerSigner;
	if (!then || !live || live.threshold === 0) return false;
	return (
		then.authorizedUsers.includes(leader) &&
		!live.authorizedUsers.includes(leader)
	);
}

/**
 * Hyperliquid took this proposal's envelope and refused it. That uses up the
 * proposal's number for its finaliser, whatever the reason was (measured: see
 * the core's `numberSpent`), so it can never be sent again: it has to be
 * proposed again.
 */
export function refusedForGood(p: Proposal): boolean {
	return (
		!!p.receipt &&
		numberSpent(explainExchangeError(p.receipt.response, p.receipt.httpStatus))
	);
}

/**
 * A change of signers whose result is what Hyperliquid reports now: the signer
 * list it asks for, or (for the conversion back) no signer list at all. Then
 * it has been carried out, whoever recorded that and whoever did not. Without
 * this a co-signer opening it from a link would see its signatures judged
 * against the signers it installed, and read "cannot be finished".
 */
export function changeInEffect(p: Proposal, live: Policy | null): boolean {
	if (p.payload.action.type !== "convertToMultiSigUser" || !live) return false;
	const asked = parseSignersString(p.payload.action.signers);
	if (asked.revert) return live.authorizedUsers.length === 0;
	if (!asked.set) return false;
	return (
		live.threshold === asked.set.threshold &&
		live.authorizedUsers.length === asked.set.authorizedUsers.length &&
		asked.set.authorizedUsers.every((a) => live.authorizedUsers.includes(a))
	);
}

/** A moment as a part: shown in the reader's own zone. */
const heldWhen = (at: number): Part => ({
	// a lockup's end comes from Hyperliquid's feed as it is: never a throw
	text: isoTime(at).slice(0, 16).replace("T", " "),
	when: at,
});

export function deriveStage(input: StageInput): Stage {
	const { proposal: p, readiness: r, policy } = input;
	const now = input.now ?? Date.now();
	const wallet = input.wallet ? input.wallet.toLowerCase() : null;
	const leader = p.payload.outerSigner;
	const window = describeWindow(p.payload.nonce, now);
	const lockedUntil =
		input.heldUntil != null && input.heldUntil > now ? input.heldUntil : null;
	// A lockup can be made longer (by adding to what is locked), never
	// shorter: one that ends after the window does is a certainty, not a guess.
	const outlasts =
		lockedUntil !== null && lockedUntil >= window.validUntil
			? say`The ${heldWhat(p.payload.action)} this takes from is locked until ${heldWhen(lockedUntil)}, and this proposal closes before that, on ${heldWhen(window.validUntil)}. It cannot be submitted in time: its proposer can withdraw it and make it again later.`
			: null;

	const isLeader = wallet !== null && wallet === leader;
	const isSigner =
		wallet !== null &&
		!!policy &&
		policy.authorizedUsers.some((a) => a === wallet);
	const role: WalletRole =
		wallet === null
			? "disconnected"
			: isSigner
				? isLeader
					? "signer-finaliser"
					: "signer"
				: isLeader
					? "finaliser"
					: // "not a signer" is a verdict: not before the signer set is known
						!policy
						? "unknown"
						: wallet === p.payload.multiSigUser &&
								policy.authorizedUsers.length > 0
							? "treasury"
							: "outsider";
	const hasSigned =
		wallet !== null && !!r && r.counted.some((a) => a === wallet);

	const requiredChain = signingChainOf(p.payload.action);
	const onRequiredChain =
		requiredChain !== null && input.walletChainId === requiredChain.id;

	const receipt = p.receipt
		? explainExchangeError(p.receipt.response, p.receipt.httpStatus)
		: null;
	const accepted = receipt?.id === "ok";
	const failedAttempt = receipt && !accepted ? receipt : null;
	const unsignedFields =
		p.meta.kind === "user-signed" &&
		(p.payload.vaultAddress !== null || p.payload.expiresAfter !== null);

	const position =
		policy && policy.authorizedUsers.length > 0
			? standing({
					signers: policy.authorizedUsers,
					threshold: policy.threshold,
					finaliser: leader,
					objections: input.objections ?? [],
				})
			: null;
	const iSaidNo = !!position && saidNo(position, wallet as Address | null);
	const held = position?.blocked
		? blockedText({
				standing: position,
				finaliser: leader,
				me: wallet as Address | null,
				lapsesAt: window.validUntil,
				now,
			})
		: null;

	const who = whoPart;
	let phase: Phase;
	let head: Part[];
	let body: Part[];
	if (accepted) {
		const at = p.receipt?.submittedAt ?? 0;
		phase = "submitted";
		head = say`Submitted · accepted by Hyperliquid`;
		body = say`Submitted ${{ text: isoTime(at), when: at }}. Nothing more to sign.`;
	} else if (input.carriedOut) {
		phase = "carried-out";
		// said this way because the submitter may well have used this page, signed out
		head = say`Carried out, not reported here`;
		body =
			input.carriedOut.seenBy === "ledger"
				? failedAttempt
					? // a receipt's answer is outside its signature: the record decides
						say`Hyperliquid's own record of this account holds this action, under this proposal's number: it was carried out. The copy opened here reports a refusal; the record is what counts. Nothing more to sign, and nothing to propose again.`
					: say`Hyperliquid's own record of this account holds this action, under this proposal's number: it was carried out, but its result was never reported here. Nothing more to sign.`
				: input.carriedOut.seenBy === "page"
					? say`Hyperliquid's own list of this account's staking steps holds this action, under this proposal's number: it was carried out, but its result was never reported here. Nothing more to sign.`
					: say`Hyperliquid carried this action out, but its result was never reported here: it was submitted while signed out, or some other way. The relay checked the transaction itself. Nothing more to sign.`;
		if (input.carriedOut.seenBy === "ledger" && failedAttempt)
			head = say`Carried out · the refusal reported here is not Hyperliquid's record`;
	} else if (input.closedUnknown) {
		phase = "closed";
		head = say`Closed`;
		body = say`The relay marks this proposal as closed in a way this version of the page does not know. Reload the page to get the current one.`;
	} else if (input.ended?.kind === "withdrawn") {
		phase = "withdrawn";
		head = say`Withdrawn by the proposer, ${who(input.ended.by)}`;
		body = say`Signatures already given remain valid on chain until the window closes (${window.parts}), and only the finaliser ${who(leader)} could still submit it.`;
	} else if (input.ended?.kind === "declined") {
		phase = "declined";
		head = say`Declined by the finaliser, ${who(input.ended.by)}`;
		body = say`It will not be submitted. Re-propose it with a different finaliser if it is still wanted.`;
	} else if (changeInEffect(p, policy)) {
		// before anything about signatures: they would be counted against the
		// signers this very proposal put in place
		phase = "in-effect";
		head = say`In effect`;
		body =
			policy && policy.authorizedUsers.length === 0
				? say`Hyperliquid reports no signers for this account any more: it is a normal account again, as this proposal asks. Nothing more to sign.`
				: say`The treasury's signers on Hyperliquid are the ones this proposal asks for. Nothing more to sign.`;
	} else if (p.meta.kind === "l1" && !isVaultAction(p.payload)) {
		phase = "unsupported";
		head = say`An L1 action: inspect only`;
		body = say`Orders, cancels and other L1 actions are outside the signer. It can be read and checked here, not signed.`;
	} else if (p.meta.kind === "l1" && !input.codeSigning) {
		phase = "unsupported";
		head = say`${CODE_COPY.absentHead}`;
		body = say`${CODE_COPY.absentBody}`;
	} else if (unsignedFields) {
		phase = "unsupported";
		head = say`This document sets a vault address or an expiry`;
		body = say`Signers of a user-signed action do not sign those two fields, so anyone could have added them. This page will not sign or submit it.`;
	} else if (unmeasuredSwitch(p.payload.action) !== null && !failedAttempt) {
		// before anyone signs: signatures cannot make it go through
		phase = "unsupported";
		head = say`A switch to an account mode this page was not tested with`;
		body = say`${unmeasuredSwitch(p.payload.action) as string}`;
	} else if (
		failedAttempt &&
		failedAttempt.id !== "nonce-used" &&
		numberSpent(failedAttempt)
	) {
		// before anything about signatures: no signature changes it any more
		phase = "refused";
		head = say`Refused by Hyperliquid · cannot be sent again`;
		body =
			failedAttempt.id === "nonce-duplicate"
				? // the number was used before this attempt: by a submission that was
					// refused, or by one that went through and whose answer never got here
					say`Hyperliquid answered "duplicate nonce": this proposal's number had already been used by an earlier submission. If that one went through, the action is carried out already. Look at the treasury's record on Hyperliquid before proposing it again.`
				: input.likeOnRecord
					? // the answer in a receipt is what its finaliser wrote down, and
						// the record holds something like this action: never "propose again"
						say`This copy reports that Hyperliquid refused it. Hyperliquid's record of the account shows an action like this one, which could not be compared with it, so it may be carried out all the same. Look at the treasury's record on Hyperliquid before proposing it again: a new proposal is carried out whether or not this one was.`
					: say`Hyperliquid refused this proposal when it was submitted, and a refused submission still uses up the proposal's number. Sending it again would only be answered "duplicate nonce". Propose it again: it gets a new number, and the signers sign once more. The refusal is what the finaliser's page recorded: if in doubt, look at the treasury's record on Hyperliquid first.`;
	} else if (!r) {
		phase = "judging";
		head = say`Checking signatures…`;
		body = say`Recovering every signer and fetching the live signer set.`;
	} else if (r.status === "expired") {
		phase = "expired";
		head = say`Expired`;
		body = say`The signing window ${window.parts}. Re-propose it with a fresh nonce; collected signatures do not carry over.`;
	} else if (input.overtaken || failedAttempt?.id === "nonce-used") {
		// before "ready": signatures change nothing once Hyperliquid will refuse it
		phase = "overtaken";
		head = say`Cannot be submitted any more`;
		body = say`Hyperliquid takes a treasury's USDC sends in the order they were proposed, and a newer one has been carried out. This one would be refused. Propose it again: it gets a new number, and the signers sign once more.`;
	} else if (r.status === "not-multisig") {
		phase = "not-multisig";
		head = say`Not a multi-sig on ${p.payload.network}`;
		body = say`${who(p.payload.multiSigUser)} has no signer set there, so no signature can count.`;
	} else if (r.status === "unknown") {
		phase = "unknown";
		head = say`Signer set not loaded`;
		body = say`The signer set could not be fetched, so nothing can be judged yet.`;
	} else if (r.status === "not-yet-valid") {
		phase = "not-yet-valid";
		head = say`Not submittable yet · ${String(r.have)} of ${String(r.need)}`;
		body = say`The signing window ${window.parts}. Signers can sign in the meantime.`;
	} else if (finaliserLeft(p, policy)) {
		// counted before "ready": enough signatures change nothing when nobody can submit
		phase = "stuck";
		head = say`Cannot be finished`;
		body = say`Only the finaliser can submit a proposal, and ${isLeader ? "your wallet" : who(leader)} is no longer one of this treasury's signers. Withdraw it and propose it again with another finaliser.`;
	} else if (position?.blocked && held) {
		// Before "ready" and "collecting": as things stand it goes nowhere. It
		// stays open all the same: a no can be taken back.
		phase = position.blocked;
		head = held.headline;
		body = held.detail;
	} else if (r.status === "ready") {
		phase = "ready";
		head = say`Ready · ${String(r.have)} of ${String(r.need)} signatures`;
		body = outlasts
			? outlasts
			: lockedUntil
				? say`${isLeader ? "You are the finaliser. It" : say`The finaliser ${who(leader)} submits it. It`} can be submitted from ${heldWhen(lockedUntil)}: the ${heldWhat(p.payload.action)} it takes from is locked until then · ${window.parts}.`
				: isLeader
					? say`You are the finaliser: submit it when you are ready · ${window.parts}.`
					: say`The finaliser ${who(leader)} signs the envelope and submits · ${window.parts}.`;
	} else {
		phase = "collecting";
		head = say`Collecting signatures · ${String(r.have)} of ${String(r.need)}`;
		const missing = joinParts(
			// the reader is "you", first
			[...r.missing]
				// somebody who said no is not waited for: their position is known
				// (and stands two lines further down the page)
				.filter((a) => !position?.objected.some((o) => o.signer === a))
				.sort((a, b) => Number(b === wallet) - Number(a === wallet))
				.map((a) => [a === wallet ? { text: "you", who: a } : who(a)]),
			", ",
		);
		body = say`${missing.length ? say`${missing} can still sign · ` : ""}${window.parts}.`;
	}
	const headline = partsText(head);
	const detail = partsText(body);

	const networkMismatch =
		input.headerNetwork !== undefined &&
		input.headerNetwork !== p.payload.network;
	const wrongNetwork = `This proposal is for ${p.payload.network}; the header is on ${input.headerNetwork}. Switch the header to ${p.payload.network} to continue.`;

	// A proposal held up by a no is still open: the others can sign in the
	// meantime, and the one who said no can sign instead (it replaces the no).
	const signable =
		phase === "collecting" ||
		phase === "ready" ||
		phase === "not-yet-valid" ||
		phase === "cannot-pass" ||
		phase === "finaliser-no";
	const signReason =
		phase === "judging"
			? "Checking signatures…"
			: !signable
				? headline
				: networkMismatch
					? wrongNetwork
					: role === "disconnected"
						? "Connect a wallet to sign."
						: role === "treasury"
							? partsText(switchSentence(policy?.authorizedUsers ?? []))
							: !isSigner
								? `${shortAddress(wallet ?? "")} is not in the signer set.`
								: hasSigned
									? "You signed this."
									: // the finaliser takes the no back first; submitting is its own step
										isLeader && iSaidNo
										? "You said no to this."
										: null;
	const canSign = signReason === null;

	const need = r?.need ?? null;
	const executeAddsSignature =
		phase === "collecting" &&
		isSigner &&
		!hasSigned &&
		need !== null &&
		(r?.have ?? 0) + 1 >= need;
	const executable = phase === "ready" || executeAddsSignature;
	const executeReason =
		phase === "judging"
			? "Checking signatures…"
			: phase === "collecting" && !executeAddsSignature
				? `${r?.have ?? 0} of ${need ?? "?"} signatures so far.`
				: !executable
					? headline
					: networkMismatch
						? wrongNetwork
						: role === "disconnected"
							? "Connect the finaliser's wallet to submit."
							: !isLeader
								? `Only the finaliser ${shortAddress(leader)} can submit.`
								: lockedUntil
									? `The ${heldWhat(p.payload.action)} this takes from is still locked, and Hyperliquid would refuse it until the lockup has ended.`
									: null;
	const canExecute = executeReason === null;
	// time is all that is in the way: the page shows Submit, switched off, with the moment
	const opensAt =
		lockedUntil && executable && !networkMismatch && isLeader
			? lockedUntil
			: null;

	const closesFirst =
		phase === "collecting" || phase === "ready" ? outlasts : null;

	return {
		phase,
		role,
		hasSigned,
		requiredChain,
		onRequiredChain,
		signsCode: p.meta.kind === "l1",
		canSign,
		signReason,
		canExecute,
		executeAddsSignature: canExecute && executeAddsSignature,
		executeReason,
		opensAt,
		closesFirst,
		policyChanged: policyChanged(p, policy),
		networkMismatch,
		failedAttempt,
		window,
		standing: position,
		saidNo: iSaidNo,
		headline,
		detail,
		headlineParts: head,
		detailParts: body,
	};
}
