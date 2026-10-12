import { type Address, isNetwork, type Network } from "@hl-tools/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "#/components/hub/CopyButton";
import { Callout } from "#/components/hub/status";
import {
	type AccountTarget,
	ADDRESS_RE,
} from "#/components/tools/multisig/model";
import { Button } from "#/components/ui/button";
import { useMultisigPrefs } from "#/store/multisigPrefsStore";
import { AwayNotice } from "../inbox/AwayNotice";
import { useChainMatch } from "../live/useChainMatch";
import { useSelfTreasury } from "../live/useSelfTreasury";
import { RELAY_COPY } from "../model/relay/copy";
import {
	compareSigners,
	livePolicy,
	nextRecheck,
} from "../model/relay/signers";
import { isItself } from "../model/selfTreasury";
import { shortAddress } from "../model/stage";
import type { TreasuryTab } from "../model/tabs";
import { TreasuryNames, useNames } from "../names/Names";
import { requestTreasury } from "../relay/api";
import { useOpenProposals } from "../relay/openProposals";
import { useRequest, useTreasury } from "../relay/queries";
import { useExecutionReporter } from "../relay/useExecutionReporter";
import { useRelay } from "../relay/useRelay";
import { Help } from "../shell/Help";
import { Card, linkButton, NetTag, SignsTag, TabList, Tag } from "../shell/kit";
import { useNow } from "../shell/live";
import { ShellPage } from "../shell/ShellPage";
import { SignInGate } from "../shell/SignInGate";
import { SwitchToSigner } from "../shell/SwitchToSigner";
import { usePageNetwork } from "../shell/usePageNetwork";
import { useShellWallet } from "../shell/WalletBox";
import { defaultTreasuryName, useTreasuryName } from "../treasuryName";
import { useLiveTreasuryState } from "../useTreasuryState";
import { ChainTab } from "./ChainTab";
import { OverviewTab } from "./OverviewTab";
import { PendingTab } from "./PendingTab";
import { SigningLogTab } from "./SigningLogTab";
import { useKnownProposals } from "./useKnownProposals";

/**
 * The page title: the treasury's nickname, shared by its signers. The pencil
 * opens the nickname dialog; a name this browser already had for the
 * treasury is offered there as the starting value.
 */
function Title({ network, address }: { network: Network; address: Address }) {
	const { name, local } = useTreasuryName(network, address);
	const names = useNames();
	const can = !!names?.canName(address);
	return (
		<span className="inline-flex items-center gap-1.5">
			{name}
			{can && (
				<Button
					size="icon-xs"
					variant="ghost"
					className="text-muted-foreground"
					aria-label="Change this treasury's nickname"
					title="Change this treasury's nickname (its signers see it)"
					onClick={() => names?.edit(address, local ?? undefined)}
				>
					<Pencil aria-hidden />
				</Button>
			)}
		</span>
	);
}

/**
 * One treasury: what it holds and who controls it, what waits for
 * signatures, and what happened. Shown to the wallets in the relay's copy of
 * its signer list; that copy is compared with the live list every time the
 * page is open, and a difference makes the relay look again.
 *
 * What the treasury holds comes straight from Hyperliquid, for the address in
 * the page's own link: it stays on screen when the relay cannot be reached.
 */
export function TreasuryScreen({
	network: rawNetwork,
	address: rawAddress,
	tab,
}: {
	network: string;
	address: string;
	tab: TreasuryTab;
}) {
	const relay = useRelay();
	const navigate = useNavigate();
	const queries = useQueryClient();
	const markSeen = useMultisigPrefs((s) => s.markSeen);

	const valid = isNetwork(rawNetwork) && ADDRESS_RE.test(rawAddress);
	const network: Network = isNetwork(rawNetwork) ? rawNetwork : "mainnet";
	const address = rawAddress.toLowerCase() as Address;
	const { treasury, loading, issue } = useTreasury(
		network,
		valid ? address : null,
	);
	const open = useOpenProposals();
	const me = relay.wallet;
	// The connected wallet is this very account: its signers see the treasury
	// here, the account itself does not, and its key cannot act for it.
	const connected = useShellWallet().address;
	const itself = valid && isItself(connected, address);
	const self = useSelfTreasury(network, itself ? address : null);
	const selfSigners = itself ? (self.policy?.authorizedUsers ?? null) : null;

	// The address in the link names its network: the header follows it when the
	// page opens. A treasury belongs to one network, so when the reader then
	// uses the header's switch, the page is left for that network's own list.
	usePageNetwork(isNetwork(rawNetwork) ? rawNetwork : undefined, () => {
		if (valid) void navigate({ to: "/multisig" });
	});

	useEffect(() => {
		if (treasury) markSeen(treasury.network, treasury.address);
	}, [treasury, markSeen]);

	// Hyperliquid is asked about the address in the link, never about a row of
	// the relay: for a listed treasury, and for a signed-in wallet whose relay
	// has stopped answering.
	const unreachable = relay.mode === "unreachable";
	const watching =
		valid &&
		(!!treasury || unreachable || (relay.mode === "on" && !!selfSigners));
	const target = useMemo<AccountTarget | null>(
		() => (watching ? { address, network } : null),
		[watching, address, network],
	);
	// every proposal on record for this treasury: explains transfers and API wallets
	const known = useKnownProposals(network, address, !!treasury);
	const openHere = useMemo(
		() =>
			open.items.filter(
				(p) => p.open && p.network === network && p.treasury === address,
			),
		[open.items, network, address],
	);
	// Trades, orders and funding are followed only while they are looked at.
	// The ledger is followed then, and while a proposal is pending: that is how
	// this page notices one that was carried out without the tool.
	const live = useLiveTreasuryState(target, {
		history: tab === "chain",
		ledger: openHere.length > 0,
	});
	// With the relay's record unreadable nothing may be called "none on record":
	// rows that could be a proposal's stay "checking…" until it is back.
	const match = useChainMatch(
		target,
		live.live.ledger,
		known.proposals,
		known.state === "ready",
	);
	const statusOf = useCallback(
		(digest: string) =>
			known.proposals.find((p) => p.digest === digest)?.status ?? null,
		[known.proposals],
	);
	const awayScope = useMemo(() => ({ network, address }), [network, address]);
	const clock = useNow();
	useExecutionReporter({
		network,
		treasury: address,
		ledger: live.live.ledger,
		match,
		statusOf,
		signer: !!treasury && !!me && treasury.signers.includes(me),
		now: clock,
	});

	const diff = useMemo(
		() =>
			treasury
				? compareSigners(livePolicy(live.isMultiSig, live.policy), {
						signers: treasury.signers,
						threshold: treasury.threshold,
						frozen: treasury.frozenAt !== null,
					})
				: null,
		[treasury, live.isMultiSig, live.policy],
	);

	// A re-check: asked for by the button, or by this page seeing a difference.
	// The relay answers with a ping.
	const [requestId, setRequestId] = useState<string | null>(null);
	const { request } = useRequest(requestId);
	const client = relay.client;
	const network0 = treasury?.network;
	const address0 = treasury?.address;
	const check = useCallback(async () => {
		if (!client || !me || !network0 || !address0) return;
		const r = await requestTreasury(client, me, network0, address0, "check");
		if (r.data) {
			queries.setQueryData(["relay", me, "request", r.data.id], r.data);
			setRequestId(r.data.id);
		}
	}, [client, me, network0, address0, queries]);

	// While the live list differs from the copy, keep asking (see `nextRecheck`):
	// a change that lands just after a lookup must not be left standing.
	const differs = !!diff && !diff.same;
	const asked = useRef<{ at: number | null; n: number }>({ at: null, n: 0 });
	useEffect(() => {
		if (!differs) {
			asked.current = { at: asked.current.at, n: 0 };
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		const schedule = () => {
			const wait = nextRecheck(asked.current.at, asked.current.n, Date.now());
			if (wait === null) return;
			timer = setTimeout(async () => {
				asked.current = { at: Date.now(), n: asked.current.n + 1 };
				await check();
				if (!stopped) schedule();
			}, wait);
		};
		schedule();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, [differs, check]);
	useEffect(() => {
		if (request && request.status !== "pending") {
			void queries.invalidateQueries({ queryKey: ["relay", me, "treasuries"] });
		}
	}, [request, queries, me]);
	const checking = request?.status === "pending";

	if (!valid) {
		return (
			<ShellPage title="Treasury" meta={<SignsTag />}>
				<Card>
					<p className="text-sm text-muted-foreground">
						This address does not name a treasury. A treasury page is
						/multisig/t/&lt;network&gt;/&lt;address&gt;.
					</p>
				</Card>
			</ShellPage>
		);
	}

	if (unreachable) {
		return (
			<ShellPage
				title={defaultTreasuryName(address)}
				meta={
					<>
						<span
							className="inline-flex items-center gap-1 font-mono"
							title={address}
						>
							{shortAddress(address)}
							<CopyButton value={address} size="xs" />
						</span>
						<NetTag network={network} />
						<SignsTag />
					</>
				}
			>
				<Callout
					tone="warning"
					title="The relay cannot be reached"
					className="mb-4"
					action={
						<Button size="sm" variant="outline" onClick={relay.retry}>
							Try again
						</Button>
					}
				>
					Pending proposals and the signing log are not shown until it is back;
					this page keeps trying by itself. What the treasury holds and who
					controls it come straight from Hyperliquid and stay current.
				</Callout>
				{selfSigners && (
					<SwitchToSigner signers={selfSigners} className="mb-4" />
				)}
				<OverviewTab
					network={network}
					address={address}
					state={live}
					me={null}
					treasury={null}
					proposals={known.proposals}
				/>
			</ShellPage>
		);
	}

	if (relay.mode !== "on") {
		return (
			<ShellPage
				title={defaultTreasuryName(address)}
				meta={
					<>
						<NetTag network={network} />
						<SignsTag />
					</>
				}
			>
				{selfSigners && (
					<SwitchToSigner signers={selfSigners} className="mb-4" />
				)}
				<SignInGate what="this treasury" />
			</ShellPage>
		);
	}

	if (!treasury && selfSigners) {
		return (
			<ShellPage
				title={defaultTreasuryName(address)}
				meta={
					<>
						<span
							className="inline-flex items-center gap-1 font-mono"
							title={address}
						>
							{shortAddress(address)}
							<CopyButton value={address} size="xs" />
						</span>
						<NetTag network={network} />
						<SignsTag />
					</>
				}
			>
				<Card className="mb-4">
					<SwitchToSigner signers={selfSigners} />
					<p className="mt-2 text-[13px] text-muted-foreground">
						{RELAY_COPY.selfSeesNothing}{" "}
						<Link
							to="/multisig/add"
							className="text-brand underline underline-offset-2"
						>
							{RELAY_COPY.registerSelfButton}
						</Link>
					</p>
				</Card>
				<OverviewTab
					network={network}
					address={address}
					state={live}
					me={me}
					treasury={null}
					proposals={known.proposals}
				/>
			</ShellPage>
		);
	}

	if (!treasury) {
		return (
			<ShellPage
				title={defaultTreasuryName(address)}
				meta={
					<>
						<NetTag network={network} />
						<SignsTag />
					</>
				}
			>
				<Card>
					{loading ? (
						<p className="text-sm text-muted-foreground" aria-busy="true">
							Reading your treasuries…
						</p>
					) : issue ? (
						<p className="text-sm text-warning">{issue.message}</p>
					) : (
						<div className="flex flex-col gap-3">
							<p className="text-sm text-muted-foreground">
								This treasury is not in your list. Either nobody has added it
								yet, or your wallet is not one of its signers in the relay's
								copy of the signer list.
							</p>
							<div>
								<Link to="/multisig/add" className={linkButton}>
									Add a treasury
								</Link>
							</div>
						</div>
					)}
				</Card>
			</ShellPage>
		);
	}

	const frozen = treasury.frozenAt !== null;
	const pending = openHere;
	const setTab = (next: TreasuryTab) =>
		void navigate({
			to: "/multisig/t/$network/$address",
			params: { network, address },
			search: { tab: next },
			replace: true,
		});

	// who signs, as far as this page trusts: the chain's list once it is read
	const signersNow = live.policy?.authorizedUsers ?? treasury.signers;
	return (
		<TreasuryNames network={network} treasury={address} signers={signersNow}>
			<ShellPage
				title={<Title network={network} address={address} />}
				meta={
					<>
						<span
							className="inline-flex items-center gap-1 font-mono"
							title={address}
						>
							{shortAddress(address)}
							<CopyButton value={address} size="xs" />
						</span>
						<NetTag network={network} />
						<span className="inline-flex items-center gap-1">
							{frozen ? "was " : ""}
							{treasury.threshold} of {treasury.signers.length} signers
							<Help k="threshold" />
						</span>
						{frozen && <Tag tone="warn">no longer a multi-sig</Tag>}
						<SignsTag />
					</>
				}
				actions={
					frozen ? null : (
						<Link
							to="/multisig/propose"
							search={{ treasury: address, network }}
							className="inline-flex h-[34px] items-center justify-center whitespace-nowrap rounded-md bg-brand px-3.5 text-[13px] font-medium text-brand-foreground no-underline transition-colors hover:bg-brand/90"
						>
							Propose an action
						</Link>
					)
				}
			>
				{frozen && (
					<Callout
						tone="warning"
						title="This account is no longer a multi-sig"
						className="mb-4"
					>
						Hyperliquid reports no signer set for it. Its history stays readable
						for its last known signers, and nothing new can be proposed. If it
						becomes a multi-sig again, it is picked up here by itself.
					</Callout>
				)}
				{differs && diff && (
					<Callout
						tone="info"
						title="Hyperliquid's signer list differs from the copy kept here"
						className="mb-4"
					>
						{diff.noLongerMultisig
							? "Hyperliquid no longer reports a signer set for this account. "
							: diff.multisigAgain
								? "Hyperliquid reports a signer set for this account again. "
								: [
										diff.added.length
											? `Added on chain: ${diff.added.map(shortAddress).join(", ")}. `
											: "",
										diff.removed.length
											? `Removed on chain: ${diff.removed.map(shortAddress).join(", ")}. `
											: "",
										diff.thresholdChanged && live.policy
											? `Threshold on chain: ${live.policy.threshold}. `
											: "",
									].join("")}
						{checking
							? "The relay is looking it up now."
							: "The relay has been asked to look again; this page updates by itself."}{" "}
						Signatures are always counted against the live list.
					</Callout>
				)}
				<div className="mb-4 empty:hidden">
					<AwayNotice scope={awayScope} />
				</div>
				<TabList
					label="Treasury sections"
					value={tab}
					onChange={setTab}
					tabs={[
						{ value: "overview", label: "Overview" },
						{
							value: "pending",
							label: "Pending",
							// what waits on a former multi-sig can go nowhere: listed, not counted
							count: frozen ? 0 : pending.length,
						},
						{ value: "log", label: "Signing log" },
						{ value: "chain", label: "On Hyperliquid" },
					]}
				/>
				{tab === "overview" && (
					<OverviewTab
						network={network}
						address={address}
						state={live}
						me={me}
						treasury={treasury}
						proposals={known.proposals}
					/>
				)}
				{tab === "pending" && me && (
					<PendingTab
						items={pending}
						loading={open.loading}
						me={me}
						frozen={frozen}
						first={known.state === "ready" && known.proposals.length === 0}
						network={network}
						address={address}
					/>
				)}
				{tab === "log" && <SigningLogTab treasury={treasury} me={me} />}
				{tab === "chain" && (
					<ChainTab
						network={network}
						address={address}
						state={live}
						proposals={known.proposals}
						proposalsState={known.state}
						match={match}
					/>
				)}
			</ShellPage>
		</TreasuryNames>
	);
}
