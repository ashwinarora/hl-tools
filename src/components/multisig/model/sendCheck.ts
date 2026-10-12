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
	judgeStakingSteps,
	type Network,
	type PlainObject,
	parseSignersString,
	type StakingAction,
	type StakingSummary,
	sendShape,
	stakingActionOf,
	type Validator,
} from "@hl-tools/core";
import { shortAddress } from "./parts";
import { preflight, type Refusal, receiverOf, spotAvailable } from "./send";
import { STAKING_REFUSALS, stakingFacts } from "./staking";

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
	const [spot, staking, validators] = await Promise.all([
		orNull(reads.spot(first.multiSigUser)),
		orNull(reads.staking(first.multiSigUser)),
		orNull(reads.validators()),
	]);
	const verdict = judgeStakingSteps(
		steps,
		stakingFacts({
			summary: staking?.summary ?? null,
			delegations: staking?.delegations ?? null,
			validators,
			spotAvailable: spotAvailable(spot, "HYPE"),
		}),
		now,
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
