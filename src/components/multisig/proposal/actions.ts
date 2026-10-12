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
	type Policy,
	type Proposal,
	readiness,
	signEnvelope,
	signProposal,
} from "@hl-tools/core";
import { errorMessage } from "#/hooks/useHyperliquid";
import { checkBeforeSubmit } from "../model/sendCheck";
import { type Stage, shortAddress } from "../model/stage";
import { submitEnvelope, withReceipt } from "../model/submit";
import type { WalletSigner } from "../useWalletSigner";
import type { ProposalDoc } from "./useProposalDoc";

export type Outcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly issues: readonly Issue[] };

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
	if (!got.ok) return fail(got.error);
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
	  };

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
	readonly doc: Pick<ProposalDoc, "store" | "refresh" | "relay">;
	readonly mark: (id: StepId, state: StepState) => void;
}): Promise<FinaliseResult> {
	const { proposal, stage, wallet, doc, mark } = i;
	const { network, multiSigUser } = proposal.payload;
	const stop = (step: StepId, issues: readonly Issue[]): FinaliseResult => {
		mark(step, "failed");
		return { ok: false, step, issues };
	};
	const chain = stage.requiredChain;
	if (!chain) return stop("envelope", problem("execute", "No signing chain."));

	if (doc.relay.known) {
		const row = await doc.refresh();
		if (row?.ending) {
			const first = stage.executeAddsSignature ? "inner" : "envelope";
			return stop(
				first,
				problem(
					"relay.proposal_closed",
					row.ending.kind === "withdrawn"
						? `The proposer ${shortAddress(row.ending.endedBy)} withdrew this proposal a moment ago. Nothing was signed or submitted.`
						: "This proposal was declined. Nothing was signed or submitted.",
				),
			);
		}
	}

	// Would Hyperliquid refuse it as things stand? A refusal uses up the
	// proposal's number for good, so the treasury's mode and balances and the
	// receiver are read again now, before any wallet prompt.
	const client = infoClient(network);
	const refusals = await checkBeforeSubmit(proposal.payload, {
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
	});
	if (refusals.length > 0) {
		return stop(
			stage.executeAddsSignature ? "inner" : "envelope",
			refusals.map((r) => ({
				code: `preflight.${r.code}`,
				severity: "error" as const,
				message: `Nothing was signed or sent: Hyperliquid would refuse this as things stand. ${r.message}`,
			})),
		);
	}

	let current = proposal;
	if (stage.executeAddsSignature) {
		mark("inner", "active");
		const signed = await signInner(current, stage, wallet, doc.store);
		if (!signed.outcome.ok) return stop("inner", signed.outcome.issues);
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

	mark("submit", "active");
	try {
		const sent = await submitEnvelope(network, request, outer.signature);
		// the receipt is kept whether the chain accepted or not; the page explains it.
		// With the relay in use the result is recorded there, sharing the proposal first
		// if it came from a link or a file.
		await doc.store(withReceipt(current, sent.receipt), { publish: true });
		const accepted = sent.explained.id === "ok";
		mark("submit", accepted ? "done" : "failed");
		return { ok: true, accepted };
	} catch (e) {
		return stop(
			"submit",
			problem(
				"execute",
				`The request did not reach Hyperliquid: ${errorMessage(e)} Nothing was submitted; it is safe to try again.`,
			),
		);
	}
}
