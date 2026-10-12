import {
	type ActionDescription,
	type Address,
	describeAction,
	type Hex,
	type Issue,
	type Network,
	type Proposal,
	type Readiness,
} from "@hl-tools/core";
import { useCallback, useMemo } from "react";
import { documentToParsed } from "#/components/tools/multisig/model";
import { useJudgement } from "#/components/tools/multisig/useJudgement";
import type { ChainMatch } from "../live/useChainMatch";
import { CONTROL_REFRESH_MS } from "../live/useControl";
import { receiptOk } from "../model/history";
import type { StepView } from "../model/move";
import type { TreasuryRow } from "../model/relay/rows";
import { deriveStage, type Stage } from "../model/stage";
import { useExecutionReporter } from "../relay/useExecutionReporter";
import type { ProposalDoc } from "./useProposalDoc";
import { type StakingStep, useStakingStep } from "./useStakingStep";
import { useViewRecorder } from "./useViewRecorder";

/** A step of a move leaves its trace in the staking history, not in the ledger: there is no ledger row to match. */
const NO_LEDGER: ChainMatch = {
	of: () => ({ kind: "none" }),
	retry: () => undefined,
};

export interface MoveStepState extends StepView {
	readonly proposal: Proposal;
	readonly doc: ProposalDoc;
	readonly stage: Stage;
	readonly ready: Readiness | null;
	readonly state: ReturnType<typeof useJudgement>;
	readonly parsed: ReturnType<typeof documentToParsed>;
	readonly description: ActionDescription;
	readonly staking: StakingStep;
	/** The transaction that carried the step out, where one is known. */
	readonly tx: string | null;
}

/**
 * One step of a move, judged exactly as its own page would judge it: the
 * document re-hashed, each signature recovered, readiness counted against the
 * signer set the chain reports now, its lockup and its validator read from
 * Hyperliquid, and Hyperliquid's staking history asked whether the step has
 * been carried out already.
 */
export function useMoveStep(
	proposal: Proposal,
	issues: readonly Issue[],
	doc: ProposalDoc,
	shared: {
		readonly me: Address | null;
		readonly walletChainId: number | null;
		readonly header: Network;
		readonly clock: number;
		/** The relay's entry for the treasury, when it lists it for the signed-in wallet. */
		readonly listed: TreasuryRow | null;
		readonly relayWallet: Address | null;
	},
): MoveStepState {
	const parsed = useMemo(
		() => documentToParsed(proposal, issues),
		[proposal, issues],
	);
	const state = useJudgement(parsed, { refetchInterval: CONTROL_REFRESH_MS });
	const row = doc.relay.row;
	const status = row?.status ?? null;
	const settled =
		status === "accepted" || status === "carried_out" || status === "unknown";
	const staking = useStakingStep(
		proposal,
		!settled && !(proposal.receipt && receiptOk(proposal.receipt)),
	);
	const onRecord = staking.record;

	// "checking", not "signer set not loaded", while the set is on its way and
	// while signatures are re-counted against it (as on a proposal's own page)
	const waitingForPolicy =
		state.policyQuery.isPending ||
		(state.judgement?.policy === null && state.policy !== null);
	const ready = waitingForPolicy ? null : (state.judgement?.ready ?? null);
	const stage = deriveStage({
		proposal,
		readiness: ready,
		policy: state.policy,
		wallet: shared.me,
		walletChainId: shared.walletChainId,
		ended: row?.ending
			? { kind: row.ending.kind, by: row.ending.endedBy }
			: null,
		carriedOut:
			status === "carried_out"
				? { txHash: doc.relay.carriedOut?.txHash ?? null }
				: onRecord?.kind === "matched"
					? { txHash: onRecord.hash as Hex, seenBy: "page" }
					: null,
		closedUnknown: status === "unknown",
		headerNetwork: shared.header,
		objections: doc.relay.objections,
		heldUntil: staking.heldUntil,
		now: shared.clock,
	});

	const { network, multiSigUser } = proposal.payload;
	const signer =
		!!shared.listed &&
		!!shared.relayWallet &&
		shared.listed.signers.includes(shared.relayWallet);
	const statusOf = useCallback(() => status, [status]);
	const found = useMemo(
		() =>
			onRecord?.kind === "matched"
				? [
						{
							time: onRecord.time,
							hash: onRecord.hash,
							digest: proposal.digest,
						},
					]
				: undefined,
		[onRecord, proposal.digest],
	);
	// the relay is pointed at the transaction and closes the step for everyone
	useExecutionReporter({
		network,
		treasury: multiSigUser,
		ledger: null,
		match: NO_LEDGER,
		statusOf,
		signer,
		now: shared.clock,
		also: found,
	});
	useViewRecorder({
		network,
		treasury: multiSigUser,
		digest: proposal.digest,
		known: doc.relay.known,
		open: status === "open" && !doc.relay.expired,
		signer,
		views: doc.relay.views,
		proposer: row?.createdBy ?? null,
	});

	const description = useMemo(
		() => describeAction(proposal.payload.action),
		[proposal.payload.action],
	);
	return {
		proposal,
		doc,
		stage,
		ready,
		have: ready?.have ?? 0,
		need: ready?.need ?? null,
		onRecord:
			onRecord?.kind === "likely" || onRecord?.kind === "unchecked"
				? onRecord.kind
				: null,
		state,
		parsed,
		description,
		staking,
		tx:
			doc.relay.carriedOut?.txHash ??
			(onRecord?.kind === "matched" ? onRecord.hash : null),
	};
}
