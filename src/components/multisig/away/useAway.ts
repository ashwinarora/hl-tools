/**
 * "While you were away", assembled for the screens that show it: the signer's
 * markers and the history since them (the relay), and for the treasuries a
 * screen is allowed to ask about, their API wallets and transfers
 * (Hyperliquid). What counts is decided by `model/relay/away`.
 *
 * Hyperliquid is asked sparingly: only by the home screen (its first ten
 * treasuries) and a treasury's own page, one treasury at a time, and each at
 * most once in five minutes. The navigation asks nothing and shows what is
 * already known.
 */
import {
	type Address,
	type AgentInfo,
	type Issue,
	infoClient,
	type LedgerRow,
	type Network,
	parseLedger,
} from "@hl-tools/core";
import {
	type QueryClient,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { agentsQueryOptions } from "#/components/tools/multisig/policyQuery";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { useNetwork } from "#/store/networkStore";
import { hashesToLookUp, lookupOf, useTxLookups } from "../live/useChainMatch";
import { type MatchCandidate, rowProposal } from "../model/chain/match";
import { assembleProposal } from "../model/relay/assemble";
import {
	AWAY_CHECK_EVERY_MS,
	type AwayChain,
	type AwayItem,
	type AwayProposal,
	agentsBaseline,
	awayItems,
	awayProposal,
	isEnding,
	ledgerProgress,
	markAfter,
	treasuriesToCheck,
} from "../model/relay/away";
import {
	type EventRow,
	latestMarks,
	type MarkRow,
	type ProposalRow,
} from "../model/relay/rows";
import {
	listEventsAfter,
	listLapsed,
	listMarks,
	listProposalsIn,
	type MarkWrite,
	markRead,
} from "../relay/api";
import type { RelayClient } from "../relay/client";
import { unwrap, useTreasuries } from "../relay/queries";
import { queryIssue, useRelay } from "../relay/useRelay";
import { useNow } from "../shell/live";
import {
	localProposalsQuery,
	mergeKnown,
	sharedProposalsQuery,
} from "../treasury/useKnownProposals";

const keyOf = (network: Network, address: Address) => `${network}:${address}`;

// ----------------------------------------------------------------- the relay

type Marks = ReadonlyMap<string, MarkRow>;

/** The signed-in wallet's newest marker per treasury. */
export function marksQuery(client: RelayClient, wallet: Address) {
	return {
		queryKey: ["relay", wallet, "marks"] as const,
		queryFn: async (): Promise<Marks> =>
			latestMarks(unwrap(await listMarks(client)).rows),
		staleTime: 15_000,
	};
}

interface NewsProposal extends AwayProposal {
	readonly network: Network;
	readonly treasury: Address;
}

interface News {
	readonly events: readonly EventRow[];
	readonly proposals: readonly NewsProposal[];
}

const NO_NEWS: News = { events: [], proposals: [] };

/** The history since the oldest marker, and the proposals it speaks of, each verified here. */
function newsQuery(client: RelayClient, wallet: Address, queries: QueryClient) {
	return {
		queryKey: ["relay", wallet, "away"] as const,
		queryFn: async (): Promise<News> => {
			const marks = [
				...(await queries.fetchQuery(marksQuery(client, wallet))).values(),
			];
			if (marks.length === 0) return NO_NEWS;
			const now = Date.now();
			const events = unwrap(
				await listEventsAfter(client, Math.min(...marks.map((m) => m.eventId))),
			).rows;
			const digests = [
				...new Set(
					events.filter(isEnding).flatMap((e) => (e.digest ? [e.digest] : [])),
				),
			];
			const [ended, lapsed] = await Promise.all([
				listProposalsIn(client, digests).then(unwrap),
				listLapsed(client, Math.min(...marks.map((m) => m.markedAt)), now).then(
					unwrap,
				),
			]);
			const rows = new Map<string, ProposalRow>();
			for (const row of [...ended.rows, ...lapsed.rows])
				rows.set(`${row.network}:${row.treasury}:${row.digest}`, row);
			const proposals: NewsProposal[] = [];
			for (const row of rows.values()) {
				const a = await assembleProposal(row, { now });
				if (a.assembled)
					proposals.push({
						...awayProposal(row, a.assembled.proposal),
						network: row.network,
						treasury: row.treasury,
					});
			}
			return { events, proposals };
		},
		staleTime: 15_000,
		retry: 1,
	};
}

// --------------------------------------------------------------- Hyperliquid

interface ChainCheck {
	/** Null when the list could not be read. */
	readonly agents: readonly AgentInfo[] | null;
	/** What left the account since the marker; null when not read. */
	readonly ledger: readonly LedgerRow[] | null;
	readonly ledgerReadAt: number | null;
	/** The proposals on record a transfer could belong to. */
	readonly candidates: readonly MatchCandidate[];
	/** Whether the record could be read: only then may a transfer be called unexplained. */
	readonly onRecord: boolean;
}

/** One treasury at a time per network, whoever asks. */
const lanes = new Map<Network, Promise<unknown>>();
function inTurn<T>(network: Network, job: () => Promise<T>): Promise<T> {
	const next = (lanes.get(network) ?? Promise.resolve()).then(job, job);
	lanes.set(
		network,
		next.catch(() => {}),
	);
	return next;
}

/** The two one-off reads for one treasury: its API wallets, and its ledger since the marker. */
function chainQuery(
	client: RelayClient,
	wallet: Address,
	network: Network,
	address: Address,
	queries: QueryClient,
) {
	return {
		// not under the relay's key: a ping must not send this to Hyperliquid again
		queryKey: ["multisig-away-chain", wallet, network, address] as const,
		queryFn: ({ signal }: { signal: AbortSignal }): Promise<ChainCheck> =>
			inTurn(network, async () => {
				const mark = (await queries.fetchQuery(marksQuery(client, wallet))).get(
					keyOf(network, address),
				);
				const agents = await queries
					.fetchQuery({
						...agentsQueryOptions(network, address),
						staleTime: AWAY_CHECK_EVERY_MS,
					})
					.then(
						(o) => o.data,
						() => null,
					);
				let ledger: LedgerRow[] | null = null;
				let ledgerReadAt: number | null = null;
				if (mark && mark.ledgerTime !== null) {
					try {
						const r = await infoClient(network).info<unknown>(
							{
								type: "userNonFundingLedgerUpdates",
								user: address,
								startTime: mark.ledgerTime + 1,
							},
							{ fresh: true, signal },
						);
						ledger =
							parseLedger(
								{ nonFundingLedgerUpdates: r.data, isSnapshot: true },
								address,
							)?.rows.filter((row) => row.direction === "out") ?? null;
						ledgerReadAt = ledger ? r.observedAt : null;
					} catch {
						ledger = null;
					}
				}
				let candidates: readonly MatchCandidate[] = [];
				let onRecord = true;
				// which proposals could explain them: only asked when something left
				if (ledger && ledger.length > 0) {
					try {
						const [shared, local] = await Promise.all([
							queries.fetchQuery(
								sharedProposalsQuery(client, wallet, network, address),
							),
							queries.fetchQuery(localProposalsQuery(network, address)),
						]);
						candidates = mergeKnown(local, shared);
					} catch {
						onRecord = false;
					}
				}
				return { agents, ledger, ledgerReadAt, candidates, onRecord };
			}),
		staleTime: AWAY_CHECK_EVERY_MS,
		gcTime: 6 * AWAY_CHECK_EVERY_MS,
		// a tab left open and looked at again asks again, if the last answer is that old
		refetchOnWindowFocus: true,
		refetchOnReconnect: false,
		retry: 0,
	};
}

// ------------------------------------------------------------------ the hook

/**
 * all    the home screen: every treasury on the header's network
 * none   the navigation: the same treasuries, nothing asked of Hyperliquid
 * {…}    a treasury's own page: that treasury
 */
export type AwayScope =
	| "all"
	| "none"
	| { readonly network: Network; readonly address: Address };

/**
 * checked      its API wallets and transfers were looked at
 * checking     being looked at now
 * failed       Hyperliquid did not answer
 * partly       read, but some transfers could not be matched yet (they stay unread)
 * not-checked  not looked at on this visit (the home screen looks at ten)
 */
export type ChainState =
	| "checked"
	| "checking"
	| "failed"
	| "partly"
	| "not-checked";

export interface AwayGroup {
	readonly network: Network;
	readonly treasury: Address;
	/** When the signer last said "Got it" here. */
	readonly since: number;
	readonly items: readonly AwayItem[];
	readonly chain: ChainState;
	/** The marker "Got it" writes. */
	readonly next: MarkWrite;
}

export interface Away {
	/** Treasuries with something to tell, in the navigation's order. */
	readonly groups: readonly AwayGroup[];
	/** Treasuries of this scope Hyperliquid was not asked about on this visit. */
	readonly notChecked: number;
	/** Markers that lack a list of API wallets, now that one is known (see `AwayKeeper`). */
	readonly baselines: readonly MarkWrite[];
	readonly busy: boolean;
	readonly issue: Issue | null;
	/** "Got it" for these groups; resolves to whether it was recorded. */
	gotIt(groups: readonly AwayGroup[]): Promise<boolean>;
}

const NO_GROUPS: readonly AwayGroup[] = [];

export function useAway(scope: AwayScope): Away {
	const relay = useRelay();
	const client = relay.client;
	const me = relay.wallet;
	const queries = useQueryClient();
	const header = useNetwork();
	const { rows } = useTreasuries();
	const hydrated = usePrefsHydrated();
	const hidden = useMultisigPrefs((s) => s.hidden);
	const now = useNow(60_000);
	const on = !!client && !!me;

	const network = typeof scope === "object" ? scope.network : header;
	const only = typeof scope === "object" ? scope.address : null;
	const here = useMemo(
		() =>
			rows.filter(
				(t) =>
					t.network === network &&
					(only
						? t.address === only
						: !(
								hydrated && hidden.includes(treasuryKey(t.network, t.address))
							)),
			),
		[rows, network, only, hydrated, hidden],
	);

	const marks = useQuery({
		...(on
			? marksQuery(client, me)
			: {
					queryKey: ["relay", me, "marks"] as const,
					queryFn: async (): Promise<Marks> => new Map(),
				}),
		enabled: on,
		retry: 1,
	});
	const news = useQuery({
		...(on
			? newsQuery(client, me, queries)
			: {
					queryKey: ["relay", me, "away"] as const,
					queryFn: async (): Promise<News> => NO_NEWS,
				}),
		enabled: on && !!marks.data,
	});

	const asked = useMemo(
		() =>
			treasuriesToCheck(
				here.map((t) => keyOf(t.network, t.address)),
				typeof scope === "object" ? keyOf(scope.network, scope.address) : scope,
			),
		[here, scope],
	);
	const checks = useQueries({
		queries: here.map((t) => {
			const key = keyOf(t.network, t.address);
			return on
				? {
						...chainQuery(client, me, t.network, t.address, queries),
						// from the first marker on: before it there is nothing to compare with
						enabled: asked.has(key) && !!marks.data?.has(key),
					}
				: {
						queryKey: ["multisig-away-chain", me, t.network, t.address],
						queryFn: async (): Promise<ChainCheck> => {
							throw new Error("not signed in");
						},
						enabled: false,
					};
		}),
	});
	const hashes = useMemo(() => {
		const out = new Set<string>();
		for (const c of checks)
			if (c.data?.onRecord && c.data.ledger)
				for (const h of hashesToLookUp(c.data.ledger, c.data.candidates))
					out.add(h);
		return [...out];
	}, [checks]);
	const lookups = useTxLookups(network, hashes);

	const marksNow = marks.data;
	const newsNow = news.data;
	const built = useMemo(() => {
		const groups: AwayGroup[] = [];
		const baselines: MarkWrite[] = [];
		let notChecked = 0;
		if (!me || !marksNow) return { groups, baselines, notChecked };
		here.forEach((t, i) => {
			const key = keyOf(t.network, t.address);
			const mark = marksNow.get(key);
			if (!mark) return;
			const check = checks[i];
			const data = check?.data ?? null;
			const state: ChainState = data
				? "checked"
				: check?.isError
					? "failed"
					: asked.has(key)
						? "checking"
						: "not-checked";
			if (state === "not-checked") notChecked += 1;
			const chain: AwayChain = {
				agents: data?.agents ?? null,
				ledger:
					data?.ledger?.map((row) => ({
						row,
						proposal: data.onRecord
							? rowProposal(
									row,
									t.address,
									data.candidates,
									lookupOf(lookups, row),
								)
							: ({ kind: "checking" } as const),
					})) ?? null,
			};
			// read, but a transfer is still being matched (or could not be)
			const progress = ledgerProgress(chain);
			const shown: ChainState =
				state !== "checked"
					? state
					: progress === "open"
						? "checking"
						: progress === "failed"
							? "partly"
							: "checked";
			const baseline = agentsBaseline(mark, chain.agents);
			if (baseline)
				baselines.push({
					network: t.network,
					treasury: t.address,
					eventId: mark.eventId,
					chain: { agents: baseline },
				});
			// without the history nothing is told: half a notice would read as "that is all"
			if (!newsNow) return;
			const events = newsNow.events.filter(
				(e) =>
					e.network === t.network &&
					e.treasury === t.address &&
					e.id > mark.eventId,
			);
			const items = awayItems({
				mark,
				events,
				proposals: newsNow.proposals.filter(
					(p) => p.network === t.network && p.treasury === t.address,
				),
				me,
				chain,
				now,
			});
			if (items.length === 0) return;
			groups.push({
				network: t.network,
				treasury: t.address,
				since: mark.markedAt,
				items,
				chain: shown,
				next: {
					network: t.network,
					treasury: t.address,
					...markAfter({
						mark,
						events,
						chain,
						ledgerReadAt: data?.ledgerReadAt ?? null,
					}),
				},
			});
		});
		return { groups, baselines, notChecked };
	}, [me, marksNow, newsNow, here, checks, asked, lookups, now]);

	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<Issue | null>(null);
	const gotIt = useCallback(
		async (groups: readonly AwayGroup[]): Promise<boolean> => {
			if (!client || !me || groups.length === 0) return false;
			setBusy(true);
			try {
				const r = await markRead(
					client,
					me,
					groups.map((g) => g.next),
				);
				setProblem(r.issue);
				await queries.invalidateQueries({ queryKey: ["relay", me] });
				return !r.issue;
			} finally {
				setBusy(false);
			}
		},
		[client, me, queries],
	);

	return {
		groups: on ? built.groups : NO_GROUPS,
		notChecked: built.notChecked,
		baselines: built.baselines,
		busy,
		issue: problem ?? queryIssue(marks.error) ?? queryIssue(news.error),
		gotIt,
	};
}
