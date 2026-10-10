import {
	type AccountAssessment,
	type Address,
	assessAccount,
	type DescribeContext,
	describeAction,
	formatHype,
	MULTISIG_FACTS,
	type Network,
	type PlainObject,
	type Policy,
} from "@hl-tools/core";
import { Loader2, RefreshCw, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { CodeBlock } from "#/components/hub/CodeBlock";
import {
	EmptyState,
	Field,
	KeyValueGrid,
	Panel,
	TextInput,
	Workspace,
} from "#/components/hub/layout";
import {
	Callout,
	IssueList,
	NetworkBadge,
	ObservedLine,
	Pill,
} from "#/components/hub/status";
import { Button } from "#/components/ui/button";
import { AddressLine } from "./AddressLine";
import { type AccountTarget, ADDRESS_RE } from "./model";
import {
	type AccountData,
	type Section,
	useAccount,
	useEvmBalance,
	useHistory,
	useSignerPolicies,
} from "./useAccount";
import { useCoinNames } from "./useCoinNames";

const TABLE = "scrollbar-thin overflow-x-auto rounded-md border border-border";
const TH =
	"border-b border-border bg-surface-2 text-left text-2xs uppercase tracking-wide text-subtle-foreground";
const TD = "px-3 py-1.5 align-top";

function SectionError({ what, error }: { what: string; error: string }) {
	return (
		<Callout tone="danger" title={`Could not load ${what}`}>
			{error}
		</Callout>
	);
}

export function AccountView({
	input,
	onInput,
	onLookup,
	target,
	network,
	onRelookup,
	onSample,
}: {
	input: string;
	onInput: (v: string) => void;
	onLookup: () => void;
	target: AccountTarget | null;
	network: Network;
	onRelookup: () => void;
	onSample: () => void;
}) {
	const query = useAccount(target);
	const valid = ADDRESS_RE.test(input.trim());
	const staleNetwork = target !== null && target.network !== network;
	return (
		<Workspace
			input={
				<>
					<Panel
						title="Account"
						description="Any HyperCore address. Everything shown is fetched from Hyperliquid when you look it up; nothing is stored."
					>
						<form
							className="space-y-3"
							onSubmit={(e) => {
								e.preventDefault();
								onLookup();
							}}
						>
							<Field
								label="Address"
								htmlFor="ms-address"
								hint="Looked up on the network selected in the header."
								error={
									input.trim() && !valid
										? "A 20-byte hex address: 0x followed by 40 hex digits."
										: undefined
								}
							>
								<TextInput
									id="ms-address"
									mono
									value={input}
									onChange={(e) => onInput(e.target.value)}
									placeholder="0xf8365a35694f401a554e4ffa51b5afe3b203d148"
									spellCheck={false}
									autoComplete="off"
								/>
							</Field>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="submit"
									size="sm"
									variant="brand"
									disabled={!valid}
								>
									Look up on {network}
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={onSample}
								>
									Try with a sample
								</Button>
							</div>
						</form>
					</Panel>
					<Callout tone="neutral" title="What the chain can and cannot tell">
						The signer set, threshold and API wallets come from the info API.
						The chain has no reverse index: it cannot list the multi-sigs an
						address is a signer of, and the explorer attributes envelope actions
						to the multi-sig user without the leader or the signatures.
					</Callout>
				</>
			}
			output={
				!target ? (
					<EmptyState
						icon={UsersRound}
						title="Look up a multi-sig account"
						description="Signers and threshold, approved API wallets (which bypass the multi-sig for trading), balances, open orders, health flags and recent actions."
						sample="0xf8365a35694f401a554e4ffa51b5afe3b203d148"
						action={
							<Button size="sm" variant="outline" onClick={onSample}>
								Try with a sample
							</Button>
						}
					/>
				) : (
					<div className="space-y-4">
						{staleNetwork && (
							<Callout
								tone="warning"
								title={`This lookup ran on ${target.network}; you are now on ${network}`}
								action={
									<Button size="sm" variant="outline" onClick={onRelookup}>
										Look up the same address on {network}
									</Button>
								}
							>
								The same address is a different account on each network.
							</Callout>
						)}
						{query.isPending ? (
							<div className="space-y-3" aria-busy="true">
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Loader2 className="size-4 animate-spin" aria-hidden />{" "}
									Fetching from {target.network}…
								</div>
								<div className="h-40 animate-pulse rounded-lg border border-border bg-surface" />
								<div className="h-64 animate-pulse rounded-lg border border-border bg-surface" />
							</div>
						) : query.isError ? (
							<Callout
								tone="danger"
								title="Lookup failed"
								action={
									<Button
										size="sm"
										variant="outline"
										onClick={() => query.refetch()}
									>
										<RefreshCw className="size-3.5" aria-hidden /> Retry
									</Button>
								}
							>
								{String((query.error as Error)?.message ?? query.error)}
							</Callout>
						) : (
							<AccountResult
								data={query.data}
								target={target}
								onRefresh={() => query.refetch()}
								refreshing={query.isFetching}
							/>
						)}
					</div>
				)
			}
		/>
	);
}

function AccountResult({
	data,
	target,
	onRefresh,
	refreshing,
}: {
	data: AccountData;
	target: AccountTarget;
	onRefresh: () => void;
	refreshing: boolean;
}) {
	const policy: Policy | null = data.policy.ok
		? data.policy.observed.data
		: null;
	const signers = policy?.authorizedUsers ?? [];
	const [checkSigners, setCheckSigners] = useState(false);
	const [checkEvm, setCheckEvm] = useState(false);
	const [loadHistory, setLoadHistory] = useState(false);
	const nesting = useSignerPolicies(target, signers, checkSigners);
	const coins = useCoinNames(data.network);
	const evm = useEvmBalance(target, checkEvm);
	const history = useHistory(target, loadHistory);

	const assessment: AccountAssessment = useMemo(
		() =>
			assessAccount({
				address: data.address as Address,
				policy,
				role: data.role?.ok ? data.role.observed.data : null,
				agents: data.agents.ok ? data.agents.observed.data : null,
				signerPolicies: nesting.data?.data ?? {},
				evmBalanceWei: evm.data ? evm.data.data : null,
				now: Date.now(),
			}),
		[data, policy, nesting.data, evm.data],
	);

	return (
		<>
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<AddressLine
						address={data.address}
						network={data.network}
						className="text-sm"
					/>
					<Button
						size="sm"
						variant="outline"
						onClick={onRefresh}
						disabled={refreshing}
					>
						<RefreshCw
							className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
							aria-hidden
						/>{" "}
						Refresh
					</Button>
				</div>
				<ObservedLine
					network={data.network}
					observedAt={data.observedAt}
					source={`${data.requests.length} info requests · weight ${data.requests.reduce((n, r) => n + r.weight, 0)}`}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Pill tone={assessment.isMultiSig ? "success" : "neutral"}>
						{assessment.isMultiSig ? "multi-sig user" : "not a multi-sig"}
					</Pill>
					<span className="text-sm">{assessment.summary}</span>
				</div>
			</div>

			{!data.policy.ok && (
				<SectionError what="the signer set" error={data.policy.error} />
			)}

			<Panel
				title="Health"
				description="Flags the chain will not raise for you."
			>
				<IssueList
					issues={
						assessment.isMultiSig
							? assessment.flags
							: // the header already states the role; do not say it twice
								assessment.flags.filter(
									(f) => f.code !== "account.not_multisig",
								)
					}
					empty={
						assessment.isMultiSig
							? "No flags: a plain multi-sig with no agents and no lock-out risk."
							: "Nothing to flag: this address is not a multi-sig."
					}
				/>
			</Panel>

			{assessment.isMultiSig && (
				<Panel
					title={
						<span className="flex items-center gap-2">
							Signers <NetworkBadge network={data.network} />
						</span>
					}
					description={assessment.summary}
					actions={
						<Button
							size="sm"
							variant="outline"
							onClick={() => setCheckSigners(true)}
							disabled={checkSigners}
						>
							{nesting.isFetching ? (
								<Loader2 className="size-3.5 animate-spin" aria-hidden />
							) : null}
							Check signers for nesting
						</Button>
					}
				>
					<div className={TABLE}>
						<table className="w-full min-w-[420px] border-collapse text-sm">
							<thead>
								<tr className={TH}>
									<th className="px-3 py-1.5 font-medium">#</th>
									<th className="px-3 py-1.5 font-medium">Authorized user</th>
									<th className="px-3 py-1.5 font-medium">Nested multi-sig?</th>
								</tr>
							</thead>
							<tbody>
								{assessment.signers.map((s, i) => (
									<tr
										key={s.address}
										className="border-b border-border/60 last:border-0"
									>
										<td className={`${TD} font-mono text-muted-foreground`}>
											{i + 1}
										</td>
										<td className={TD}>
											<AddressLine address={s.address} network={data.network} />
										</td>
										<td className={TD}>
											{s.nested === "unchecked" ? (
												<span className="text-xs text-muted-foreground">
													not checked
												</span>
											) : s.nested ? (
												<Pill tone="warning">yes</Pill>
											) : (
												<Pill tone="neutral">no</Pill>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{nesting.isError && (
						<SectionError
							what="the signers' own policies"
							error={String((nesting.error as Error).message)}
						/>
					)}
					{nesting.data && (
						<ObservedLine
							className="mt-2"
							network={nesting.data.network}
							observedAt={nesting.data.observedAt}
							source={nesting.data.source}
						/>
					)}
				</Panel>
			)}

			<Panel
				title="Approved API wallets"
				description={MULTISIG_FACTS.find((f) => f.id === "agent-bypass")?.text}
			>
				{!data.agents.ok ? (
					<SectionError what="API wallets" error={data.agents.error} />
				) : assessment.agents.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{assessment.isMultiSig
							? "None. Only the multi-sig can act for this account."
							: "None."}
					</p>
				) : (
					<div className={TABLE}>
						<table className="w-full min-w-[480px] border-collapse text-sm">
							<thead>
								<tr className={TH}>
									<th className="px-3 py-1.5 font-medium">Name</th>
									<th className="px-3 py-1.5 font-medium">Address</th>
									<th className="px-3 py-1.5 font-medium">Valid until</th>
								</tr>
							</thead>
							<tbody>
								{assessment.agents.map((a) => (
									<tr
										key={a.address}
										className="border-b border-border/60 last:border-0"
									>
										<td className={TD}>
											{a.name || (
												<span className="text-muted-foreground">
													main (unnamed)
												</span>
											)}
										</td>
										<td className={TD}>
											<AddressLine address={a.address} network={data.network} />
										</td>
										<td className={`${TD} whitespace-nowrap`}>
											{new Date(a.validUntil).toISOString().slice(0, 10)}{" "}
											{a.expired ? (
												<Pill tone="neutral">expired</Pill>
											) : (
												<Pill tone="warning">active</Pill>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>

			<BalancesPanel
				data={data}
				evm={evm}
				onCheckEvm={() => setCheckEvm(true)}
				checked={checkEvm}
				multiSig={assessment.isMultiSig}
			/>

			<Panel title="Open orders">
				{!data.openOrders.ok ? (
					<SectionError what="open orders" error={data.openOrders.error} />
				) : data.openOrders.observed.data.length === 0 ? (
					<p className="text-sm text-muted-foreground">No open orders.</p>
				) : (
					<div className={TABLE}>
						<table className="w-full min-w-[420px] border-collapse text-sm">
							<thead>
								<tr className={TH}>
									<th className="px-3 py-1.5 font-medium">Coin</th>
									<th className="px-3 py-1.5 font-medium">Side</th>
									<th className="px-3 py-1.5 font-medium">Price</th>
									<th className="px-3 py-1.5 font-medium">Size</th>
									<th className="px-3 py-1.5 font-medium">oid</th>
								</tr>
							</thead>
							<tbody>
								{data.openOrders.observed.data.map((o) => (
									<tr
										key={o.oid}
										className="border-b border-border/60 last:border-0"
									>
										<td className={TD}>{o.coin}</td>
										<td className={TD}>{o.side === "B" ? "buy" : "sell"}</td>
										<td className={`${TD} font-mono`}>{o.limitPx}</td>
										<td className={`${TD} font-mono`}>{o.sz}</td>
										<td className={`${TD} font-mono`}>{o.oid}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>

			<Panel
				title="Recent actions"
				description="From the HyperCore explorer, newest first. Every explorer request weighs 40 of the 1200/min budget, so this is loaded only on request."
				actions={
					!loadHistory ? (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setLoadHistory(true)}
						>
							Load recent actions
						</Button>
					) : (
						<Button
							size="sm"
							variant="outline"
							onClick={() => history.refetch()}
							disabled={history.isFetching}
						>
							<RefreshCw
								className={`size-3.5 ${history.isFetching ? "animate-spin" : ""}`}
								aria-hidden
							/>{" "}
							Reload
						</Button>
					)
				}
			>
				{!loadHistory ? (
					<p className="text-sm text-muted-foreground">
						Not loaded.{" "}
						{assessment.isMultiSig
							? ""
							: "Past conversions to and from multi-sig show up here."}
					</p>
				) : history.isPending ? (
					<div
						className="flex items-center gap-2 text-sm text-muted-foreground"
						aria-busy="true"
					>
						<Loader2 className="size-4 animate-spin" aria-hidden /> Fetching
						from the explorer…
					</div>
				) : history.isError ? (
					<SectionError
						what="recent actions"
						error={String((history.error as Error).message)}
					/>
				) : (
					<HistoryTable
						history={history.data.data}
						network={data.network}
						observedAt={history.data.observedAt}
						coins={coins}
					/>
				)}
			</Panel>

			<Panel
				title="Raw requests"
				description="What this page asked the info API, with each request's rate-limit weight."
			>
				<CodeBlock
					content={data.requests
						.map(
							(r) =>
								`${r.ok ? "ok " : "ERR"} ${r.type.padEnd(24)} weight ${r.weight}`,
						)
						.join("\n")}
					lang="text"
					maxHeight="12rem"
				/>
			</Panel>
		</>
	);
}

function BalancesPanel({
	data,
	evm,
	onCheckEvm,
	checked,
	multiSig,
}: {
	data: AccountData;
	evm: ReturnType<typeof useEvmBalance>;
	onCheckEvm: () => void;
	checked: boolean;
	multiSig: boolean;
}) {
	const perp = data.perp.ok ? data.perp.observed.data : null;
	const spot = data.spot.ok ? data.spot.observed.data : null;
	const items = [
		{
			label: "Perps account value",
			value: perp ? `${perp.marginSummary.accountValue} USDC` : "—",
			mono: true,
		},
		{
			label: "Withdrawable",
			value: perp ? `${perp.withdrawable} USDC` : "—",
			mono: true,
		},
		{
			label: "Open positions",
			value: perp ? String(perp.assetPositions.length) : "—",
			mono: true,
		},
		{
			label: "Spot balances",
			value: spot
				? spot.balances.length
					? spot.balances.map((b) => `${b.total} ${b.coin}`).join(" · ")
					: "none"
				: "—",
			mono: true,
		},
		{
			label: "HyperEVM balance (same address)",
			value: evm.data
				? `${formatHype(evm.data.data)} HYPE`
				: evm.isError
					? "failed"
					: checked
						? "…"
						: "not checked",
			mono: true,
			hint: multiSig
				? "The original key still controls the HyperEVM side after conversion."
				: undefined,
		},
	];
	return (
		<Panel
			title="Balances"
			actions={
				<Button
					size="sm"
					variant="outline"
					onClick={onCheckEvm}
					disabled={checked}
				>
					{evm.isFetching ? (
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
					) : null}
					Check HyperEVM
				</Button>
			}
		>
			{!data.perp.ok && (
				<SectionError what="the perps state" error={data.perp.error} />
			)}
			{!data.spot.ok && (
				<SectionError what="the spot state" error={data.spot.error} />
			)}
			{evm.isError && (
				<SectionError
					what="the HyperEVM balance"
					error={String((evm.error as Error).message)}
				/>
			)}
			<KeyValueGrid items={items} columns={2} />
			{evm.data && (
				<ObservedLine
					className="mt-2"
					network={evm.data.network}
					observedAt={evm.data.observedAt}
					source={evm.data.source}
				/>
			)}
		</Panel>
	);
}

function HistoryTable({
	history,
	network,
	observedAt,
	coins,
}: {
	coins: DescribeContext;
	history: {
		txs: readonly {
			time: number;
			action: { type: string } & Record<string, unknown>;
			hash: string;
			error: string | null;
		}[];
		truncated: boolean;
	};
	network: Network;
	observedAt: number;
}) {
	const explorerTx = (hash: string) =>
		`${network === "mainnet" ? "https://app.hyperliquid.xyz" : "https://app.hyperliquid-testnet.xyz"}/explorer/tx/${hash}`;
	return (
		<div className="space-y-2">
			<ObservedLine
				network={network}
				observedAt={observedAt}
				source={`${history.txs.length} actions${history.truncated ? " (capped: the explorer returns the newest ~101)" : ""}`}
			/>
			<div className={TABLE}>
				<table className="w-full min-w-[560px] border-collapse text-sm">
					<thead>
						<tr className={TH}>
							<th className="px-3 py-1.5 font-medium">Time (UTC)</th>
							<th className="px-3 py-1.5 font-medium">Action</th>
							<th className="px-3 py-1.5 font-medium">Result</th>
						</tr>
					</thead>
					<tbody>
						{history.txs.map((t) => {
							const d = describeAction(t.action as PlainObject, coins);
							return (
								<tr
									key={t.hash}
									className="border-b border-border/60 last:border-0"
								>
									<td className={`${TD} whitespace-nowrap font-mono text-xs`}>
										<a
											href={explorerTx(t.hash)}
											target="_blank"
											rel="noreferrer"
											className="hover:underline"
											title={t.hash}
										>
											{new Date(t.time)
												.toISOString()
												.replace("T", " ")
												.slice(0, 19)}
										</a>
									</td>
									<td className={TD}>
										<span className="font-mono text-xs text-muted-foreground">
											{t.action.type}
										</span>{" "}
										<span>{d.headline}</span>
									</td>
									<td className={TD}>
										{t.error ? (
											<Pill tone="danger" title={t.error}>
												failed
											</Pill>
										) : (
											<Pill tone="success">ok</Pill>
										)}
										{t.error && (
											<span className="ml-2 text-xs text-muted-foreground">
												{t.error}
											</span>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="text-xs text-muted-foreground">
				Envelope actions are recorded as their inner action under this account;
				the leader and the signatures are not on chain.
			</p>
		</div>
	);
}

export type { Section };
