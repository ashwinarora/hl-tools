/**
 * The live signer set (what the chain says now) against the relay's stored
 * copy. A difference is what makes a signer's browser ask for a re-check.
 */
import type { Address, Policy } from "@hl-tools/core";

export interface StoredPolicy {
	readonly signers: readonly Address[];
	readonly threshold: number;
	readonly frozen: boolean;
}

export interface SignerDiff {
	readonly same: boolean;
	readonly added: readonly Address[];
	readonly removed: readonly Address[];
	readonly thresholdChanged: boolean;
	/** The chain no longer reports a signer set, and the copy does not know yet. */
	readonly noLongerMultisig: boolean;
	/** The copy is frozen but the chain reports a signer set again. */
	readonly multisigAgain: boolean;
}

/**
 * `live` is null while it is unknown (still loading, or the read failed): no
 * verdict then. An empty signer list means "not a multi-sig".
 */
export function compareSigners(
	live: Policy | null | undefined,
	stored: StoredPolicy,
): SignerDiff | null {
	if (!live) return null;
	const isMultisig = live.authorizedUsers.length > 0;
	if (!isMultisig) {
		return {
			same: stored.frozen,
			added: [],
			removed: [],
			thresholdChanged: false,
			noLongerMultisig: !stored.frozen,
			multisigAgain: false,
		};
	}
	const added = live.authorizedUsers.filter((a) => !stored.signers.includes(a));
	const removed = stored.signers.filter(
		(a) => !live.authorizedUsers.includes(a),
	);
	const thresholdChanged = live.threshold !== stored.threshold;
	return {
		same:
			!stored.frozen &&
			added.length === 0 &&
			removed.length === 0 &&
			!thresholdChanged,
		added,
		removed,
		thresholdChanged,
		noLongerMultisig: false,
		multisigAgain: stored.frozen,
	};
}
