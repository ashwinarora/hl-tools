/**
 * Notices, on a page that follows a treasury's ledger, that a proposal the
 * relay still holds as open (or withdrawn, or declined) has in fact been
 * carried out, and points the relay at the transaction. The relay checks the
 * transaction itself and closes the proposal for every signer; this browser
 * then hears about it like any other change.
 */
import type { Address, Hex, LedgerRow, Network } from "@hl-tools/core";
import { useEffect } from "react";
import type { ChainMatch } from "../live/useChainMatch";
import { reportKey, reportsDue } from "../model/relay/report";
import type { ProposalStatus } from "../model/relay/rows";
import { reportExecution } from "./api";
import { useRelay } from "./useRelay";

/** Claims already filed from this tab, so a re-render does not file them again. */
const told = new Set<string>();

export function useExecutionReporter(i: {
	readonly network: Network;
	readonly treasury: Address;
	/** The treasury's ledger as it arrives; null while it is not followed. */
	readonly ledger: readonly LedgerRow[] | null;
	readonly match: ChainMatch;
	/** The relay's status of a proposal; null when the relay does not have it. */
	readonly statusOf: (digest: Hex) => ProposalStatus | null;
	/** The signed-in wallet is in the relay's copy of the treasury's signers. */
	readonly signer: boolean;
	/** Re-read on a clock, so a row is reported once it is old enough. */
	readonly now: number;
}): void {
	const relay = useRelay();
	const client = relay.client;
	const me = relay.wallet;
	const { network, treasury, ledger, match, statusOf, signer, now } = i;
	useEffect(() => {
		if (!client || !me || !signer || !ledger) return;
		const due = reportsDue({
			rows: ledger.map((row) => ({
				time: row.time,
				hash: row.hash,
				match: match.of(row),
			})),
			statusOf,
			now,
			told,
		});
		for (const d of due) {
			// said once, whatever the relay answers: a refusal is an answer too
			told.add(reportKey(d));
			void reportExecution(
				client,
				me,
				{ network, treasury, digest: d.digest },
				d.txHash,
			);
		}
	}, [client, me, signer, ledger, match, statusOf, now, network, treasury]);
}
