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
	type Network,
	numberSpent,
	type Policy,
	type Proposal,
	parseSignersString,
	type Readiness,
} from "@hl-tools/core";
import { chainIdToNumber, chainLabel } from "./chains";
import { describeWindow, type WindowInfo } from "./nonce";
import {
	joinParts,
	type Part,
	partsText,
	say,
	shortAddress,
	whoPart,
} from "./parts";
import { switchSentence } from "./selfTreasury";

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
	 * Set when the relay closed the proposal as carried out outside the tool:
	 * it checked the transaction on Hyperliquid itself.
	 */
	readonly carriedOut?: { readonly txHash: Hex | null } | null;
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
}

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
	readonly canSign: boolean;
	readonly signReason: string | null;
	readonly canExecute: boolean;
	/** True when the finaliser's own signature would complete the threshold. */
	readonly executeAddsSignature: boolean;
	readonly executeReason: string | null;
	/** The live signer set differs from the one recorded when the proposal was made. */
	readonly policyChanged: boolean;
	/** The header is on the other network than the proposal: signing is refused until it is switched. */
	readonly networkMismatch: boolean;
	/** The explanation of a recorded submission that the chain rejected. */
	readonly failedAttempt: ErrorExplanation | null;
	readonly window: WindowInfo;
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

export function deriveStage(input: StageInput): Stage {
	const { proposal: p, readiness: r, policy } = input;
	const now = input.now ?? Date.now();
	const wallet = input.wallet ? input.wallet.toLowerCase() : null;
	const leader = p.payload.outerSigner;
	const window = describeWindow(p.payload.nonce, now);

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

	const chainId = chainIdToNumber(p.payload.action.signatureChainId);
	const requiredChain =
		chainId === null
			? null
			: {
					hex: String(p.payload.action.signatureChainId).toLowerCase() as Hex,
					id: chainId,
					label: chainLabel(chainId),
				};
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

	const who = whoPart;
	let phase: Phase;
	let head: Part[];
	let body: Part[];
	if (accepted) {
		const at = p.receipt?.submittedAt ?? 0;
		phase = "submitted";
		head = say`Submitted · accepted by Hyperliquid`;
		body = say`Submitted ${{ text: new Date(at).toISOString(), when: at }}. Nothing more to sign.`;
	} else if (input.carriedOut) {
		phase = "carried-out";
		head = say`Carried out outside this tool`;
		body = say`Hyperliquid carried this action out, but its result was never recorded here: it was submitted some other way. The relay checked the transaction itself. Nothing more to sign.`;
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
	} else if (p.meta.kind === "l1") {
		phase = "unsupported";
		head = say`An L1 action: inspect only`;
		body = say`Orders, cancels and other L1 actions are outside the signer. It can be read and checked here, not signed.`;
	} else if (unsignedFields) {
		phase = "unsupported";
		head = say`This document sets a vault address or an expiry`;
		body = say`Signers of a user-signed action do not sign those two fields, so anyone could have added them. This page will not sign or submit it.`;
	} else if (
		failedAttempt &&
		failedAttempt.id !== "nonce-used" &&
		numberSpent(failedAttempt)
	) {
		// before anything about signatures: no signature changes it any more
		phase = "refused";
		head = say`Refused by Hyperliquid · cannot be sent again`;
		body = say`Hyperliquid refused this proposal when it was submitted, and a refused submission still uses up the proposal's number. Sending it again would only be answered "duplicate nonce". Propose it again: it gets a new number, and the signers sign once more.`;
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
	} else if (r.status === "ready") {
		phase = "ready";
		head = say`Ready · ${String(r.have)} of ${String(r.need)} signatures`;
		body = isLeader
			? say`You are the finaliser: submit it when you are ready · ${window.parts}.`
			: say`The finaliser ${who(leader)} signs the envelope and submits · ${window.parts}.`;
	} else {
		phase = "collecting";
		head = say`Collecting signatures · ${String(r.have)} of ${String(r.need)}`;
		const missing = joinParts(
			// the reader is "you", first
			[...r.missing]
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

	const signable =
		phase === "collecting" || phase === "ready" || phase === "not-yet-valid";
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
								: null;
	const canExecute = executeReason === null;

	return {
		phase,
		role,
		hasSigned,
		requiredChain,
		onRequiredChain,
		canSign,
		signReason,
		canExecute,
		executeAddsSignature: canExecute && executeAddsSignature,
		executeReason,
		policyChanged: policyChanged(p, policy),
		networkMismatch,
		failedAttempt,
		window,
		headline,
		detail,
		headlineParts: head,
		detailParts: body,
	};
}
