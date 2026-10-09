/**
 * The proposal document a page is showing.
 *
 * It lives in this browser's history (IndexedDB, keyed by digest) and every
 * change goes through it, merged. If the history cannot be used (IndexedDB
 * blocked), the document is kept in memory so the page still works for as
 * long as it stays open.
 *
 * With the relay in use the hook also reads the relay's copy: the stored
 * document, re-hashed, with the signatures that verify. That copy is written
 * through into the history (so the page keeps one source and works offline
 * afterwards), and what this browser adds is pushed back: its own signature
 * when the relay has the proposal, the proposal itself only when asked to,
 * the result when this wallet is the finaliser.
 */
import {
	type Address,
	encodeProposal,
	type Hex,
	type Issue,
	issue,
	mergeProposals,
	type Proposal,
} from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "#/hooks/useHyperliquid";
import { loadProposal, rewriteProposal, saveProposal } from "../model/history";
import {
	assembleProposal,
	effectiveProposal,
	type RelayProposal,
	removedSigners,
} from "../model/relay/assemble";
import { relayIssue } from "../model/relay/errors";
import { planPush, publishBlocker, type RelayKnown } from "../model/relay/push";
import type { EndingKind, ProposalRow } from "../model/relay/rows";
import {
	addSignature,
	endProposal,
	getProposal,
	listProposalEvents,
	type ProposalKey,
	publishProposal,
	recordReceipt,
	removeSignature,
} from "../relay/api";
import type { RelayClient } from "../relay/client";
import { treasuriesQuery, unwrap } from "../relay/queries";
import { queryIssue, useRelay } from "../relay/useRelay";

export interface StoreResult {
	readonly proposal: Proposal;
	readonly issues: readonly Issue[];
}

/** The relay's side of a proposal, as the page needs it. */
export interface RelayView {
	/** The relay is in use: signed in as the connected wallet. */
	readonly active: boolean;
	/** The relay has this proposal and this wallet may see it. */
	readonly known: boolean;
	readonly loading: boolean;
	/** The relay's row (status, who proposed, how it ended); null when not known. */
	readonly row: ProposalRow | null;
	readonly expired: boolean;
	/** Signers whose signature is on the relay and verifies. */
	readonly signers: readonly Address[];
	/** This wallet may share the proposal: a stored signer of its unfrozen treasury, and the document qualifies. */
	readonly canPublish: boolean;
	/** Why the document cannot be shared at all; null when it can. */
	readonly blocker: string | null;
	/** The last thing that went wrong between this page and the relay. */
	readonly issue: Issue | null;
	/** A write to the relay is in flight. */
	readonly busy: boolean;
}

export interface ProposalDoc {
	readonly proposal: Proposal | null;
	/** Notes from decoding the stored document and from checking the relay's copy. */
	readonly issues: readonly Issue[];
	readonly loading: boolean;
	/** Set when the history could not be read or written. */
	readonly storageError: string | null;
	readonly relay: RelayView;
	/**
	 * Merge a copy into the document and persist it. With the relay in use,
	 * this wallet's own signature and result follow it there; the proposal
	 * itself is shared only with `publish`. Never throws.
	 */
	store(
		incoming: Proposal,
		opts?: { readonly publish?: boolean },
	): Promise<StoreResult>;
	/** Share the proposal as it is in this browser. */
	publish(): Promise<void>;
	/** Remove this wallet's signature from the relay and from this browser. */
	takeBack(): Promise<void>;
	/** Withdraw (the proposer) or decline (the finaliser). */
	end(kind: EndingKind): Promise<void>;
	/** Read the relay's copy again, now; the row, or null when it has none or cannot be reached. */
	refresh(): Promise<ProposalRow | null>;
}

interface Remote {
	readonly found: RelayProposal | null;
	readonly issues: readonly Issue[];
	readonly removed: readonly Address[];
}

const keyOf = (p: Proposal): ProposalKey => ({
	network: p.payload.network,
	treasury: p.payload.multiSigUser,
	digest: p.digest,
});

async function readRemote(client: RelayClient, digest: Hex): Promise<Remote> {
	const got = unwrap(await getProposal(client, digest));
	const issues: Issue[] = [];
	let found: RelayProposal | null = null;
	// one row at most can verify: the digest binds the treasury it is filed under
	for (const row of got.rows) {
		const a = await assembleProposal(row);
		issues.push(...a.issues);
		if (a.assembled && !found) found = a.assembled;
	}
	if (got.dropped > 0) {
		issues.push(
			issue(
				"relay.rows_dropped",
				"warning",
				"The relay returned a malformed row for this proposal; it was ignored.",
			),
		);
	}
	let removed: Address[] = [];
	if (found) {
		const events = await listProposalEvents(client, keyOf(found.proposal));
		// without the events nothing is dropped: a signature that verifies stays shown
		if (events.data) {
			removed = [...removedSigners(events.data.rows, found.proposal.digest)];
		}
	}
	return { found, issues, removed };
}

export function useProposalDoc(digest: string | undefined): ProposalDoc {
	const queries = useQueryClient();
	const relay = useRelay();
	const client = relay.client;
	const me = relay.wallet;

	const local = useQuery({
		queryKey: ["multisig-proposal", digest],
		enabled: !!digest,
		queryFn: () => loadProposal(digest as string),
		retry: 0,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const [memory, setMemory] = useState<Proposal | null>(null);
	const [storageError, setStorageError] = useState<string | null>(null);
	const [problem, setProblem] = useState<Issue | null>(null);
	const [syncIssues, setSyncIssues] = useState<readonly Issue[]>([]);
	const [busy, setBusy] = useState(false);

	const remoteKey = useMemo(
		() => ["relay", me, "proposal", digest] as const,
		[me, digest],
	);
	const remote = useQuery({
		queryKey: remoteKey,
		enabled: !!client && !!digest,
		queryFn: () => readRemote(client as RelayClient, digest as Hex),
		staleTime: 5_000,
		retry: 1,
	});

	const invalidateLocal = useCallback(
		async (d: string) => {
			await queries.invalidateQueries({ queryKey: ["multisig-proposal", d] });
			void queries.invalidateQueries({ queryKey: ["multisig-proposals"] });
		},
		[queries],
	);

	// The page renders the same object until the document really changes, so a
	// refetch that returns the same proposal does not restart the judgement.
	const stored = local.data?.proposal ?? null;
	const held = memory && (!digest || memory.digest === digest) ? memory : null;
	const raw = stored ?? held;
	const text = raw ? encodeProposal(raw) : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the document; `raw` is a fresh object on every load
	const proposal = useMemo(() => raw, [text]);

	// ---- relay → this browser
	const remoteData = remote.data;
	useEffect(() => {
		if (!digest || !remoteData?.found) return;
		const theirs = remoteData.found.proposal;
		const removed = new Set(remoteData.removed);
		let cancelled = false;
		void (async () => {
			const notes: Issue[] = [];
			const merge = async (mine: Proposal | null) => {
				const e = await effectiveProposal(theirs, mine, removed);
				notes.push(...e.issues);
				return e.proposal;
			};
			try {
				const written = await rewriteProposal(digest, merge);
				if (cancelled) return;
				setStorageError(null);
				setSyncIssues(notes);
				if (written?.saved) await invalidateLocal(digest);
			} catch (e) {
				// no history in this browser: hold the merged copy on the page
				const merged = await merge(null);
				if (cancelled) return;
				setStorageError(errorMessage(e));
				setSyncIssues(notes);
				setMemory((m) => (m && m.digest === digest ? m : merged));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [digest, remoteData, invalidateLocal]);

	// ---- this browser → relay
	const push = useCallback(
		async (
			doc: Proposal,
			o: { publish: boolean; explicit: boolean },
		): Promise<Issue | null> => {
			if (!client || !me) return null;
			let now: Remote;
			let storedSigner = false;
			try {
				// what the relay has at this moment, not what the page saw a while ago
				now = await queries.fetchQuery({
					queryKey: ["relay", me, "proposal", doc.digest],
					queryFn: () => readRemote(client, doc.digest),
					staleTime: o.explicit ? 0 : 5_000,
				});
				if (o.publish && !now.found) {
					const mine = await queries.fetchQuery(treasuriesQuery(client, me));
					storedSigner = mine.rows.some(
						(t) =>
							t.network === doc.payload.network &&
							t.address === doc.payload.multiSigUser &&
							t.frozenAt === null &&
							t.signers.includes(me),
					);
				}
			} catch (e) {
				return queryIssue(e) ?? relayIssue(e);
			}
			const known: RelayKnown | null = now.found
				? {
						status: now.found.row.status,
						expired: now.found.row.expiresAt <= Date.now(),
						signers: now.found.row.signatures.map((s) => s.signer),
						receiptTimes: now.found.row.receipts.map((r) => r.submittedAt),
					}
				: null;
			const ops = planPush({
				doc,
				me,
				relay: known,
				storedSigner,
				publish: o.publish,
				removed: new Set(now.removed),
				explicit: o.explicit,
			});
			if (ops.length === 0) {
				if (o.publish && !now.found) {
					const blocked = publishBlocker(doc);
					return issue(
						"relay.not_shared",
						"warning",
						blocked ??
							"Not shared: the relay does not list your wallet as a signer of this treasury. Add the treasury first.",
					);
				}
				return null;
			}
			const key = keyOf(doc);
			let failed: Issue | null = null;
			for (const op of ops) {
				const r =
					op.kind === "publish"
						? await publishProposal(client, me, op.row)
						: op.kind === "sign"
							? await addSignature(client, me, key, op.signature)
							: await recordReceipt(client, me, key, op.receipt);
				if (r.issue) {
					failed = r.issue;
					break;
				}
			}
			await queries.invalidateQueries({ queryKey: ["relay", me] });
			return failed;
		},
		[client, me, queries],
	);

	// A signature or a result made here that the relay does not have yet (signed
	// while offline, or the first push failed): caught up in the background,
	// once per reason, and again when the browser comes back online or the
	// relay is reachable again.
	const catching = useRef(false);
	const gaveUpOn = useRef<string | null>(null);
	const [online, setOnline] = useState(0);
	useEffect(() => {
		const again = () => {
			gaveUpOn.current = null;
			setOnline((n) => n + 1);
		};
		window.addEventListener("online", again);
		return () => window.removeEventListener("online", again);
	}, []);
	// the wallet's channel (re)joining is the relay saying it is reachable again
	const channel = relay.channel;
	useEffect(() => {
		if (channel !== "joined") return;
		gaveUpOn.current = null;
		setOnline((n) => n + 1);
	}, [channel]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `online` re-runs the catch-up after a reconnect
	useEffect(() => {
		const found = remoteData?.found;
		if (!client || !me || !proposal || !found) return;
		const ops = planPush({
			doc: proposal,
			me,
			relay: {
				status: found.row.status,
				expired: found.row.expiresAt <= Date.now(),
				signers: found.row.signatures.map((s) => s.signer),
				receiptTimes: found.row.receipts.map((r) => r.submittedAt),
			},
			storedSigner: false,
			publish: false,
			removed: new Set(remoteData.removed),
			explicit: false,
		});
		const what = `${proposal.digest}:${ops.map((o) => o.kind).join(",")}`;
		if (ops.length === 0 || catching.current || gaveUpOn.current === what) {
			return;
		}
		catching.current = true;
		void push(proposal, { publish: false, explicit: false })
			.then((failed) => {
				gaveUpOn.current = failed ? what : null;
				setProblem(failed);
			})
			.finally(() => {
				catching.current = false;
			});
	}, [client, me, proposal, remoteData, push, online]);

	const store = useCallback(
		async (
			incoming: Proposal,
			opts: { readonly publish?: boolean } = {},
		): Promise<StoreResult> => {
			let result: StoreResult;
			let kept = true;
			try {
				const saved = await saveProposal(incoming);
				setStorageError(null);
				await invalidateLocal(saved.proposal.digest);
				result = { proposal: saved.proposal, issues: saved.issues };
				kept = saved.saved;
			} catch (e) {
				// no history: merge with what this page already holds, in memory
				setStorageError(errorMessage(e));
				const before =
					memory && memory.digest === incoming.digest ? memory : null;
				const merged = before ? await mergeProposals(incoming, before) : null;
				const next = merged?.merged ?? incoming;
				setMemory(next);
				result = { proposal: next, issues: merged?.issues ?? [] };
			}
			// a copy that was refused locally (another payload under this digest) goes nowhere
			if (kept && client && me) {
				setBusy(true);
				try {
					gaveUpOn.current = null;
					setProblem(
						await push(result.proposal, {
							publish: !!opts.publish,
							explicit: true,
						}),
					);
				} finally {
					setBusy(false);
				}
			}
			return result;
		},
		[client, me, memory, invalidateLocal, push],
	);

	const act = useCallback(
		async (write: (c: RelayClient, as: Address) => Promise<Issue | null>) => {
			if (!client || !me) {
				setProblem(
					issue("relay.wrong_wallet", "error", "You are not signed in."),
				);
				return;
			}
			setBusy(true);
			try {
				setProblem(await write(client, me));
				await queries.invalidateQueries({ queryKey: ["relay", me] });
			} finally {
				setBusy(false);
			}
		},
		[client, me, queries],
	);

	const publish = useCallback(async () => {
		if (proposal) await store(proposal, { publish: true });
	}, [proposal, store]);

	const takeBack = useCallback(
		() =>
			act(async (c, as) => {
				if (!proposal) return null;
				const r = await removeSignature(c, as, keyOf(proposal));
				if (r.issue) return r.issue;
				// and from this browser, or the next sync would hold a signature its signer withdrew
				const without = (p: Proposal | null) =>
					p
						? { ...p, signatures: p.signatures.filter((s) => s.signer !== as) }
						: null;
				try {
					await rewriteProposal(proposal.digest, async (p) => without(p));
					await invalidateLocal(proposal.digest);
				} catch {
					setMemory((m) => without(m));
				}
				return null;
			}),
		[act, proposal, invalidateLocal],
	);

	const end = useCallback(
		(kind: EndingKind) =>
			act(async (c, as) => {
				if (!proposal) return null;
				return (await endProposal(c, as, keyOf(proposal), kind)).issue;
			}),
		[act, proposal],
	);

	const refresh = useCallback(async (): Promise<ProposalRow | null> => {
		if (!client || !digest) return null;
		try {
			const now = await queries.fetchQuery({
				queryKey: remoteKey,
				queryFn: () => readRemote(client, digest as Hex),
				staleTime: 0,
			});
			return now.found?.row ?? null;
		} catch {
			return null;
		}
	}, [client, digest, queries, remoteKey]);

	const found = remoteData?.found ?? null;
	const blocker = proposal ? publishBlocker(proposal) : null;
	const storedSignerNow = useStoredSigner(proposal, !!client && !found);
	const relayView: RelayView = {
		active: !!client,
		known: !!found,
		loading: !!client && !!digest && remote.isPending,
		row: found?.row ?? null,
		expired: !!found && found.row.expiresAt <= Date.now(),
		signers: found?.proposal.signatures.map((s) => s.signer) ?? [],
		canPublish: !!client && !found && blocker === null && storedSignerNow,
		blocker,
		issue: problem ?? queryIssue(remote.error),
		busy,
	};

	return {
		proposal,
		issues: [
			...(stored ? (local.data?.issues ?? []) : []),
			...(remoteData?.issues ?? []),
			...syncIssues,
		],
		loading:
			!!digest &&
			(local.isPending ||
				// the relay has it and it is on its way into this browser
				(!proposal && !!client && (remote.isPending || !!found))),
		storageError:
			storageError ?? (local.isError ? errorMessage(local.error) : null),
		relay: relayView,
		store,
		publish,
		takeBack,
		end,
		refresh,
	};
}

/** Whether the relay lists the signed-in wallet as a signer of the proposal's (unfrozen) treasury. */
function useStoredSigner(proposal: Proposal | null, enabled: boolean): boolean {
	const relay = useRelay();
	const client = relay.client;
	const me = relay.wallet;
	const query = useQuery({
		...(client && me
			? treasuriesQuery(client, me)
			: {
					queryKey: ["relay", me, "treasuries"] as const,
					queryFn: async () => ({ rows: [], dropped: 0 }),
				}),
		enabled: enabled && !!client && !!me,
	});
	if (!proposal || !me) return false;
	return (query.data?.rows ?? []).some(
		(t) =>
			t.network === proposal.payload.network &&
			t.address === proposal.payload.multiSigUser &&
			t.frozenAt === null &&
			t.signers.includes(me),
	);
}
