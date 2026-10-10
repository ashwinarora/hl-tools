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
	type Policy,
	type Proposal,
	type Readiness,
} from "@hl-tools/core";
import { chainIdToNumber, chainLabel } from "./chains";
import { describeWindow, type WindowInfo } from "./nonce";

export type WalletRole =
	| "disconnected"
	| "outsider"
	| "signer"
	| "finaliser"
	| "signer-finaliser";

export type Phase =
	| "judging"
	| "unsupported"
	| "submitted"
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
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function policyChanged(p: Proposal, live: Policy | null): boolean {
	const then = p.meta.policyAtCreation;
	if (!then || !live) return false;
	return (
		then.threshold !== live.threshold ||
		then.authorizedUsers.length !== live.authorizedUsers.length ||
		then.authorizedUsers.some((a) => !live.authorizedUsers.includes(a))
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

	let phase: Phase;
	let headline: string;
	let detail: string;
	if (accepted) {
		phase = "submitted";
		headline = "Submitted · accepted by Hyperliquid";
		detail = `Submitted ${new Date(p.receipt?.submittedAt ?? 0).toISOString()}. Nothing more to sign.`;
	} else if (input.ended?.kind === "withdrawn") {
		phase = "withdrawn";
		headline = `Withdrawn by the proposer, ${shortAddress(input.ended.by)}`;
		detail = `Signatures already given remain valid on chain until the window closes (${window.text}), and only the finaliser ${shortAddress(leader)} could still submit it.`;
	} else if (input.ended?.kind === "declined") {
		phase = "declined";
		headline = `Declined by the finaliser, ${shortAddress(input.ended.by)}`;
		detail =
			"It will not be submitted. Re-propose it with a different finaliser if it is still wanted.";
	} else if (p.meta.kind === "l1") {
		phase = "unsupported";
		headline = "An L1 action: inspect only";
		detail =
			"Orders, cancels and other L1 actions are outside the signer. It can be read and checked here, not signed.";
	} else if (unsignedFields) {
		phase = "unsupported";
		headline = "This document sets a vault address or an expiry";
		detail =
			"Signers of a user-signed action do not sign those two fields, so anyone could have added them. This page will not sign or submit it.";
	} else if (!r) {
		phase = "judging";
		headline = "Checking signatures…";
		detail = "Recovering every signer and fetching the live signer set.";
	} else if (r.status === "expired") {
		phase = "expired";
		headline = "Expired";
		detail = `The signing window ${window.text}. Re-propose it with a fresh nonce; collected signatures do not carry over.`;
	} else if (r.status === "not-multisig") {
		phase = "not-multisig";
		headline = `Not a multi-sig on ${p.payload.network}`;
		detail = `${shortAddress(p.payload.multiSigUser)} has no signer set there, so no signature can count.`;
	} else if (r.status === "unknown") {
		phase = "unknown";
		headline = "Signer set not loaded";
		detail =
			"The signer set could not be fetched, so nothing can be judged yet.";
	} else if (r.status === "not-yet-valid") {
		phase = "not-yet-valid";
		headline = `Not submittable yet · ${r.have} of ${r.need}`;
		detail = `The signing window ${window.text}. Signers can sign in the meantime.`;
	} else if (r.status === "ready") {
		phase = "ready";
		headline = `Ready · ${r.have} of ${r.need} signatures`;
		detail = isLeader
			? `You are the finaliser: submit it when you are ready · ${window.text}.`
			: `The finaliser ${shortAddress(leader)} signs the envelope and submits · ${window.text}.`;
	} else {
		phase = "collecting";
		headline = `Collecting signatures · ${r.have} of ${r.need}`;
		const who = r.missing.map(shortAddress).join(", ");
		detail = `${who ? `${who} can still sign · ` : ""}${window.text}.`;
	}

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
	};
}
