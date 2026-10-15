/**
 * Whether a vault deposit or withdrawal has already been carried out, read
 * from the account's own ledger.
 *
 * A vault action carries no number of its own. If the finaliser's page lost
 * Hyperliquid's answer (a closed tab, a dropped connection), the proposal
 * still reads as waiting, and neither the explorer nor the relay can say
 * that a transaction was this proposal: the same deposit made by another
 * proposal, or by the treasury's API wallet, is the very same action. What
 * the ledger can say is that a row like it stands there since the proposal
 * was made. That is told as "it may be carried out already", never as done:
 * the proposal stays open until its proposer withdraws it.
 */
import type { LedgerRow, PlainObject } from "@hl-tools/core";
import { candidatesFor } from "./match";
import { MADE_BEFORE_SLACK_MS } from "./stakingRecord";

/**
 * unread   the ledger was not read
 * none     no row like this action since the proposal was made
 * likely   one row like it
 * several  more than one: which, if any, is this proposal cannot be told
 */
export type VaultRecord =
	| { readonly kind: "unread" | "none" | "several" }
	| { readonly kind: "likely"; readonly time: number; readonly hash: string };

const VAULT_ROWS: ReadonlySet<string> = new Set([
	"vaultDeposit",
	"vaultWithdraw",
]);

export function vaultRecord(i: {
	readonly action: PlainObject;
	readonly nonce: number;
	/** When the proposal says it was made; a row from before that is somebody else's. */
	readonly madeAt?: number | null;
	readonly ledger: readonly LedgerRow[] | null;
}): VaultRecord {
	if (!i.ledger) return { kind: "unread" };
	const self = [
		{ digest: "0x" as const, action: i.action, nonce: i.nonce, finaliser: "" },
	];
	const since =
		i.madeAt === null || i.madeAt === undefined
			? Number.NEGATIVE_INFINITY
			: i.madeAt - MADE_BEFORE_SLACK_MS;
	const rows = i.ledger
		.filter(
			(row) =>
				VAULT_ROWS.has(row.type) &&
				row.time >= since &&
				candidatesFor(row, self).kind === "candidates",
		)
		.sort((a, b) => b.time - a.time);
	const [newest] = rows;
	if (!newest) return { kind: "none" };
	return rows.length === 1
		? { kind: "likely", time: newest.time, hash: newest.hash }
		: { kind: "several" };
}
