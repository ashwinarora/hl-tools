/**
 * The two things a wallet does to a proposal, as plain async functions the
 * page drives: add this signer's inner signature, and (the finaliser only)
 * build the envelope from the verified signatures, sign it and submit it.
 */
import {
	buildEnvelope,
	classifySignatures,
	type Issue,
	infoClient,
	type Network,
	type Policy,
	type Proposal,
	readiness,
	signEnvelope,
	signProposal,
} from "@hl-tools/core";
import { errorMessage } from "#/hooks/useHyperliquid";
import {
	checkBeforeSubmit,
	checkMoveBeforeSubmit,
	type SendReads,
} from "../model/sendCheck";
import { envelopeChainOf } from "../model/signingNetwork";
import { type Stage, shortAddress } from "../model/stage";
import { submitEnvelope, withReceipt } from "../model/submit";
import type { WalletSigner } from "../useWalletSigner";
import type { ProposalDoc } from "./useProposalDoc";

export type Outcome =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly issues: readonly Issue[];
			/** The wallet does not have the signing network yet: the page offers to add it. */
			readonly needsNetwork?: true;
	  };

const problem = (code: string, message: string): Issue[] => [
	{ code, severity: "error", message },
];

/** One signer's inner signature. The wallet shows the struct; the page checks who signed. */
export async function signInner(
	proposal: Proposal,
	stage: Stage,
	wallet: WalletSigner,
	store: ProposalDoc["store"],
): Promise<{ outcome: Outcome; proposal: Proposal }> {
	const fail = (message: string): { outcome: Outcome; proposal: Proposal } => ({
		outcome: { ok: false, issues: problem("wallet", message) },
		proposal,
	});
	if (!stage.requiredChain)
		return fail("This action does not state a signing chain.");
	const got = await wallet.signerFor(stage.requiredChain.hex);
	if (!got.ok)
		return got.needsNetwork
			? {
					outcome: {
						ok: false,
						issues: problem("wallet", got.error),
						needsNetwork: true,
					},
					proposal,
				}
			: fail(got.error);
	const signed = await signProposal(proposal, got.signer, {
		expectedSigner: wallet.address ?? undefined,
	});
	if (!signed.signature)
		return { outcome: { ok: false, issues: signed.issues }, proposal };
	// stored through a merge: one signature per signer, this one first
	const stored = await store({ ...proposal, signatures: [signed.signature] });
	return { outcome: { ok: true }, proposal: stored.proposal };
}

export type StepId = "inner" | "envelope" | "submit";
export type StepState = "todo" | "active" | "done" | "failed";

export type FinaliseResult =
	| { readonly ok: true; readonly accepted: boolean }
	| {
			readonly ok: false;
			readonly step: StepId;
			readonly issues: readonly Issue[];
			/** The wallet does not have the signing network yet: the page offers to add it. */
			readonly needsNetwork?: true;
	  };

/** What the check before submit is handed: every figure read from Hyperliquid now, never from a cache. */
export function submitReads(network: Network): SendReads {
	const client = infoClient(network);
	return {
		mode: async (user) =>
			(await client.userAbstraction(user, { fresh: true })).data,
		withdrawable: async (user) =>
			(await client.clearinghouseState(user, { fresh: true })).data
				.withdrawable,
		spot: async (user) =>
			(await client.spotClearinghouseState(user, { fresh: true })).data
				.balances,
		role: async (address) =>
			(await client.userRole(address, { fresh: true })).data,
		signers: async (user) =>
			(await client.multiSigSigners(user, { fresh: true })).data
				?.authorizedUsers ?? null,
		staking: async (user) => {
			const [summary, delegations] = await Promise.all([
				client.delegatorSummary(user, { fresh: true }),
				client.delegations(user, { fresh: true }),
			]);
			return { summary: summary.data, delegations: delegations.data };
		},
		validators: async () =>
			(await client.validatorSummaries({ fresh: true })).data,
		clock: async () => (await client.exchangeTime()).data,
		agents: async (user) =>
			(await client.apiWallets(user, { fresh: true })).data,
		open: async (user) => {
			const [perp, orders] = await Promise.all([
				client.clearinghouseState(user, { fresh: true }),
				client.openOrders(user, { fresh: true }),
			]);
			return {
				positions: perp.data.assetPositions.length,
				orders: orders.data.length,
			};
		},
	};
}

type Doc = Pick<ProposalDoc, "store" | "refresh" | "relay">;
type Failure = {
	readonly ok: false;
	readonly step: StepId;
	readonly issues: readonly Issue[];
	/** The wallet does not have the signing network yet: the page offers to add it. */
	readonly needsNetwork?: true;
};

/** What was signed for one proposal and is ready to be posted. */
interface Signed {
	readonly current: Proposal;
	readonly request: ReturnType<typeof buildEnvelope>["request"];
	readonly signature: NonNullable<
		Awaited<ReturnType<typeof signEnvelope>>["signature"]
	>;
}

/** The first thing the finaliser's wallet is asked for: their own signature if it completes the threshold, else the envelope. */
const firstStep = (stage: Stage): StepId =>
	stage.executeAddsSignature ? "inner" : "envelope";

/**
 * Asked of the relay once more before anything is signed: nothing is done on
 * the strength of what the page knew a moment ago. The reason not to go on,
 * or null.
 */
async function closedMeanwhile(doc: Doc): Promise<Issue[] | null> {
	if (!doc.relay.known) return null;
	const row = await doc.refresh();
	if (!row?.ending) return null;
	return problem(
		"relay.proposal_closed",
		row.ending.kind === "withdrawn"
			? `The proposer ${shortAddress(row.ending.endedBy)} withdrew this proposal a moment ago. Nothing was signed or submitted.`
			: "This proposal was declined. Nothing was signed or submitted.",
	);
}

/** What the check before submit found, as the page says it. */
const refused = (refusals: readonly { code: string; message: string }[]) =>
	refusals.map((r) => ({
		code: `preflight.${r.code}`,
		severity: "error" as const,
		message: `Nothing was signed or sent: Hyperliquid would refuse this as things stand. ${r.message}`,
	}));

/**
 * The finaliser's signatures for one proposal: their own inner signature
 * first if it is what completes the threshold, then the envelope over the
 * verified signatures, counted against the signer set the chain reports now.
 * Nothing is sent.
 */
async function signToSubmit(i: {
	readonly proposal: Proposal;
	readonly stage: Stage;
	readonly wallet: WalletSigner;
	readonly doc: Doc;
	readonly mark: (id: StepId, state: StepState) => void;
}): Promise<{ readonly ok: true; readonly signed: Signed } | Failure> {
	const { proposal, stage, wallet, doc, mark } = i;
	const { network, multiSigUser } = proposal.payload;
	const stop = (step: StepId, issues: readonly Issue[]): Failure => {
		mark(step, "failed");
		return { ok: false, step, issues };
	};
	// The finaliser's own signature is the readable kind under an ordinary
	// chain, also when the action inside is a code. Read before anything is
	// signed: the wallet's chain as it was when the click was made.
	const chain = envelopeChainOf(
		proposal.payload.action,
		network,
		wallet.chainId,
	);
	if (!chain) return stop("envelope", problem("execute", "No signing chain."));

	let current = proposal;
	if (stage.executeAddsSignature) {
		mark("inner", "active");
		const signed = await signInner(current, stage, wallet, doc.store);
		if (!signed.outcome.ok)
			return {
				...stop("inner", signed.outcome.issues),
				...(signed.outcome.needsNetwork ? { needsNetwork: true as const } : {}),
			};
		current = signed.proposal;
		mark("inner", "done");
	}

	mark("envelope", "active");
	let policy: Policy;
	try {
		// not the answer of a moment ago: what the chain says now
		const observed = await infoClient(network).multiSigSigners(multiSigUser, {
			fresh: true,
		});
		policy = observed.data ?? {
			authorizedUsers: [],
			threshold: 0,
			observedAt: observed.observedAt,
		};
	} catch (e) {
		return stop(
			"envelope",
			problem(
				"execute",
				`The signer set could not be read: ${errorMessage(e)}`,
			),
		);
	}
	const classified = await classifySignatures(current, policy);
	const ready = readiness(current, policy, classified);
	if (ready.status !== "ready") {
		return stop(
			"envelope",
			ready.issues.length
				? ready.issues
				: problem(
						"execute",
						`Not ready: ${ready.have} of ${ready.need ?? "?"} signatures count against the current signer set.`,
					),
		);
	}
	const { request } = buildEnvelope(current, {
		signatureChainId: chain.hex,
		classified,
	});
	const got = await wallet.signerFor(chain.hex);
	if (!got.ok) return stop("envelope", problem("wallet", got.error));
	const outer = await signEnvelope(request, network, got.signer);
	if (!outer.signature) return stop("envelope", outer.issues);
	mark("envelope", "done");
	return { ok: true, signed: { current, request, signature: outer.signature } };
}

/**
 * One POST to Hyperliquid from this browser. Whatever the exchange answers
 * goes back into the document and, with the relay in use, onto the relay
 * (sharing the proposal first if it came from a link or a file).
 */
async function post(i: {
	readonly signed: Signed;
	readonly doc: Doc;
	readonly mark: (id: StepId, state: StepState) => void;
	/** In a move: how many steps Hyperliquid accepted before this one, in the same click. */
	readonly acceptedBefore?: number;
}): Promise<FinaliseResult> {
	const { signed, doc, mark } = i;
	mark("submit", "active");
	try {
		const sent = await submitEnvelope(
			signed.current.payload.network,
			signed.request,
			signed.signature,
		);
		// the receipt is kept whether the chain accepted or not; the page explains it
		await doc.store(withReceipt(signed.current, sent.receipt), {
			publish: true,
		});
		const accepted = sent.explained.id === "ok";
		mark("submit", accepted ? "done" : "failed");
		return { ok: true, accepted };
	} catch (e) {
		mark("submit", "failed");
		return {
			ok: false,
			step: "submit",
			issues: problem(
				"execute",
				// in a move, "nothing was submitted" would deny the step before it
				i.acceptedBefore
					? `The request for this step did not reach Hyperliquid: ${errorMessage(e)} The step before it was accepted and stands. This step was not submitted; it is safe to try again.`
					: `The request did not reach Hyperliquid: ${errorMessage(e)} Nothing was submitted; it is safe to try again.`,
			),
		};
	}
}

/**
 * The finaliser's part, in one sitting: their own inner signature first if it
 * is what completes the threshold, then the envelope over the verified
 * signatures, signed under the same chain, then one POST to Hyperliquid from
 * this browser. Whatever the exchange answers goes back into the document
 * and, with the relay in use, onto the relay.
 *
 * Nothing is posted on the strength of what the page knew a moment ago: the
 * relay is asked again whether the proposal was withdrawn or declined, and
 * the signer set is read again from the chain.
 */
export async function finalise(i: {
	readonly proposal: Proposal;
	readonly stage: Stage;
	readonly wallet: WalletSigner;
	readonly doc: Doc;
	readonly mark: (id: StepId, state: StepState) => void;
}): Promise<FinaliseResult> {
	const { proposal, stage, doc, mark } = i;
	const stop = (issues: readonly Issue[]): FinaliseResult => {
		mark(firstStep(stage), "failed");
		return { ok: false, step: firstStep(stage), issues };
	};
	const closed = await closedMeanwhile(doc);
	if (closed) return stop(closed);

	// Would Hyperliquid refuse it as things stand? A refusal uses up the
	// proposal's number for good, so the treasury's mode and balances and the
	// receiver are read again now, before any wallet prompt.
	const refusals = await checkBeforeSubmit(
		proposal.payload,
		submitReads(proposal.payload.network),
	);
	if (refusals.length > 0) return stop(refused(refusals));

	const signed = await signToSubmit(i);
	if (!signed.ok) return signed;
	return post({ signed: signed.signed, doc, mark });
}

/** One step of a move, as the finaliser's click needs it. */
export interface MoveStep {
	readonly proposal: Proposal;
	readonly stage: Stage;
	readonly doc: Doc;
}

export type MoveResult =
	/** `sent` steps were posted; `accepted` says whether the last of them went through. */
	| { readonly ok: true; readonly accepted: boolean; readonly sent: number }
	| {
			readonly ok: false;
			/** Which of the steps handed in. */
			readonly index: number;
			readonly step: StepId;
			readonly issues: readonly Issue[];
			/** How many were posted and accepted before this. */
			readonly sent: number;
			/** The wallet does not have the signing network yet: the page offers to add it. */
			readonly needsNetwork?: true;
	  };

/**
 * The finaliser's part for the steps of a move that are still to be sent, in
 * their order. Everything is asked first and all at once, so a move is not
 * left half done by a wallet prompt that was cancelled: the relay about each
 * step, Hyperliquid about the whole sequence (each step judged against what
 * the ones before leave behind), then every signature. Only then is the first
 * step posted, and each further one only once Hyperliquid has accepted the
 * one before.
 */
export async function finaliseMove(i: {
	readonly steps: readonly MoveStep[];
	readonly wallet: WalletSigner;
	readonly mark: (index: number, id: StepId, state: StepState) => void;
}): Promise<MoveResult> {
	const { steps, wallet, mark } = i;
	const [head] = steps;
	if (!head) return { ok: true, accepted: true, sent: 0 };
	const stop = (
		index: number,
		step: StepId,
		issues: readonly Issue[],
		sent = 0,
	): MoveResult => {
		mark(index, step, "failed");
		return { ok: false, index, step, issues, sent };
	};

	for (const [index, s] of steps.entries()) {
		const closed = await closedMeanwhile(s.doc);
		if (closed) return stop(index, firstStep(s.stage), closed);
	}
	const refusals = await checkMoveBeforeSubmit(
		steps.map((s) => s.proposal.payload),
		submitReads(head.proposal.payload.network),
	);
	if (refusals.length > 0)
		return stop(0, firstStep(head.stage), refused(refusals));

	const signed: Signed[] = [];
	for (const [index, s] of steps.entries()) {
		const one = await signToSubmit({
			...s,
			wallet,
			mark: (id, state) => mark(index, id, state),
		});
		if (!one.ok) return { ...one, index, sent: 0 };
		signed.push(one.signed);
	}

	let sent = 0;
	for (const [index, s] of steps.entries()) {
		const answer = await post({
			signed: signed[index] as Signed,
			doc: s.doc,
			mark: (id, state) => mark(index, id, state),
			acceptedBefore: sent,
		});
		if (!answer.ok) return { ...answer, index, sent };
		sent += 1;
		// refused: the steps after it are not sent, and their numbers stay unused
		if (!answer.accepted) return { ok: true, accepted: false, sent };
	}
	return { ok: true, accepted: true, sent };
}

/**
 * One signer's signatures on the steps of a move they have not signed yet:
 * one wallet prompt each, in order. Stops at the first that is not given;
 * what was signed before it stays signed.
 */
export async function signMove(i: {
	readonly steps: readonly {
		readonly proposal: Proposal;
		readonly stage: Stage;
		readonly store: ProposalDoc["store"];
	}[];
	readonly wallet: WalletSigner;
}): Promise<{ readonly outcome: Outcome; readonly signed: number }> {
	let signed = 0;
	for (const s of i.steps) {
		if (!s.stage.canSign) continue;
		const one = await signInner(s.proposal, s.stage, i.wallet, s.store);
		if (!one.outcome.ok) return { outcome: one.outcome, signed };
		signed += 1;
	}
	return { outcome: { ok: true }, signed };
}
