import type { Address, Network, PendingReturn } from "@hl-tools/core";
import { MAX_PENDING_RETURNS } from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { useStaking } from "../live/useStaking";
import {
	amountText,
	compareAmount,
	compareNumber,
	explorerTxUrl,
} from "../model/chain/columns";
import { shortAddress } from "../model/parts";
import {
	STAKING,
	type StakeRow,
	type StakingHistoryRow,
	stakingView,
} from "../model/staking";
import { untilWords } from "../model/time";
import { Checked } from "../shell/Checked";
import { type DataColumn, DataTable } from "../shell/DataTable";
import { Help } from "../shell/Help";
import { Card, linkButton, Tag } from "../shell/kit";
import { Figure, useNow, When } from "../shell/live";
import type { LiveTreasuryState } from "../useTreasuryState";

/** A validator by the name it gave itself, always with its address. */
export function ValidatorName({
	address,
	name,
}: {
	address: string;
	name: string;
}) {
	return (
		<span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
			{name && <span className="[overflow-wrap:anywhere]">{name}</span>}
			<span className="font-mono text-xs text-muted-foreground" title={address}>
				{shortAddress(address)}
			</span>
		</span>
	);
}

const hype = (v: string | null) => (v === null ? "…" : amountText(v));

/**
 * The treasury's HYPE in staking: what Hyperliquid reports, asked for once a
 * minute (nothing about staking arrives over the live connection). Read-only;
 * the three buttons open the forms that propose a change.
 */
export function StakingTab({
	network,
	address,
	state,
	frozen,
}: {
	network: Network;
	address: Address;
	state: LiveTreasuryState;
	/** No longer a multi-sig: nothing can be proposed for it. */
	frozen: boolean;
}) {
	const now = useNow();
	const spot = state.live.spot?.find((b) => b.coin === "HYPE") ?? null;
	const staking = useStaking(
		state.target,
		{ stakes: true, history: true, validators: true },
		// HYPE going into staking or landing back changes this: read again then
		state.live.spot === null ? null : (spot?.total ?? "0"),
	);
	const view = useMemo(
		() => stakingView(staking, network, now),
		[staking, network, now],
	);

	const stakes = useMemo<DataColumn<StakeRow>[]>(
		() => [
			{
				id: "validator",
				header: "Validator",
				cell: (r) => <ValidatorName address={r.validator} name={r.name} />,
			},
			{
				id: "amount",
				header: "Staked",
				numeric: true,
				sort: (a, b) => compareAmount(a.amount, b.amount),
				cell: (r) => `${amountText(r.amount)} HYPE`,
			},
			{
				id: "rate",
				header: "Expected rate",
				numeric: true,
				headerExtra: <Help k="expectedRate" />,
				cell: (r) =>
					r.idle ? (
						<Tag
							tone="warn"
							title="A stake with this validator earns nothing as things stand."
						>
							{r.idle}
						</Tag>
					) : r.rate ? (
						`${r.rate} a year`
					) : (
						"—"
					),
			},
			{
				id: "unstake",
				header: "Can be unstaked",
				headerExtra: <Help k="stakeLockup" />,
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
		],
		[now],
	);
	const returns = useMemo<DataColumn<PendingReturn>[]>(
		() => [
			{
				id: "amount",
				header: "Amount",
				numeric: true,
				cell: (r) => `${amountText(r.amount)} HYPE`,
			},
			{
				id: "lands",
				header: "Lands in spot",
				cell: (r) => (
					<span>
						<When at={r.landsAt} /> · {untilWords(r.landsAt, now)}
					</span>
				),
			},
		],
		[now],
	);
	const history = useMemo<DataColumn<StakingHistoryRow>[]>(
		() => [
			{
				id: "time",
				header: "Time",
				sort: (a, b) => compareNumber(a.time, b.time),
				descFirst: true,
				cell: (r) => (
					<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
						<When at={r.time} />
						{r.hash && (
							<a
								href={explorerTxUrl(network, r.hash)}
								target="_blank"
								rel="noreferrer"
								aria-label="Open this transaction on Hyperliquid's explorer"
								title="Open this transaction on Hyperliquid's explorer"
								className="text-muted-foreground hover:text-foreground"
							>
								<ExternalLink className="size-3" aria-hidden />
							</a>
						)}
					</span>
				),
			},
			{ id: "what", header: "What", cell: (r) => r.text },
		],
		[network],
	);

	const reading = staking.pending
		? "Reading from Hyperliquid…"
		: "Could not be read from Hyperliquid.";
	const propose = (kind: "stake" | "returnToSpot" | "moveStake") => (
		<Link
			to="/multisig/propose"
			search={{ treasury: address, network, kind }}
			className={linkButton}
		>
			{STAKING.kinds[kind].label}
		</Link>
	);
	const places = view.places ?? 0;

	return (
		<div className="flex flex-col gap-4">
			<p className="text-xs text-muted-foreground">
				HYPE this treasury has in staking, as Hyperliquid reports it. Nothing
				here is stored by this tool. <Help k="staking" />
			</p>

			<Card
				title="Staking"
				actions={
					frozen ? null : (
						<>
							{propose("stake")}
							{propose("returnToSpot")}
							{propose("moveStake")}
						</>
					)
				}
				flush
				footer={
					<Checked
						observedAt={staking.checkedAt}
						checking={staking.checking}
						failed={staking.failed}
						refetch={staking.refetch}
						now={now}
						what="the staking figures"
						help="stakingChecked"
					/>
				}
			>
				<dl className="grid grid-cols-1 divide-y divide-border min-[641px]:grid-cols-2 min-[641px]:divide-x min-[901px]:grid-cols-4 min-[901px]:divide-y-0">
					<Figure
						label="In spot"
						value={state.live.spot === null ? "…" : hype(spot?.total ?? "0")}
						unit="HYPE"
					/>
					<Figure
						label="Staking balance, not staked"
						extra={<Help k="stakingBalance" />}
						value={hype(view.undelegated)}
						unit="HYPE"
					/>
					<Figure label="Staked" value={hype(view.delegated)} unit="HYPE" />
					<Figure
						label="On its way back to spot"
						extra={<Help k="returnQueue" />}
						value={hype(view.pending)}
						unit="HYPE"
					/>
				</dl>
			</Card>

			<Card title="Staked with" flush>
				<DataTable
					label="Stakes"
					columns={stakes}
					rows={view.stakes ?? []}
					rowKey={(r) => r.validator}
					empty={view.stakes === null ? reading : "Nothing is staked."}
				/>
			</Card>

			<Card
				title="On its way back to spot"
				actions={
					view.places === null ? null : (
						<span className="text-xs text-muted-foreground">
							{places} of {MAX_PENDING_RETURNS} places used
						</span>
					)
				}
				flush
			>
				{view.returns === null && places > 0 ? (
					<p className="px-4 py-3 text-sm text-muted-foreground">
						{places === 1 ? "1 return is" : `${places} returns are`} waiting,{" "}
						{hype(view.pending)} HYPE in all. Hyperliquid's list does not say
						when each was started, so no landing time is shown.
					</p>
				) : (
					<DataTable
						label="Returns on their way back to spot"
						columns={returns}
						rows={view.returns ?? []}
						rowKey={(r) => `${r.startedAt}:${r.amount}`}
						empty={
							view.places === null ? reading : "Nothing is on its way back."
						}
					/>
				)}
			</Card>

			<Card
				title="Staking history"
				flush
				footer="Hyperliquid's own list of this account's staking steps. A return that lands is Hyperliquid's own step and has no transaction."
			>
				<DataTable
					label="Staking steps"
					columns={history}
					rows={view.history ?? []}
					rowKey={(r) => r.key}
					initialSort={{ id: "time", desc: true }}
					empty={view.history === null ? reading : "No staking steps yet."}
				/>
			</Card>
		</div>
	);
}
