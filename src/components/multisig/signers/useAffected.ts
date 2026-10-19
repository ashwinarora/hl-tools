import type { Policy, SignerSet } from "@hl-tools/core";
import { useEffect, useMemo, useState } from "react";
import {
	type Affected,
	affectedProposals,
	type OnRecord,
	waitingProposals,
} from "../model/signerSet";

const NONE: readonly Affected[] = [];

/**
 * What a change of signers does to the proposals still waiting, counted from
 * the documents the page already holds: no request is made. Signatures are
 * recovered to count them, so the answer arrives a moment later.
 */
export function useAffected(
	known: readonly OnRecord[],
	current: Pick<Policy, "authorizedUsers" | "threshold"> | null,
	/** The signers afterwards; `"revert"` for the conversion back; null: nothing to judge yet. */
	next: SignerSet | "revert" | null,
	/** The proposal that carries the change, when it exists already. */
	exclude?: string | null,
): { readonly affected: readonly Affected[]; readonly computing: boolean } {
	const [result, setResult] = useState<{
		key: string;
		affected: readonly Affected[];
	} | null>(null);
	// by value: the lists are rebuilt on every render of their owners
	const key = useMemo(
		() =>
			current && next
				? JSON.stringify([
						current.authorizedUsers,
						current.threshold,
						next,
						exclude ?? null,
						known.map((k) => [
							k.digest,
							k.status,
							k.accepted,
							k.proposal.signatures.length,
						]),
					])
				: "",
		[known, current, next, exclude],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for everything read here
	useEffect(() => {
		if (!current || !next) return;
		let cancelled = false;
		void affectedProposals(
			waitingProposals(known, Date.now()),
			current,
			next === "revert" ? null : next,
			exclude,
		).then((affected) => {
			if (!cancelled) setResult({ key, affected });
		});
		return () => {
			cancelled = true;
		};
	}, [key]);
	if (key === "") return { affected: NONE, computing: false };
	return result?.key === key
		? { affected: result.affected, computing: false }
		: { affected: NONE, computing: true };
}
