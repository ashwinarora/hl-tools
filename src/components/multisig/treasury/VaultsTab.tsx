import type { Address, Network } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import type { ChainMatch } from "../live/useChainMatch";
import { useVaultDetails, useVaults } from "../live/useVaults";
import {
	amountText,
	compareAmount,
	compareNumber,
	compareText,
} from "../model/chain/columns";
import { shortAddress } from "../model/parts";
import { signingNetwork } from "../model/signingNetwork";
import { untilWords } from "../model/time";
import {
	VAULT,
	VAULT_EVENT,
	VAULT_HISTORY,
	type VaultEvent,
	type VaultRow,
	vaultHistory,
	vaultLabel,
	vaultsView,
} from "../model/vault";
import { Checked } from "../shell/Checked";
import { type DataColumn, DataTable } from "../shell/DataTable";
import { Help } from "../shell/Help";
import { Card, linkButton, linkButtonSm, Tag } from "../shell/kit";
import { Figure, Usdc, useNow, When } from "../shell/live";
import type { LiveTreasuryState } from "../useTreasuryState";
import { ProposalCell, TimeCell } from "./ledgerCells";
import type { KnownProposal, KnownState } from "./useKnownProposals";

/**
 * The treasury's money in vaults: what Hyperliquid reports, asked for once a
 * minute (what a deposit is worth arrives on no live channel). Below it, the
 * history: the vault rows of the account's ledger, which Hyperliquid pushes
 * as they happen, each with the proposal on record that agrees with it, if
 * one does. Read-only; the buttons open the forms that propose a deposit or
 * a withdrawal.
 */
export function VaultsTab({
	network,
	address,
	state,
	frozen,
	canPropose,
	proposals,
	proposalsState,
	match,
}: {
	network: Network;
	address: Address;
	state: LiveTreasuryState;
	/** No longer a multi-sig: nothing can be proposed for it. */
	frozen: boolean;
	/** The connected wallet is one of its signers. */
	canPropose: boolean;
	/** Every proposal on record for this treasury: what a row of the history is tied to. */
	proposals: readonly KnownProposal[];
	proposalsState: KnownState;
	/** Which proposal each ledger row belongs to (worked out by the page, once for all its tabs). */
	match: ChainMatch;
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
							{/* Hyperliquid's own vault is told by its address and named
							    plainly; any other vault's name is its leader's word, shown
							    as a quotation, so one that calls itself "HLP" does not read
							    like the real one */}
							{r.hlp ? (
								"HLP"
							) : r.name ? (
								<>
									“<bdi>{r.name}</bdi>”
								</>
							) : (
								"Vault"
							)}
						</span>
						{r.hlp && <Tag>Hyperliquid's own vault</Tag>}
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
				cell: (r) => (
					<>
						<Usdc value={r.equity} /> USDC
					</>
				),
			},
			{
				id: "pnl",
				header: "Profit so far",
				numeric: true,
				cell: (r) =>
					r.pnl === null ? (
						"…"
					) : (
						<>
							<Usdc value={r.pnl} /> USDC
						</>
					),
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
									// the form opens on this row's vault
									search={{
										treasury: address,
										network,
										kind: "vaultWithdraw",
										vault: r.vault,
									}}
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

	// ---- the history: the ledger's vault rows, as Hyperliquid pushes them
	const ledger = state.live.ledger;
	const events = useMemo(() => vaultHistory(ledger), [ledger]);
	const titles = useMemo(
		() => new Map(proposals.map((p) => [p.digest as string, p.title])),
		[proposals],
	);
	// a vault's own name, where its details were read for the table above
	const names = useMemo(() => {
		const m = new Map<string, string>();
		for (const r of view.rows ?? []) if (r.name) m.set(r.vault, r.name);
		return m;
	}, [view.rows]);
	const history = useMemo<DataColumn<VaultEvent>[]>(
		() => [
			{
				id: "time",
				header: "Time",
				descFirst: true,
				sort: (a, b) => compareNumber(a.time, b.time),
				cell: (r) => (
					<TimeCell at={r.time} network={network} hash={r.row.hash} />
				),
			},
			{
				id: "what",
				header: "What",
				sort: (a, b) => compareText(VAULT_EVENT[a.kind], VAULT_EVENT[b.kind]),
				cell: (r) => VAULT_EVENT[r.kind],
			},
			{
				id: "vault",
				header: "Vault",
				sort: (a, b) => compareText(a.vault, b.vault),
				cell: (r) =>
					r.vault === null ? (
						"—"
					) : (
						<span title={r.vault} className="[overflow-wrap:anywhere]">
							{vaultLabel(r.vault, network, names.get(r.vault))}
						</span>
					),
			},
			{
				id: "amount",
				header: "Amount",
				numeric: true,
				sort: (a, b) => compareAmount(a.amount, b.amount),
				cell: (r) =>
					r.amount === null ? (
						"—"
					) : (
						<>
							{amountText(r.amount)}
							<span className="ml-1.5 font-sans text-xs text-muted-foreground">
								USDC
							</span>
						</>
					),
			},
			{
				id: "share",
				header: "Leader's share",
				numeric: true,
				sort: (a, b) => compareAmount(a.leaderShare, b.leaderShare),
				cell: (r) =>
					r.leaderShare === null && r.closingCost === null ? (
						"—"
					) : (
						<span
							title={
								r.closingCost === null
									? "Kept by the vault's leader out of the profit on what was withdrawn."
									: `Kept by the vault's leader out of the profit on what was withdrawn. Closing positions for this withdrawal cost another ${amountText(r.closingCost)} USDC.`
							}
						>
							{amountText(r.leaderShare ?? "0")}
							<span className="ml-1.5 font-sans text-xs text-muted-foreground">
								USDC
							</span>
						</span>
					),
			},
			{
				id: "proposal",
				header: "Proposal",
				headerExtra: <Help k="vaultRowProposal" />,
				cell: (r) => (
					<ProposalCell
						match={match.of(r.row)}
						titles={titles}
						onRetry={() => match.retry(r.row)}
					/>
				),
				cellClass: () => "whitespace-normal min-w-40",
			},
		],
		[network, match, titles, names],
	);

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
					<Figure
						label="In vaults"
						value={<Usdc value={view.total} />}
						unit="USDC"
					/>
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

			<Card
				title={VAULT_HISTORY.title}
				flush
				footer={
					<>
						<span>
							{VAULT_HISTORY.about}
							{state.live.gaps.includes("ledger") && ` ${VAULT_HISTORY.gap}`}
						</span>
						<Link
							to="/multisig/t/$network/$address"
							params={{ network, address }}
							search={{ tab: "chain" }}
							className="whitespace-nowrap text-brand underline underline-offset-2"
						>
							{VAULT_HISTORY.all}
						</Link>
					</>
				}
			>
				<DataTable
					label="Vault history"
					columns={history}
					rows={events ?? []}
					rowKey={(r) => r.key}
					initialSort={{ id: "time", desc: true }}
					empty={events === null ? VAULT_HISTORY.reading : VAULT_HISTORY.none}
				/>
			</Card>
			<p className="mx-0.5 -mt-2 text-xs text-subtle-foreground">
				{proposalsState === "unavailable"
					? VAULT_HISTORY.unmatched
					: VAULT_HISTORY.matched}
			</p>
		</div>
	);
}
