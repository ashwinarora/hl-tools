/**
 * The check before a proposal is submitted: read what Hyperliquid says now
 * about the treasury and the receiver, and ask the rules whether it would
 * refuse the action (`preflight`). A refusal uses up the proposal's number
 * for good, so it is better found here than at the exchange.
 *
 * The reads are handed in, so this runs against stubs. A read that fails
 * leaves its fact unknown, and an unknown fact stops nothing.
 */
import {
	accountMode,
	type Delegation,
	isAgentRemoval,
	judgeStakingSteps,
	judgeVaultSteps,
	type Network,
	type PlainObject,
	parseSignersString,
	type StakingAction,
	type StakingSummary,
	sendShape,
	stakingActionOf,
	type Validator,
	type VaultDeposit,
	type VaultLookup,
	type VaultStep,
	vaultActionOf,
} from "@hl-tools/core";
import { REMOVE_AGENT } from "./actions";
import {
	judgeSwitch,
	MODE_UNMEASURED,
	type ModeTarget,
	modeTargetOf,
	unmeasuredSwitch,
} from "./modeSwitch";
import { shortAddress } from "./parts";
import { preflight, type Refusal, receiverOf, spotAvailable } from "./send";
import { STAKING_REFUSALS, stakingFacts } from "./staking";
import { VAULT_REFUSALS, vaultFacts } from "./vault";

export interface SendReads {
	/** `userAbstraction` of an account. */
	mode(user: string): Promise<unknown>;
	/** What can leave the account's perps balance now. */
	withdrawable(user: string): Promise<string>;
	/** The account's spot balances. */
	spot(user: string): Promise<
		readonly {
			readonly coin: string;
			readonly total: string;
			readonly hold?: string;
		}[]
	>;
	/** `userRole` of an address. */
	role(address: string): Promise<unknown>;
	/** The account's signers now; null when it is not a multi-sig. */
	signers(user: string): Promise<readonly string[] | null>;
	/** The account's staking balance and its stakes. */
	staking(user: string): Promise<{
		readonly summary: StakingSummary | null;
		readonly delegations: readonly Delegation[] | null;
	}>;
	/** Every validator of the network. */
	validators(): Promise<readonly Validator[] | null>;
	/** Hyperliquid's own clock in milliseconds; null when it did not say. */
	clock(): Promise<number | null>;
	/** Every API wallet of the account, the one without a name included. */
	agents(user: string): Promise<readonly { readonly name: string }[]>;
	/** Every vault the account has money in. */
	vaultDeposits(user: string): Promise<readonly VaultDeposit[] | null>;
	/** What Hyperliquid reports about a vault, with that account's deposit in it. */
	vault(vault: string, user: string): Promise<VaultLookup>;
	/** How many positions and resting orders the account has open. */
	open(user: string): Promise<{
		readonly positions: number;
		readonly orders: number;
	}>;
}

interface Checked {
	readonly network: Network;
	readonly multiSigUser: string;
	readonly action: PlainObject;
}

const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function checkBeforeSubmit(
	payload: Checked,
	reads: SendReads,
	/** The moment it is asked: a stake's lockup is a matter of time. */
	now: number = Date.now(),
): Promise<Refusal[]> {
	const { action, multiSigUser } = payload;
	if (action.type === "convertToMultiSigUser")
		return checkNewSigners(action, multiSigUser, reads);
	if (stakingActionOf(action)) return checkStaking([payload], reads, now);
	if (vaultActionOf(action)) return checkVault([payload], reads, now);
	if (isAgentRemoval(action)) return checkRemoval(action, multiSigUser, reads);
	const toMode = modeTargetOf(action);
	if (toMode) return checkSwitch(toMode, multiSigUser, reads);
	// a switch to a mode nobody measured (see `unmeasuredSwitch`): the page of
	// the proposal says so before anyone signs, and nothing is sent here
	if (action.type === "userSetAbstraction") {
		const unmeasured = unmeasuredSwitch(action);
		return unmeasured ? [{ code: "mode-unmeasured", message: unmeasured }] : [];
	}
	const shape = sendShape(action);
	// nothing here bears on an action that moves no money
	if (!shape && action.type !== "withdraw3") return [];
	const destination = shape?.destination || null;
	const [mode, withdrawable, spot, role, receiverMode] = await Promise.all([
		orNull(reads.mode(multiSigUser)),
		orNull(reads.withdrawable(multiSigUser)),
		orNull(reads.spot(multiSigUser)),
		destination ? orNull(reads.role(destination)) : null,
		destination ? orNull(reads.mode(destination)) : null,
	]);
	return preflight(action, {
		mode: typeof mode === "string" ? accountMode(mode) : null,
		perpsUsdc: withdrawable,
		spot,
		receiver: role === null ? null : receiverOf(role, receiverMode),
		self: multiSigUser,
	});
}

/**
 * A switch back to a manual account: Hyperliquid refuses it while the
 * account has a position or an order open. To a unified account nothing
 * stands in the way, so nothing is read.
 */
async function checkSwitch(
	target: ModeTarget,
	multiSigUser: string,
	reads: SendReads,
): Promise<Refusal[]> {
	if (target !== "manual") return [];
	const open = await orNull(reads.open(multiSigUser));
	const blocked = judgeSwitch(target, {
		// its own mode bears on warnings only, which are the form's to give
		mode: undefined,
		positions: open?.positions ?? null,
		orders: open?.orders ?? null,
		waiting: [],
	}).blocked;
	return blocked ? [{ code: "unified-busy", message: blocked }] : [];
}

/**
 * Removing an API wallet: Hyperliquid refuses it ("Extra agent does not
 * exist.") when the account has no API wallet of that name any more. Days may
 * have passed since the proposal was made: the wallet may have been removed
 * by another proposal, or replaced.
 */
async function checkRemoval(
	action: PlainObject,
	multiSigUser: string,
	reads: SendReads,
): Promise<Refusal[]> {
	const agents = await orNull(reads.agents(multiSigUser));
	const name = typeof action.agentName === "string" ? action.agentName : "";
	// a list that was not read stops nothing
	if (!agents || agents.some((a) => a.name === name)) return [];
	return [{ code: "agent-missing", message: REMOVE_AGENT.missing(name) }];
}

/**
 * A change of signers: Hyperliquid refuses it when a signer in the new list
 * has never been used there, or is a vault or a sub-account. The form checked
 * that when the proposal was made; days may have passed, and the document may
 * have come from elsewhere. Only the addresses that would be new are asked
 * about (a signer of now is one already).
 */
async function checkNewSigners(
	action: PlainObject,
	multiSigUser: string,
	reads: SendReads,
): Promise<Refusal[]> {
	const asked = parseSignersString(action.signers);
	// the conversion back names nobody; an unreadable list is the core's to refuse
	if (!asked.set) return [];
	const now = (await orNull(reads.signers(multiSigUser))) ?? [];
	const added = asked.set.authorizedUsers.filter((a) => !now.includes(a));
	const roles = await Promise.all(added.map((a) => orNull(reads.role(a))));
	const out: Refusal[] = [];
	added.forEach((a, i) => {
		const r = roles[i];
		const role =
			r && typeof r === "object" ? (r as { role?: unknown }).role : null;
		if (role === "missing")
			out.push({
				code: "multisig-signer-missing",
				message: `${shortAddress(a)} has never been used on Hyperliquid, and a signer has to have received something there first.`,
			});
		else if (role === "vault" || role === "subAccount")
			out.push({
				code: "multisig-signer-kind",
				message: `${shortAddress(a)} is a ${role === "vault" ? "vault" : "sub-account"}, which Hyperliquid refuses as a signer.`,
			});
	});
	return out;
}

/**
 * The steps of a move, checked together before any of them is sent: each is
 * judged against what the ones before it leave behind, so a second step that
 * only works once the first has landed is not stopped, and a first step that
 * would go through while the second cannot is. Steps that are no staking
 * actions are checked one by one.
 */
export async function checkMoveBeforeSubmit(
	payloads: readonly Checked[],
	reads: SendReads,
	now: number = Date.now(),
): Promise<Refusal[]> {
	if (payloads.every((p) => stakingActionOf(p.action)))
		return checkStaking(payloads, reads, now);
	// a vault action among them: the steps are judged in order, each against
	// what the one before it leaves behind
	if (payloads.some((p) => vaultActionOf(p.action)))
		return checkVault(payloads, reads, now);
	const each = await Promise.all(
		payloads.map((p) => checkBeforeSubmit(p, reads, now)),
	);
	return each.flat();
}

/**
 * Staking steps of one account, in the order they will be sent. What
 * Hyperliquid would refuse is read off its own figures: the spot HYPE that is
 * not on hold, the staking balance, the stakes with the end of their
 * lockups, the returns already waiting, and the list of validators.
 *
 * A lockup ends by Hyperliquid's clock. Where an unstake is among the steps
 * that clock is asked for, so a device that runs fast does not send one a
 * few seconds early (it would be refused, and the proposal's number spent).
 * Where it does not answer, the device's clock is what there is.
 */
async function checkStaking(
	payloads: readonly Checked[],
	reads: SendReads,
	now: number,
): Promise<Refusal[]> {
	const [first] = payloads;
	const steps = payloads.flatMap((p): StakingAction[] => {
		const step = stakingActionOf(p.action);
		return step ? [step] : [];
	});
	if (!first || steps.length !== payloads.length) return [];
	const timed = steps.some((s) => s.kind === "unstake");
	const [spot, staking, validators, theirs] = await Promise.all([
		orNull(reads.spot(first.multiSigUser)),
		orNull(reads.staking(first.multiSigUser)),
		orNull(reads.validators()),
		timed ? orNull(reads.clock()) : null,
	]);
	const verdict = judgeStakingSteps(
		steps,
		stakingFacts({
			summary: staking?.summary ?? null,
			delegations: staking?.delegations ?? null,
			validators,
			spotAvailable: spotAvailable(spot, "HYPE"),
		}),
		typeof theirs === "number" ? theirs : now,
		first.network,
	);
	if (!verdict) return [];
	const which = steps.length > 1 ? `Step ${verdict.index + 1}: ` : "";
	return [
		{
			code: verdict.refusal,
			message: `${which}${STAKING_REFUSALS[verdict.refusal]}`,
		},
	];
}

/** The step a payload is in a vault move: the move to perps, or the vault action. Null for anything else. */
function vaultStepOf(action: PlainObject): VaultStep | null {
	const vault = vaultActionOf(action);
	if (vault) return vault;
	return action.type === "usdClassTransfer" &&
		action.toPerp === true &&
		typeof action.amount === "string"
		? { kind: "toPerps", amount: action.amount }
		: null;
}

/**
 * A vault deposit or withdrawal, alone or behind the move to perps that
 * makes room for it. What Hyperliquid would refuse is read off its own
 * figures: the account's mode and what each balance can release, the vault
 * as it stands (closed, taking deposits, there at all), and the account's
 * deposit in it with the end of its lockup.
 *
 * As with a stake, a lockup ends by Hyperliquid's clock: for a withdrawal
 * that clock is asked for, and the device's is what there is when it does
 * not answer.
 */
async function checkVault(
	payloads: readonly Checked[],
	reads: SendReads,
	now: number,
): Promise<Refusal[]> {
	const [first] = payloads;
	const steps = payloads.flatMap((p): VaultStep[] => {
		const step = vaultStepOf(p.action);
		return step ? [step] : [];
	});
	const target = steps.find(
		(s): s is Exclude<VaultStep, { kind: "toPerps" }> => s.kind !== "toPerps",
	);
	// a pair that is not a vault move is not judged as one
	if (!first || !target || steps.length !== payloads.length) return [];
	const user = first.multiSigUser;
	const timed = target.kind === "withdraw";
	const [mode, withdrawable, spot, deposits, lookup, theirs] =
		await Promise.all([
			orNull(reads.mode(user)),
			orNull(reads.withdrawable(user)),
			orNull(reads.spot(user)),
			orNull(reads.vaultDeposits(user)),
			orNull(reads.vault(target.vault, user)),
			timed ? orNull(reads.clock()) : null,
		]);
	const verdict = judgeVaultSteps(
		steps,
		vaultFacts(
			{
				mode: typeof mode === "string" ? accountMode(mode) : null,
				perps: withdrawable,
				spot: spotAvailable(spot, "USDC"),
				deposits,
				vault: lookup,
			},
			target.vault,
		),
		typeof theirs === "number" ? theirs : now,
		first.network,
	);
	if (!verdict) return [];
	const which = steps.length > 1 ? `Step ${verdict.index + 1}: ` : "";
	return [
		{
			code: verdict.refusal,
			message: `${which}${VAULT_REFUSALS[verdict.refusal]}`,
		},
	];
}

export { MODE_UNMEASURED };
