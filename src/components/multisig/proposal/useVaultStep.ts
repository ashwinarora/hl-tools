import {
	type LedgerRow,
	type Proposal,
	VAULT_LOCKUP_MARGIN_MS,
	type VaultAction,
	type VaultInfo,
	vaultActionOf,
	vaultLockupOf,
} from "@hl-tools/core";
import { useMemo } from "react";
import type { AccountTarget } from "#/components/tools/multisig/model";
import { useVault, useVaults, type Vaults } from "../live/useVaults";
import { type VaultRecord, vaultRecord } from "../model/chain/vaultRecord";
import { lockupWords, VAULT } from "../model/vault";

export interface VaultStepState {
	/** Null when the proposal's action is no vault action. */
	readonly step: VaultAction | null;
	readonly vaults: Vaults;
	/** The vault as Hyperliquid reports it now; null while not read, or when it is no vault. */
	readonly vault: VaultInfo | null;
	/**
	 * A withdrawal from a deposit that is still locked: Hyperliquid refuses it
	 * before this moment (the lockup's end and a few seconds). Null otherwise,
	 * and while the deposits are not read.
	 */
	readonly heldUntil: number | null;
	/**
	 * A deposit into a vault the treasury already has money in: the amber line
	 * that all of it is locked again. Read for every signer who opens it.
	 */
	readonly relocks: string | null;
	/**
	 * A withdrawal whose vault could not be read: what it releases is not
	 * known, and the worth stands in for it (audit F-073). Null otherwise.
	 */
	readonly releasesUnread: string | null;
	/**
	 * Whether the account's ledger already holds a row like this step. Null
	 * when the action is no vault action or nothing is asked.
	 */
	readonly record: VaultRecord | null;
}

/**
 * What a page has to know about a proposal that is a vault deposit or
 * withdrawal, read from Hyperliquid for as long as it can still be signed or
 * sent: the vault's name, the end of the lockup a withdrawal waits for, that
 * adding to a deposit locks all of it again, and whether the ledger already
 * shows a row like it (the only trace of a submission whose answer was lost:
 * a vault action carries no number of its own).
 */
export function useVaultStep(
	proposal: Proposal,
	/** False once the proposal is settled: nothing is asked any more. */
	active: boolean,
	/** The treasury's ledger as the page follows it; null while it is not read. */
	ledger: readonly LedgerRow[] | null,
): VaultStepState {
	const { action, nonce, network, multiSigUser } = proposal.payload;
	const madeAt = proposal.meta.createdAt;
	const step = useMemo(() => vaultActionOf(action), [action]);
	const target = useMemo<AccountTarget | null>(
		() => (step && active ? { address: multiSigUser, network } : null),
		[step, active, multiSigUser, network],
	);
	const vaults = useVaults(target);
	// the name is read also for a settled proposal: it is what the page calls the vault
	const lookup = useVault(network, step ? step.vault : null, multiSigUser);
	const vault = lookup.lookup?.kind === "vault" ? lookup.lookup.vault : null;

	const record = useMemo<VaultRecord | null>(
		() => (target ? vaultRecord({ action, nonce, madeAt, ledger }) : null),
		[target, action, nonce, madeAt, ledger],
	);
	const lockedUntil =
		step && vaults.deposits ? vaultLockupOf(step, vaults.deposits) : null;
	const held =
		step?.kind === "deposit"
			? (vaults.deposits?.find((d) => d.vault === step.vault) ?? null)
			: null;
	return {
		step,
		vaults,
		vault,
		heldUntil: lockedUntil ? lockedUntil + VAULT_LOCKUP_MARGIN_MS : null,
		relocks: held
			? `The treasury already has money in this vault. This adds to it, which locks all of it again: none of it can be withdrawn for ${lockupWords(held.vault, network)}.`
			: null,
		releasesUnread:
			active &&
			step?.kind === "withdraw" &&
			lookup.lookup?.kind === "unreadable"
				? VAULT.releasesUnread
				: null,
		record,
	};
}
