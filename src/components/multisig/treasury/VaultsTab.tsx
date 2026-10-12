import type { Address, Network } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useVaultDetails, useVaults } from "../live/useVaults";
import { compareAmount, compareNumber } from "../model/chain/columns";
import { shortAddress } from "../model/parts";
import { signingNetwork } from "../model/signingNetwork";
import { untilWords } from "../model/time";
import { usdcShown, VAULT, type VaultRow, vaultsView } from "../model/vault";
import { Checked } from "../shell/Checked";
import { type DataColumn, DataTable } from "../shell/DataTable";
import { Help } from "../shell/Help";
import { Card, linkButton, linkButtonSm, Tag } from "../shell/kit";
import { Figure, useNow, When } from "../shell/live";
import type { LiveTreasuryState } from "../useTreasuryState";

const usdc = (v: string | null) => (v === null ? "…" : usdcShown(v));

/**
 * The treasury's money in vaults: what Hyperliquid reports, asked for once a
 * minute (nothing about vaults arrives over the live connection). Read-only;
 * the buttons open the forms that propose a deposit or a withdrawal.
 */
export function VaultsTab({
	network,
	address,
	state,
	frozen,
	canPropose,
}: {
	network: Network;
	address: Address;
	state: LiveTreasuryState;
	/** No longer a multi-sig: nothing can be proposed for it. */
	frozen: boolean;
	/** The connected wallet is one of its signers. */
	canPropose: boolean;
}) {
	const now = useNow();
	const vaults = useVaults(state.target);
	const addresses = useMemo(
		() => vaults.deposits?.map((d) => d.vault) ?? [],
		[vaults.deposits],
	);
	const details = useVaultDetails(network, addresses, address);
	const view = useMemo(
		() => vaultsView(vaults.deposits, details, network, now),
		[vaults.deposits, details, network, now],
	);
	// a vault action is signed as a code: without the signing network this copy cannot propose one
	const offer = !frozen && canPropose && signingNetwork() !== null;

	const columns = useMemo<DataColumn<VaultRow>[]>(
		() => [
			{
				id: "vault",
				header: "Vault",
				cell: (r) => (
					<span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
						<span className="[overflow-wrap:anywhere]">
							{r.hlp ? "HLP" : r.name || "Vault"}
						</span>
						<span
							className="font-mono text-xs text-muted-foreground"
							title={r.vault}
						>
							{shortAddress(r.vault)}
						</span>
						{r.shut && (
							<Tag title="Nothing more can be deposited into it. What is in it can still be withdrawn.">
								takes no deposits
							</Tag>
						)}
					</span>
				),
			},
			{
				id: "equity",
				header: "Worth now",
				numeric: true,
				sort: (a, b) => compareAmount(a.equity, b.equity),
				descFirst: true,
				cell: (r) => `${usdc(r.equity)} USDC`,
			},
			{
				id: "pnl",
				header: "Profit so far",
				numeric: true,
				cell: (r) => (r.pnl === null ? "…" : `${usdc(r.pnl)} USDC`),
			},
			{
				id: "since",
				header: "Since",
				sort: (a, b) => compareNumber(a.since ?? 0, b.since ?? 0),
				cell: (r) => (r.since === null ? "…" : <When at={r.since} />),
			},
			{
				id: "withdraw",
				header: "Can be withdrawn",
				headerExtra: <Help k="vaultLockup" />,
				sort: (a, b) => compareNumber(a.lockedUntil, b.lockedUntil),
				cell: (r) =>
					r.locked ? (
						<span>
							from <When at={r.lockedUntil} /> ·{" "}
							{untilWords(r.lockedUntil, now)}
						</span>
					) : (
						"now"
					),
			},
			...(offer
				? [
						{
							id: "act",
							header: "",
							cell: (r: VaultRow) => (
								<Link
									to="/multisig/propose"
									search={{ treasury: address, network, kind: "vaultWithdraw" }}
									className={linkButtonSm}
									aria-label={`Withdraw from ${r.hlp ? "HLP" : r.name || shortAddress(r.vault)}`}
								>
									Withdraw
								</Link>
							),
						} satisfies DataColumn<VaultRow>,
					]
				: []),
		],
		[now, offer, address, network],
	);

	const reading = vaults.pending
		? "Reading from Hyperliquid…"
		: "Could not be read from Hyperliquid.";

	return (
		<div className="flex flex-col gap-4">
			<p className="text-xs text-muted-foreground">
				USDC this treasury has in vaults, as Hyperliquid reports it. Nothing
				here is stored by this tool. <Help k="vault" />
			</p>

			<Card
				title="Vaults"
				actions={
					offer ? (
						<Link
							to="/multisig/propose"
							search={{ treasury: address, network, kind: "vaultDeposit" }}
							className={linkButton}
						>
							{VAULT.kinds.vaultDeposit.label}
						</Link>
					) : null
				}
				flush
				footer={
					<Checked
						observedAt={vaults.checkedAt}
						checking={vaults.checking}
						failed={vaults.failed}
						refetch={vaults.refetch}
						now={now}
						what="the vault figures"
						help="vaultsChecked"
					/>
				}
			>
				<dl className="grid grid-cols-1 divide-y divide-border border-b border-border min-[641px]:grid-cols-2 min-[641px]:divide-x min-[641px]:divide-y-0">
					<Figure label="In vaults" value={usdc(view.total)} unit="USDC" />
					<Figure
						label="Vaults"
						value={view.rows === null ? "…" : String(view.rows.length)}
					/>
				</dl>
				<DataTable
					label="Vault deposits"
					columns={columns}
					rows={view.rows ?? []}
					rowKey={(r) => r.vault}
					initialSort={{ id: "equity", desc: true }}
					empty={
						view.rows === null
							? reading
							: "This treasury has nothing in a vault."
					}
				/>
			</Card>
			<p className="text-xs text-subtle-foreground">
				{VAULT.risk} {VAULT.noRecommendation}
			</p>
		</div>
	);
}
