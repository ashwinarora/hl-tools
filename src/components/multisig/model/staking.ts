/**
 * Staking, as the Multisig section says it.
 *
 * A form names where the HYPE should end up ("100 staked with this
 * validator", "100 back in spot", "100 from this validator to that one") and
 * this file works out the one or two actions that bring it about, from what
 * Hyperliquid says the treasury holds now (the core's planner). It also holds
 * every sentence about staking: what a step does, what stands in its way, and
 * what a signer should know before agreeing.
 *
 * Three levels, as everywhere in the section. An error is something the form
 * cannot be turned into a proposal with. A warning is one amber line: what
 * Hyperliquid would refuse as things stand, or a consequence somebody might
 * not expect. Everything else is a plain fact. Nothing here is a
 * recommendation: which validator to stake with is the signers' choice.
 */
import {
	Decimal,
	type Delegation,
	expectedRate,
	HYPE_WEI_DECIMALS,
	type Issue,
	issue,
	judgeStakingSteps,
	LOCKUP_MARGIN_MS,
	lockupOf,
	MAX_PENDING_RETURNS,
	type Network,
	type NoPay,
	type PendingReturn,
	type PlainObject,
	pendingReturns,
	planMove,
	planReturn,
	planStake,
	RETURN_QUEUE,
	STAKE_LOCKUP,
	type StakingAction,
	type StakingEvent,
	type StakingFacts,
	type StakingRefusal,
	type StakingSummary,
	stakingFields,
	type Validator,
	validatorPays,
} from "@hl-tools/core";
import { addressField, amountField } from "./fields";
import { shortAddress } from "./parts";

/**
 * stake         this much staked with a validator
 * returnToSpot  this much back in the spot balance
 * moveStake     this much from one validator to another
 */
export type StakingKind = "stake" | "returnToSpot" | "moveStake";
export const STAKING_KINDS: readonly StakingKind[] = [
	"stake",
	"returnToSpot",
	"moveStake",
];
export const isStakingKind = (kind: string): kind is StakingKind =>
	(STAKING_KINDS as readonly string[]).includes(kind);

/** What Hyperliquid said about the treasury's staking. A part that was not read is null. */
export interface StakingRead {
	readonly summary: StakingSummary | null;
	readonly delegations: readonly Delegation[] | null;
	readonly validators: readonly Validator[] | null;
	/** Spot HYPE that is not on hold. */
	readonly spotAvailable: string | null;
}

/** The fields of the three forms, as the inputs hold them. */
export interface StakingInput {
	readonly kind: StakingKind;
	readonly amount: string;
	/** Stake: the validator staked with. Return and move: the one unstaked from. */
	readonly validator: string;
	/** Move: the validator the HYPE goes to. */
	readonly toValidator: string;
}

export interface StakingPlan {
	/** The steps in order, one or two; null while the form cannot be turned into them. */
	readonly steps: readonly StakingAction[] | null;
	readonly issues: readonly Issue[];
	/**
	 * A step unstakes from a stake that is still locked: it can be proposed
	 * and signed now, and submitted from this moment (unix ms) on.
	 */
	readonly opensAt: number | null;
}

// ------------------------------------------------------------------- words

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** A wait in words: "1 day", "7 days", "2 minutes". */
export function waitWords(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return plural(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (hours < 24) return plural(hours, "hour");
	return plural(Math.round(hours / 24), "day");
}
export const lockupWords = (network: Network): string =>
	waitWords(STAKE_LOCKUP[network].ms);
export const queueWords = (network: Network): string =>
	waitWords(RETURN_QUEUE[network].ms);

export const hype = (amount: string): string => `${amount} HYPE`;

/**
 * A validator by the name it gave itself, always with its address: the name
 * is the validator's own word and nothing stops two from using the same one.
 */
export function validatorLabel(
	address: string,
	validators: readonly Validator[] | null | undefined,
): string {
	const name = validators?.find((v) => v.address === address)?.name.trim();
	return name ? `${name} (${shortAddress(address)})` : shortAddress(address);
}

/** What one step does, in Hyperliquid's own words for staking. */
export function stepSentence(
	step: StakingAction,
	validators: readonly Validator[] | null | undefined,
): string {
	switch (step.kind) {
		case "moveIn":
			return `Move ${hype(step.amount)} from the spot balance to the staking balance`;
		case "stake":
			return `Stake ${hype(step.amount)} with ${validatorLabel(step.validator, validators)}`;
		case "unstake":
			return `Unstake ${hype(step.amount)} from ${validatorLabel(step.validator, validators)}`;
		default:
			return `Return ${hype(step.amount)} from the staking balance to the spot balance`;
	}
}

export const STAKING = {
	label: "Staking",
	kinds: {
		stake: {
			label: "Stake",
			description: "HYPE staked with a validator.",
		},
		returnToSpot: {
			label: "Return to spot",
			description: "Staked HYPE back in the spot balance.",
		},
		moveStake: {
			label: "Move to another validator",
			description: "Staked HYPE from one validator to another.",
		},
	},
	amount: {
		stake: "How much should be staked with the validator",
		returnToSpot: "How much should be back in spot",
		moveStake: "How much should move",
	},
	validator: {
		stake: "Validator",
		returnToSpot: "Unstake from",
		moveStake: "From",
	},
	toValidator: "To",
	oneStep: "This makes one proposal:",
	twoSteps:
		"This makes two proposals. Signers sign both in one visit, and the finaliser sends the second only once Hyperliquid has accepted the first:",
	unread:
		"The treasury's staking balance has not been read from Hyperliquid yet, so the steps cannot be worked out.",
	validatorsUnread:
		"The list of validators could not be read from Hyperliquid, so this address was not checked against it.",
	noRecommendation:
		"Every validator is listed as Hyperliquid reports it. Which one to stake with is the signers' choice.",
} as const;

/** Why a stake with a validator earns nothing, as a clause after its name. */
const NO_PAY: Readonly<Record<NoPay, string>> = {
	jailed: "is jailed: the other validators voted it out for not responding",
	outside: "is not among the validators that produce blocks and are paid",
	"keeps-all": "keeps all rewards as its commission",
	"no-rate": "is expected by Hyperliquid to pay nothing as things stand",
};

/** The amber line for a validator that pays nothing; null for one that pays. */
export function noPayLine(
	validator: Validator,
	network: Network,
): string | null {
	const pays = validatorPays(validator);
	if (pays.pays) return null;
	return `${validatorLabel(validator.address, [validator])} ${NO_PAY[pays.why]}. A stake with it earns nothing. Hyperliquid accepts the stake all the same, and it cannot be unstaked for ${lockupWords(network)}.`;
}

/** What Hyperliquid would answer, said to someone about to submit. */
export const STAKING_REFUSALS: Readonly<Record<StakingRefusal, string>> = {
	"staking-deposit-funds":
		"This moves more HYPE into the staking balance than the spot balance can release now.",
	"stake-balance":
		"This stakes more HYPE than the staking balance holds unstaked now.",
	"validator-unknown": "The address this stakes with is not a validator.",
	"unstake-lockup":
		"The stake this takes from is still locked, and Hyperliquid refuses an unstake until the lockup has ended.",
	"unstake-balance":
		"This unstakes more HYPE than is staked with that validator now.",
	"return-balance":
		"This returns more HYPE to spot than the staking balance holds unstaked now.",
	"return-queue-full": `${MAX_PENDING_RETURNS} returns to spot are already waiting, and Hyperliquid takes no more than ${MAX_PENDING_RETURNS} at once.`,
};

// ------------------------------------------------------------------- the plan

/** What the judge needs, from what was read. */
export function stakingFacts(read: StakingRead): StakingFacts {
	return {
		spotAvailable: read.spotAvailable,
		undelegated: read.summary?.undelegated ?? null,
		delegations: read.delegations,
		pendingReturns: read.summary?.pendingReturns ?? null,
		validators: read.validators?.map((v) => v.address) ?? null,
	};
}

const AMOUNT = "action.amount";
const VALIDATOR = "action.validator";
const TO = "action.toValidator";

/**
 * The steps a form asks for and everything to say about them. `read` is null
 * while nothing has been read; `now` is the page's clock.
 */
export function planStaking(
	form: StakingInput,
	read: StakingRead | null | undefined,
	network: Network,
	now: number,
): StakingPlan {
	const issues: Issue[] = [];
	const none = (): StakingPlan => ({ steps: null, issues, opensAt: null });
	const warn = (code: string, message: string, path?: string) =>
		issues.push(issue(code, "warning", message, path ? { path } : {}));
	const validators = read?.validators ?? null;
	const known = (address: string) =>
		validators?.find((v) => v.address === address) ?? null;
	const label = (address: string) => validatorLabel(address, validators);

	const amount = amountField(
		form.amount,
		HYPE_WEI_DECIMALS,
		"HYPE",
		issues,
		AMOUNT,
	)?.toString();
	/** A validator HYPE is staked with: it has to be one, where the list was read. */
	const target = (value: string, path: string): string | null => {
		const address = addressField(value, path, "The validator", issues, false);
		if (address === null) return null;
		if (validators && !known(address)) {
			issues.push(
				issue(
					"validator.unknown",
					"error",
					`This address is not a validator on ${network}. Hyperliquid would refuse the stake.`,
					{ path },
				),
			);
			return null;
		}
		if (!validators) warn("validators.unread", STAKING.validatorsUnread, path);
		return address;
	};

	const summary = read?.summary ?? null;
	if (!summary) {
		issues.push(issue("staking.unread", "error", STAKING.unread));
		return none();
	}

	let steps: StakingAction[] | null = null;
	if (form.kind === "stake") {
		const validator = target(form.validator, VALIDATOR);
		if (amount && validator)
			steps = planStake({
				amount,
				validator,
				undelegated: summary.undelegated,
			});
	} else if (form.kind === "returnToSpot") {
		// a validator is asked for only when something has to be unstaked
		const from = form.validator.trim()
			? addressField(form.validator, VALIDATOR, "The validator", issues, false)
			: null;
		if (amount) {
			steps = planReturn({ amount, undelegated: summary.undelegated, from });
			if (!steps && !form.validator.trim())
				issues.push(
					issue(
						"validator.needed",
						"error",
						`The staking balance holds ${hype(summary.undelegated)} that is not staked, so the rest has to be unstaked first. Choose the validator to take it from.`,
						{ path: VALIDATOR },
					),
				);
		}
	} else {
		const from = addressField(
			form.validator,
			VALIDATOR,
			"The validator",
			issues,
			false,
		);
		const to = target(form.toValidator, TO);
		if (from && to && from === to)
			issues.push(
				issue("validator.same", "error", "Choose two different validators.", {
					path: TO,
				}),
			);
		else if (amount && from && to) steps = planMove({ amount, from, to });
	}
	if (!steps || issues.some((i) => i.severity === "error")) return none();

	// what a signer might not expect of the validator the HYPE goes to
	const staked = steps.find((s) => s.kind === "stake");
	if (staked && staked.kind === "stake") {
		const v = known(staked.validator);
		const nothing = v ? noPayLine(v, network) : null;
		const path = form.kind === "moveStake" ? TO : VALIDATOR;
		if (nothing) warn("stake.pays_nothing", nothing, path);
		const already = read?.delegations?.find(
			(d) => d.validator === staked.validator,
		);
		if (already)
			warn(
				"stake.relocks",
				`The treasury already has ${hype(already.amount)} staked with ${label(staked.validator)}. Adding to it locks all of it again: none of it can be unstaked for ${lockupWords(network)}.`,
				path,
			);
	}

	// A stake that is still locked is no reason against proposing: the proposal
	// has two days, and the lockup ends by itself. Everything else is judged as
	// of the moment the lockup is over.
	const facts = stakingFacts(read as StakingRead);
	const locked = steps
		.map((s) => lockupOf(s, facts.delegations ?? []))
		.find((t): t is number => t !== null && t > now);
	const verdict = judgeStakingSteps(steps, facts, locked ?? now, network);
	if (verdict) {
		const step = steps[verdict.index] as StakingAction;
		const where = steps.length > 1 ? ` (step ${verdict.index + 1})` : "";
		warn(
			`staking.would_refuse.${verdict.refusal}`,
			`${STAKING_REFUSALS[verdict.refusal]} As things stand Hyperliquid would refuse it${where}. ${wouldRefuseDetail(verdict.refusal, step, facts, label)}`.trim(),
			AMOUNT,
		);
	}
	return {
		steps,
		issues,
		opensAt: locked === undefined ? null : locked + LOCKUP_MARGIN_MS,
	};
}

/** The figures behind a refusal, where they are known. */
function wouldRefuseDetail(
	refusal: StakingRefusal,
	step: StakingAction,
	facts: StakingFacts,
	label: (address: string) => string,
): string {
	if (refusal === "staking-deposit-funds" && facts.spotAvailable !== null)
		return `Spot holds ${hype(facts.spotAvailable)} that is not on hold, and this moves ${hype(step.amount)}.`;
	if (refusal === "unstake-balance" && step.kind === "unstake") {
		const held =
			facts.delegations?.find((d) => d.validator === step.validator)?.amount ??
			"0";
		return `The treasury has ${hype(held)} staked with ${label(step.validator)}, and this unstakes ${hype(step.amount)}.`;
	}
	return "";
}

/**
 * The actions of a plan as Hyperliquid takes them: each with the chain fields
 * of the proposal and its own number, the second one more than the first.
 */
export function stakingActions(
	steps: readonly StakingAction[],
	head: {
		readonly signatureChainId: string;
		readonly hyperliquidChain: string;
	},
	nonce: number,
): PlainObject[] {
	return steps.flatMap((step, i) => {
		const fields = stakingFields(step);
		if (!fields) return [];
		const { type, ...rest } = fields;
		return [{ type, ...head, ...rest, nonce: nonce + i } as PlainObject];
	});
}

/** Hyperliquid's own estimate for a validator, as a percentage: "2.17%". Null when it gives none. */
export function ratePercent(v: Validator): string | null {
	const rate = expectedRate(v);
	return rate === null ? null : `${(Number(rate) * 100).toFixed(2)}%`;
}

// ------------------------------------------------------------------- the page

/** Why a stake earns nothing now, in a word or two for a tag. */
const NO_PAY_TAG: Readonly<Record<NoPay, string>> = {
	jailed: "jailed",
	outside: "not active",
	"keeps-all": "keeps all rewards",
	"no-rate": "pays nothing",
};

/** A validator's state in a word, for a table: what Hyperliquid reports, nothing more. */
export function validatorState(v: Validator): {
	readonly text: string;
	/** A stake with it earns nothing as things stand. */
	readonly idle: boolean;
} {
	const pays = validatorPays(v);
	return pays.pays
		? { text: "active", idle: false }
		: { text: NO_PAY_TAG[pays.why], idle: true };
}

/** One stake of the treasury, as its row reads. */
export interface StakeRow {
	readonly validator: string;
	/** The validator's own name; "" when it gave none or the list was not read. */
	readonly name: string;
	readonly amount: string;
	/** Hyperliquid's estimate, "2.17%"; null when not known. */
	readonly rate: string | null;
	/** Set when the stake earns nothing as things stand: the word for the tag. */
	readonly idle: string | null;
	/** Unix ms: from when it can be unstaked. */
	readonly lockedUntil: number;
	readonly locked: boolean;
}

/** One line of Hyperliquid's own list of an account's staking steps. */
export interface StakingHistoryRow {
	readonly key: string;
	readonly time: number;
	readonly text: string;
	/** Null for Hyperliquid's own step (a return that landed): there is no transaction to open. */
	readonly hash: string | null;
}

export interface StakingView {
	/** Null while the staking balance is not read. */
	readonly undelegated: string | null;
	readonly delegated: string | null;
	readonly pending: string | null;
	/** How many returns are waiting, of the five Hyperliquid takes at once. */
	readonly places: number | null;
	readonly stakes: readonly StakeRow[] | null;
	/** Null when not read, or when the history does not say when each lands. */
	readonly returns: readonly PendingReturn[] | null;
	readonly history: readonly StakingHistoryRow[] | null;
	/** The account has something in staking, or on its way back. */
	readonly any: boolean;
}

const nonZero = (v: string | null | undefined): boolean =>
	!!v && !Decimal.parse(v).isZero();

export function historyText(
	e: StakingEvent,
	validators: readonly Validator[] | null | undefined,
): string {
	switch (e.kind) {
		case "moveIn":
			return `Moved ${hype(e.amount)} from spot to the staking balance`;
		case "stake":
			return `Staked ${hype(e.amount)} with ${validatorLabel(e.validator ?? "", validators)}`;
		case "unstake":
			return `Unstaked ${hype(e.amount)} from ${validatorLabel(e.validator ?? "", validators)}`;
		case "returnStarted":
			return `Started the return of ${hype(e.amount)} to spot`;
		default:
			return `${hype(e.amount)} landed in spot`;
	}
}

const ZERO_HASH = /^0x0+$/;

/** What the Staking section shows, from what was read. */
export function stakingView(
	read: {
		readonly summary: StakingSummary | null;
		readonly delegations: readonly Delegation[] | null;
		readonly history: readonly StakingEvent[] | null;
		readonly validators: readonly Validator[] | null;
	},
	network: Network,
	now: number,
): StakingView {
	const { summary, delegations, history, validators } = read;
	return {
		undelegated: summary?.undelegated ?? null,
		delegated: summary?.delegated ?? null,
		pending: summary?.pendingTotal ?? null,
		places: summary?.pendingReturns ?? null,
		stakes:
			delegations?.map((d): StakeRow => {
				const v = validators?.find((x) => x.address === d.validator) ?? null;
				const pays = v ? validatorPays(v) : null;
				return {
					validator: d.validator,
					name: v?.name.trim() ?? "",
					amount: d.amount,
					rate: v ? ratePercent(v) : null,
					idle: pays && !pays.pays ? NO_PAY_TAG[pays.why] : null,
					lockedUntil: d.lockedUntil,
					locked: d.lockedUntil > now,
				};
			}) ?? null,
		returns:
			summary && history ? pendingReturns(summary, history, network) : null,
		history:
			history?.map((e, i) => ({
				key: `${e.time}:${e.hash}:${i}`,
				time: e.time,
				text: historyText(e, validators),
				hash: ZERO_HASH.test(e.hash) ? null : e.hash,
			})) ?? null,
		any:
			nonZero(summary?.delegated) ||
			nonZero(summary?.undelegated) ||
			nonZero(summary?.pendingTotal),
	};
}

/**
 * The one line the Overview gives staking, so staked HYPE never looks as if
 * it had left the treasury. Null when nothing is in staking.
 */
export function stakingSummaryLine(
	summary: StakingSummary | null,
): string | null {
	if (!summary) return null;
	const parts = [
		nonZero(summary.delegated) ? `${hype(summary.delegated)} staked` : null,
		nonZero(summary.undelegated)
			? `${hype(summary.undelegated)} in the staking balance`
			: null,
		nonZero(summary.pendingTotal)
			? `${hype(summary.pendingTotal)} on its way back to spot`
			: null,
	].filter((x): x is string => x !== null);
	return parts.length > 0 ? parts.join(" · ") : null;
}
