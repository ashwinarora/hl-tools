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
	type Proposal,
	parseLedger,
	stakingActionOf,
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
import { rest } from "../live/explorerList";
import { lookupOf, useTxLookups } from "../live/useChainMatch";
import { useValidators } from "../live/useStaking";
import {
	hashesToLookUp,
	type MatchCandidate,
	rowProposal,
} from "../model/chain/match";
import { moveRefs } from "../model/move";
import { assembleProposal } from "../model/relay/assemble";
import {
	AWAY_CHECK_EVERY_MS,
	type AwayChain,
	type AwayItem,
	type AwayProposal,
	agentsBaseline,
	awayItems,
	awayProposal,
	ledgerProgress,
	markAfter,
	needsDocument,
	treasuriesToCheck,
} from "../model/relay/away";
import {
	type EventRow,
	latestMarks,
	type MarkRow,
	type ProposalRow,
} from "../model/relay/rows";
import { actionLine } from "../model/staking";
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
	/** Kept to name a staking step's validator once the list is read. */
	readonly proposal: Proposal;
	readonly proposedBy: Address;
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
					events
						.filter(needsDocument)
						.flatMap((e) => (e.digest ? [e.digest] : [])),
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
			const read: { row: ProposalRow; proposal: Proposal }[] = [];
			for (const row of rows.values()) {
				const a = await assembleProposal(row, { now });
				if (a.assembled) read.push({ row, proposal: a.assembled.proposal });
			}
			// the two steps of a move are spoken of as one where both say the same
			const moves = moveRefs(
				read.map((x) => ({
					proposal: x.proposal,
					proposedBy: x.row.createdBy,
				})),
			);
			const proposals = read.map(
				({ row, proposal }): NewsProposal => ({
					...awayProposal(row, proposal),
					move: moves.get(proposal.digest) ?? null,
					network: row.network,
					treasury: row.treasury,
					proposal,
					proposedBy: row.createdBy,
				}),
			);
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
	/**
	 * Hyperliquid did not answer for the API wallets or the transfers: the
	 * group says so, never reads as complete (audit F-102).
	 */
	readonly failed: boolean;
}

/**
 * How long one treasury's check may take. One that hangs is given up, so it
 * does not hold every treasury after it on "Checking…" (audit F-070).
 */
const CHECK_LIMIT_MS = 60_000;

function limited<T>(job: () => Promise<T>): () => Promise<T> {
	return () =>
		new Promise<T>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("Hyperliquid did not answer in time.")),
				CHECK_LIMIT_MS,
			);
			job().then(
				(v) => {
					clearTimeout(timer);
					resolve(v);
				},
				(e: unknown) => {
					clearTimeout(timer);
					reject(e);
				},
			);
		});
}

/** One treasury at a time per network, whoever asks. */
const lanes = new Map<Network, Promise<unknown>>();
function inTurn<T>(network: Network, job: () => Promise<T>): Promise<T> {
	const run = limited(job);
	const next = (lanes.get(network) ?? Promise.resolve()).then(run, run);
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
				let failed = false;
				const agents = await queries
					.fetchQuery({
						...agentsQueryOptions(network, address),
						staleTime: AWAY_CHECK_EVERY_MS,
					})
					.then(
						(o) => o.data,
						() => {
							failed = true;
							return null;
						},
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
						failed = true;
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
				return { agents, ledger, ledgerReadAt, candidates, onRecord, failed };
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
 * rested       read, but the explorer refused more look-ups for today, so some
 *              transfers could not be matched yet (they stay unread)
 * not-checked  not looked at on this visit (the home screen looks at ten)
 */
export type ChainState =
	| "checked"
	| "checking"
	| "failed"
	| "partly"
	| "rested"
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
	// what the signers decided: told to its signers, not to the account itself
	const here = useMemo(
		() =>
			rows.filter(
				(t) =>
					t.network === network &&
					!!me &&
					t.signers.includes(me) &&
					(only
						? t.address === only
						: !(
								hydrated && hidden.includes(treasuryKey(t.network, t.address))
							)),
			),
		[rows, network, only, hydrated, hidden, me],
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
	// each treasury's transfers that could be a proposal's, with the treasury
	// they belong to: the explorer is asked once per treasury, not per transfer
	const wanted = useMemo(() => {
		const out = new Map<string, { account: string; hash: string }>();
		checks.forEach((c, i) => {
			const t = here[i];
			if (t && c.data?.onRecord && c.data.ledger)
				for (const hash of hashesToLookUp(c.data.ledger, c.data.candidates))
					if (!out.has(hash)) out.set(hash, { account: t.address, hash });
		});
		return [...out.values()];
	}, [checks, here]);
	const lookups = useTxLookups(network, wanted);

	const marksNow = marks.data;
	// a staking step names its validator by name, as every list does (audit F-056)
	const staking = (n: Network) =>
		!!news.data?.proposals.some(
			(p) => p.network === n && !!stakingActionOf(p.proposal.payload.action),
		);
	const mainnetNames = useValidators("mainnet", staking("mainnet"));
	const testnetNames = useValidators("testnet", staking("testnet"));
	const newsNow = useMemo(() => {
		const d = news.data;
		if (!d) return d;
		const names = { mainnet: mainnetNames, testnet: testnetNames };
		let proposals = d.proposals.map((p) => {
			const v = names[p.network];
			return v && stakingActionOf(p.proposal.payload.action)
				? { ...p, line: actionLine(p.proposal.payload.action, v, p.network) }
				: p;
		});
		for (const n of ["mainnet", "testnet"] as const) {
			const v = names[n];
			if (!v) continue;
			const refs = moveRefs(
				proposals
					.filter((p) => p.network === n)
					.map((p) => ({ proposal: p.proposal, proposedBy: p.proposedBy })),
				v,
			);
			proposals = proposals.map((p) =>
				p.network === n && refs.has(p.proposal.digest)
					? { ...p, move: refs.get(p.proposal.digest) ?? null }
					: p,
			);
		}
		return { ...d, proposals };
	}, [news.data, mainnetNames, testnetNames]);
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
				? data.failed
					? "failed"
					: "checked"
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
							? // the explorer's refusal for the day is not "did not answer" (audit F-063)
								rest(t.network).resting
								? "rested"
								: "partly"
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
