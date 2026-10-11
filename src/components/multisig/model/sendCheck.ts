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
	type Network,
	type PlainObject,
	parseSignersString,
	sendShape,
} from "@hl-tools/core";
import { shortAddress } from "./parts";
import { preflight, type Refusal, receiverOf } from "./send";

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
}

const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function checkBeforeSubmit(
	payload: {
		readonly network: Network;
		readonly multiSigUser: string;
		readonly action: PlainObject;
	},
	reads: SendReads,
): Promise<Refusal[]> {
	const { action, multiSigUser } = payload;
	if (action.type === "convertToMultiSigUser")
		return checkNewSigners(action, multiSigUser, reads);
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
