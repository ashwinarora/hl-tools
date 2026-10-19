import { type Address, infoClient, type Network } from "@hl-tools/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { SignerLookups } from "../model/lookups";
import { type SignerCheck, signerCheck } from "../model/signerSet";

const NONE: ReadonlyMap<string, SignerCheck> = new Map();

/**
 * What Hyperliquid says about the addresses someone wants as signers: whether
 * each was ever used, what kind of address it is and whether it is itself a
 * multi-sig. Asked about once per address, two addresses at a time (see
 * `SignerLookups`); `recheck` asks again about one.
 */
export function useSignerChecks(
	network: Network,
	/** The addresses that would be new signers, lowercased. */
	addresses: readonly Address[],
): {
	readonly checks: ReadonlyMap<string, SignerCheck>;
	recheck(address: Address): void;
} {
	const [checks, setChecks] = useState(NONE);
	const lookups = useRef<SignerLookups | null>(null);
	useEffect(() => {
		const client = infoClient(network);
		const q: SignerLookups = new SignerLookups(
			async (address) => {
				const [role, policy] = await Promise.all([
					client.userRole(address, { fresh: true }),
					client.multiSigSigners(address, { fresh: true }),
				]);
				return signerCheck(role.data, policy.data);
			},
			() => setChecks(q.snapshot()),
		);
		lookups.current = q;
		setChecks(NONE);
		return () => {
			q.stop();
			lookups.current = null;
		};
	}, [network]);
	// the list by value: a new array with the same addresses asks nothing
	const key = addresses.join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `addresses`; `network` re-asks after the queue was replaced
	useEffect(() => {
		lookups.current?.want(addresses);
	}, [key, network]);
	const recheck = useCallback(
		(address: Address) => lookups.current?.recheck(address),
		[],
	);
	return { checks, recheck };
}
