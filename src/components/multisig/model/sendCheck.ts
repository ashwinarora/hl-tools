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
	sendShape,
} from "@hl-tools/core";
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
