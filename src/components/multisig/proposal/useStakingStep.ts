import {
	LOCKUP_MARGIN_MS,
	lockupOf,
	type Proposal,
	type StakingAction,
	stakingActionOf,
	type Validator,
} from "@hl-tools/core";
import { useMemo } from "react";
import type { AccountTarget } from "#/components/tools/multisig/model";
import { useTxLookups } from "../live/useChainMatch";
import { type Staking, useStaking } from "../live/useStaking";
import {
	type StepRecord,
	stakingCandidates,
	stepRecord,
} from "../model/chain/stakingRecord";
import { noPayLine } from "../model/staking";

export interface StakingStep {
	/** Null when the proposal's action is no staking step. */
	readonly step: StakingAction | null;
	readonly staking: Staking;
	/**
	 * An unstake from a stake that is still locked: Hyperliquid refuses it
	 * before this moment (the lockup's end and a few seconds). Null otherwise,
	 * and while the stakes are not read.
	 */
	readonly heldUntil: number | null;
	/**
	 * Whether Hyperliquid's own list of the account's staking steps already
	 * holds this one. Null when the action is no staking step or nothing is
	 * asked (the proposal is settled).
	 */
	readonly record: StepRecord | null;
	/** The validator the step names, as Hyperliquid lists it now; null when not listed or not read. */
	readonly validator: Validator | null;
	/** A stake with a validator that pays nothing as things stand: the amber line. Read again for every signer. */
	readonly noPay: string | null;
}

/**
 * What a page has to know about a proposal that is a staking step, read from
 * Hyperliquid for as long as the proposal can still be signed or sent: the
 * end of the lockup an unstake waits for, the state of the validator a stake
 * goes to, and whether the step is already on Hyperliquid's record (stake,
 * unstake and the start of a return leave no trace in the ledger, so that is
 * where a submission whose answer was lost shows up).
 */
export function useStakingStep(
	proposal: Proposal,
	/** False once the proposal is settled: nothing is asked any more. */
	active: boolean,
): StakingStep {
	const { action, nonce, network, multiSigUser } = proposal.payload;
	// a step made before the proposal existed is never taken for its own
	const madeAt = proposal.meta.createdAt;
	const step = useMemo(() => stakingActionOf(action), [action]);
	const target = useMemo<AccountTarget | null>(
		() => (step && active ? { address: multiSigUser, network } : null),
		[step, active, multiSigUser, network],
	);
	const names = step?.kind === "stake" || step?.kind === "unstake";
	const staking = useStaking(target, {
		stakes: step?.kind === "unstake",
		history: true,
		validators: names,
	});

	const candidates = useMemo(
		() =>
			target && staking.history
				? stakingCandidates(action, nonce, staking.history, madeAt)
				: [],
		[target, staking.history, action, nonce, madeAt],
	);
	const hashes = useMemo(() => candidates.map((e) => e.hash), [candidates]);
	const lookups = useTxLookups(network, hashes);
	const record = useMemo<StepRecord | null>(
		() =>
			target
				? stepRecord({
						action,
						nonce,
						account: multiSigUser,
						events: staking.history,
						lookups,
						madeAt,
					})
				: null,
		[target, action, nonce, multiSigUser, staking.history, lookups, madeAt],
	);

	const lockedUntil =
		step && staking.delegations ? lockupOf(step, staking.delegations) : null;
	const validator =
		step && "validator" in step
			? (staking.validators?.find((v) => v.address === step.validator) ?? null)
			: null;
	return {
		step,
		staking,
		heldUntil: lockedUntil ? lockedUntil + LOCKUP_MARGIN_MS : null,
		record,
		validator,
		noPay:
			step?.kind === "stake" && validator
				? noPayLine(validator, network)
				: null,
	};
}
