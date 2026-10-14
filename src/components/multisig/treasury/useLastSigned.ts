import type { Address, Network } from "@hl-tools/core";
import { useQuery } from "@tanstack/react-query";
import {
	type LastSigned,
	lastSigned,
	missedByWindow,
	SIGNED_WINDOW,
	type SignedRow,
} from "../model/relay/lastSigned";
import { lastSignatureOf, listSignatureEvents } from "../relay/api";
import { unwrap } from "../relay/queries";
import { useRelay } from "../relay/useRelay";

/**
 * When each signer of a treasury last signed one of its proposals through
 * the relay. One read of the newest signatures; a signer that read did not
 * reach is asked about by itself (one row). Under the relay's key, so a new
 * signature anywhere re-reads it. Null while nothing is known.
 */
export function useLastSigned(
	network: Network,
	treasury: Address,
	signers: readonly Address[],
	/** The relay lists this treasury for the wallet: only then may it be asked. */
	enabled: boolean,
): ReadonlyMap<Address, LastSigned> | null {
	const relay = useRelay();
	const client = relay.client;
	const query = useQuery({
		queryKey: [
			"relay",
			relay.wallet,
			"last-signed",
			network,
			treasury,
			signers.join(","),
		],
		enabled: enabled && !!client && signers.length > 0,
		staleTime: 60_000,
		retry: 1,
		queryFn: async (): Promise<ReadonlyMap<Address, LastSigned>> => {
			if (!client) throw new Error("not signed in");
			const { rows } = unwrap(
				await listSignatureEvents(client, network, treasury, SIGNED_WINDOW),
			);
			const complete = rows.length < SIGNED_WINDOW;
			const single = new Map<Address, SignedRow | null>();
			for (const s of missedByWindow(rows, signers, complete)) {
				const one = await lastSignatureOf(client, network, treasury, s);
				// a read that failed leaves the signer unknown: nothing is claimed
				if (!one.issue) single.set(s, one.data);
			}
			return lastSigned({ rows, signers, complete, single });
		},
	});
	return query.data ?? null;
}
