import { type Address, isNetwork, type Network } from "@hl-tools/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "#/components/hub/CopyButton";
import { Callout } from "#/components/hub/status";
import {
	type AccountTarget,
	ADDRESS_RE,
} from "#/components/tools/multisig/model";
import { Button } from "#/components/ui/button";
import { NAME_MAX, useMultisigPrefs } from "#/store/multisigPrefsStore";
import {
	useNetwork,
	useNetworkHydrated,
	useNetworkStore,
} from "#/store/networkStore";
import {
	compareSigners,
	livePolicy,
	nextRecheck,
} from "../model/relay/signers";
import { shortAddress } from "../model/stage";
import { requestTreasury } from "../relay/api";
import { useOpenProposals } from "../relay/openProposals";
import { useRequest, useTreasury } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { Card, linkButton, NetTag, SignsTag, TabList, Tag } from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";
import { SignInGate } from "../shell/SignInGate";
import { defaultTreasuryName, useTreasuryName } from "../treasuryName";
import { useTreasuryState } from "../useTreasuryState";
import { HistoryTab } from "./HistoryTab";
import { PendingTab } from "./PendingTab";
import { SignersTab } from "./SignersTab";

export type TreasuryTab = "pending" | "history" | "signers";
export const TREASURY_TABS: readonly TreasuryTab[] = [
	"pending",
	"history",
	"signers",
];

/** The page title, renamable in place. The name stays in this browser. */
function Title({ network, address }: { network: Network; address: Address }) {
	const { name, nickname, rename } = useTreasuryName(network, address);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	if (editing) {
		const save = () => {
			rename(draft);
			setEditing(false);
		};
		return (
			<form
				className="flex flex-wrap items-center gap-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					save();
				}}
			>
				<input
					// biome-ignore lint/a11y/noAutofocus: the field replaces the title the user just chose to edit
					autoFocus
					name="treasury-name"
					autoComplete="off"
					value={draft}
					maxLength={NAME_MAX}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
					placeholder={defaultTreasuryName(address)}
					aria-label="A name for this treasury, kept in this browser"
					className="h-9 w-[min(22rem,70vw)] rounded-md border border-border-strong bg-surface px-2.5 text-base font-semibold focus-visible:border-brand focus-visible:outline-none"
				/>
				<Button
					type="submit"
					size="icon-sm"
					variant="ghost"
					aria-label="Save the name"
				>
					<Check className="size-4" aria-hidden />
				</Button>
				<Button
					type="button"
					size="icon-sm"
					variant="ghost"
					aria-label="Cancel"
					onClick={() => setEditing(false)}
				>
					<X className="size-4" aria-hidden />
				</Button>
			</form>
		);
	}
	return (
		<span className="inline-flex items-center gap-1.5">
			{name}
			<Button
				size="icon-xs"
				variant="ghost"
				className="text-muted-foreground"
				aria-label="Rename this treasury (the name stays in this browser)"
				title="Rename (the name stays in this browser)"
				onClick={() => {
					setDraft(nickname ?? "");
					setEditing(true);
				}}
			>
				<Pencil aria-hidden />
			</Button>
		</span>
	);
}

/**
 * One treasury: what waits for signatures, what happened, and who signs.
 * Shown to the wallets in the relay's copy of its signer list; that copy is
 * compared with the live list every time the page is open, and a difference
 * makes the relay look again.
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
	const header = useNetwork();
	const hydrated = useNetworkHydrated();
	const setNetwork = useNetworkStore((s) => s.setNetwork);
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

	// The address in the URL names its network: the header follows it.
	useEffect(() => {
		if (valid && hydrated && header !== network) setNetwork(network);
	}, [valid, hydrated, header, network, setNetwork]);

	useEffect(() => {
		if (treasury) markSeen(treasury.network, treasury.address);
	}, [treasury, markSeen]);

	const target = useMemo<AccountTarget | null>(
		() =>
			treasury
				? { address: treasury.address, network: treasury.network }
				: null,
		[treasury],
	);
	const live = useTreasuryState(target, { live: true });

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
				<SignInGate what="this treasury" />
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
	const pending = open.items.filter(
		(p) =>
			p.open &&
			p.network === treasury.network &&
			p.treasury === treasury.address,
	);
	const usdc = live.spot?.balances.find((b) => b.coin === "USDC");
	const setTab = (next: TreasuryTab) =>
		void navigate({
			to: "/multisig/t/$network/$address",
			params: { network, address },
			search: { tab: next },
			replace: true,
		});

	return (
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
					<span>
						{frozen ? "was " : ""}
						{treasury.threshold} of {treasury.signers.length} signers
					</span>
					{live.perp && (
						<span>
							Perps {live.perp.withdrawable} USDC · Spot {usdc?.total ?? "0"}{" "}
							USDC
						</span>
					)}
					{frozen && <Tag tone="warn">no longer a multi-sig</Tag>}
					<SignsTag />
				</>
			}
			actions={
				frozen ? null : (
					<Link
						to="/multisig/propose"
						search={{ treasury: address }}
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
			<TabList
				label="Treasury sections"
				value={tab}
				onChange={setTab}
				tabs={[
					{ value: "pending", label: "Pending", count: pending.length },
					{ value: "history", label: "History" },
					{ value: "signers", label: "Signers & API wallets" },
				]}
			/>
			{tab === "pending" && me && (
				<PendingTab
					items={pending}
					loading={open.loading}
					me={me}
					frozen={frozen}
				/>
			)}
			{tab === "history" && <HistoryTab treasury={treasury} me={me} />}
			{tab === "signers" && (
				<SignersTab
					treasury={treasury}
					live={live}
					me={me}
					checking={checking}
					onCheck={() => void check()}
				/>
			)}
		</ShellPage>
	);
}
