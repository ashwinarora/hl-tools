/**
 * Every read and write the signer makes against the relay. Each function
 * takes the client, returns a result and never throws: a refusal, an expired
 * session and an unreachable relay all come back as an issue the page can
 * show. Reads return rows parsed by the model (the relay is input, not
 * truth); writes first make sure the session speaks for the wallet the page
 * believes it does.
 */
import {
	type Address,
	type Hex,
	type Issue,
	issue,
	type Network,
	type Proposal,
	type Receipt,
} from "@hl-tools/core";
import { receiptText } from "../model/relay/assemble";
import type { MarkChain } from "../model/relay/away";
import { isDuplicate, relayIssue } from "../model/relay/errors";
import type { NicknameRow } from "../model/relay/nicknames";
import { type PublishRow, publishRow } from "../model/relay/push";
import {
	type EventRow,
	eventRows,
	type MarkRow,
	markRows,
	nicknameRows,
	type Parsed,
	type ProposalRow,
	proposalRows,
	type ReportRow,
	type RequestKind,
	type RequestRow,
	reportRows,
	requestRows,
	type TreasuryRow,
	treasuryRows,
	viewRows,
} from "../model/relay/rows";
import type { ViewRow } from "../model/relay/views";
import type { RelayClient } from "./client";
import { sessionWallet } from "./session";

export interface Result<T> {
	readonly data: T | null;
	readonly issue: Issue | null;
}

export interface ProposalKey {
	readonly network: Network;
	readonly treasury: Address;
	readonly digest: Hex;
}

const TREASURY =
	"network,address,threshold,frozen_at,checked_at,changed_at,added_by,created_at,treasury_signers(signer)";
const PROPOSAL =
	"network,treasury,digest,document,created_by,finaliser,nonce,expires_at,status,closed_at,created_at," +
	"signatures(signer,r,s,v,created_at)," +
	"objections(signer,created_at)," +
	"endings(kind,ended_by,ended_at)," +
	"receipts(submitted_at,submitted_by,signature_chain_id,outer_r,outer_s,outer_v,http_status,response,accepted,recorded_at)";
const EVENT = "id,network,treasury,digest,kind,actor,data,at";
const REQUEST = "id,network,address,kind,status,reason,created_at,finished_at";
const NICKNAME = "network,treasury,address,name,set_by,set_at";
const REPORT =
	"id,network,treasury,digest,tx_hash,status,reason,created_at,finished_at";

type Answer = { data: unknown; error: unknown };

async function read<T>(
	query: () => PromiseLike<Answer>,
	parse: (data: unknown) => T,
): Promise<Result<T>> {
	try {
		const { data, error } = await query();
		if (error) return { data: null, issue: relayIssue(error) };
		return { data: parse(data), issue: null };
	} catch (e) {
		return { data: null, issue: relayIssue(e) };
	}
}

async function write(
	client: RelayClient,
	as: Address,
	statement: () => PromiseLike<Answer>,
	opts: { duplicateIsFine?: boolean } = {},
): Promise<Result<true>> {
	const wrong = await wrongWallet(client, as);
	if (wrong) return { data: null, issue: wrong };
	try {
		const { error } = await statement();
		if (error && !(opts.duplicateIsFine && isDuplicate(error))) {
			return { data: null, issue: relayIssue(error) };
		}
		return { data: true, issue: null };
	} catch (e) {
		return { data: null, issue: relayIssue(e) };
	}
}

/**
 * The relay stamps every write with the session's wallet. If that is not the
 * wallet the page is acting for (the wallet was switched, the session is
 * someone else's), the write would be filed under the wrong name: stop here.
 */
async function wrongWallet(
	client: RelayClient,
	as: Address,
): Promise<Issue | null> {
	const session = await sessionWallet(client);
	if (session === as) return null;
	return issue(
		"relay.wrong_wallet",
		"error",
		session
			? `You are signed in as ${session}, not as ${as}. Nothing was sent.`
			: "You are not signed in. Nothing was sent.",
		{ fix: "Sign in with the connected wallet and retry." },
	);
}

// ------------------------------------------------------------------------ reads

export function listTreasuries(
	client: RelayClient,
): Promise<Result<Parsed<TreasuryRow>>> {
	return read(
		() => client.from("treasuries").select(TREASURY).order("created_at"),
		treasuryRows,
	);
}

/** Every proposal still collecting signatures, across the wallet's treasuries and both networks. */
export function listOpenProposals(
	client: RelayClient,
	now: number = Date.now(),
): Promise<Result<Parsed<ProposalRow>>> {
	return read(
		() =>
			client
				.from("proposals")
				.select(PROPOSAL)
				.eq("status", "open")
				.gt("expires_at", new Date(now).toISOString())
				.order("created_at", { ascending: false })
				.limit(500),
		proposalRows,
	);
}

/** The relay's rows for a digest: normally one; more only if it was filed under several treasuries. */
export function getProposal(
	client: RelayClient,
	digest: Hex,
): Promise<Result<Parsed<ProposalRow>>> {
	return read(
		() => client.from("proposals").select(PROPOSAL).eq("digest", digest),
		proposalRows,
	);
}

/** Proposals of one treasury by digest: the documents behind a page of history. */
export function listProposalsByDigest(
	client: RelayClient,
	network: Network,
	treasury: Address,
	digests: readonly Hex[],
): Promise<Result<Parsed<ProposalRow>>> {
	if (digests.length === 0)
		return Promise.resolve({ data: { rows: [], dropped: 0 }, issue: null });
	return read(
		() =>
			client
				.from("proposals")
				.select(PROPOSAL)
				.eq("network", network)
				.eq("treasury", treasury)
				.in("digest", [...digests]),
		proposalRows,
	);
}

/** How many of a treasury's proposals are read to explain its ledger and API wallets. */
export const PROPOSALS_PAGE = 200;

/** A treasury's proposals, newest first, whatever became of them. */
export function listProposals(
	client: RelayClient,
	network: Network,
	treasury: Address,
	opts: { limit?: number } = {},
): Promise<Result<Parsed<ProposalRow>>> {
	return read(
		() =>
			client
				.from("proposals")
				.select(PROPOSAL)
				.eq("network", network)
				.eq("treasury", treasury)
				.order("created_at", { ascending: false })
				.limit(opts.limit ?? PROPOSALS_PAGE),
		proposalRows,
	);
}

export const HISTORY_PAGE = 50;

/** A treasury's history, newest first; `before` is the id to continue below. */
export function listEvents(
	client: RelayClient,
	network: Network,
	treasury: Address,
	opts: { before?: number; limit?: number } = {},
): Promise<Result<Parsed<EventRow>>> {
	return read(() => {
		let q = client
			.from("events")
			.select(EVENT)
			.eq("network", network)
			.eq("treasury", treasury)
			.order("id", { ascending: false })
			.limit(opts.limit ?? HISTORY_PAGE);
		if (opts.before !== undefined) q = q.lt("id", opts.before);
		return q;
	}, eventRows);
}

/**
 * The newest signatures given for a treasury's proposals: who, and when.
 * Fewer rows than `limit` means there are no older ones.
 */
export function listSignatureEvents(
	client: RelayClient,
	network: Network,
	treasury: Address,
	limit: number,
): Promise<Result<Parsed<EventRow>>> {
	return read(
		() =>
			client
				.from("events")
				.select(EVENT)
				.eq("network", network)
				.eq("treasury", treasury)
				.eq("kind", "signature_added")
				.order("id", { ascending: false })
				.limit(limit),
		eventRows,
	);
}

/** One signer's newest signature for a treasury; null when there is none on record. */
export function lastSignatureOf(
	client: RelayClient,
	network: Network,
	treasury: Address,
	signer: Address,
): Promise<Result<EventRow | null>> {
	return read(
		() =>
			client
				.from("events")
				.select(EVENT)
				.eq("network", network)
				.eq("treasury", treasury)
				.eq("kind", "signature_added")
				.eq("actor", signer)
				.order("id", { ascending: false })
				.limit(1),
		(data) => eventRows(data).rows[0] ?? null,
	);
}

/** The events of one proposal (who signed, who took a signature back, how it ended). */
export function listProposalEvents(
	client: RelayClient,
	key: ProposalKey,
): Promise<Result<Parsed<EventRow>>> {
	return read(
		() =>
			client
				.from("events")
				.select(EVENT)
				.eq("network", key.network)
				.eq("treasury", key.treasury)
				.eq("digest", key.digest)
				.order("id"),
		eventRows,
	);
}

export function getRequest(
	client: RelayClient,
	id: string,
): Promise<Result<RequestRow | null>> {
	return read(
		() => client.from("treasury_requests").select(REQUEST).eq("id", id),
		(data) => requestRows(data).rows[0] ?? null,
	);
}

/** The signed-in wallet's own reports about one proposal, oldest first. */
export function listReports(
	client: RelayClient,
	key: ProposalKey,
): Promise<Result<Parsed<ReportRow>>> {
	return read(
		() =>
			client
				.from("execution_reports")
				.select(REPORT)
				.eq("network", key.network)
				.eq("treasury", key.treasury)
				.eq("digest", key.digest)
				.order("created_at"),
		reportRows,
	);
}

/** Which signers have opened a proposal, and when. */
export function listViews(
	client: RelayClient,
	key: ProposalKey,
): Promise<Result<Parsed<ViewRow>>> {
	return read(
		() =>
			client
				.from("proposal_views")
				.select("signer,seen_at")
				.eq("network", key.network)
				.eq("treasury", key.treasury)
				.eq("digest", key.digest)
				.order("seen_at"),
		viewRows,
	);
}

/**
 * The signed-in wallet's own markers, newest first: what it has said "Got it"
 * to. A wallet moves a marker a few times a day; the newest rows cover every
 * treasury it signs for long before the limit.
 */
export function listMarks(
	client: RelayClient,
): Promise<Result<Parsed<MarkRow>>> {
	return read(
		() =>
			client
				.from("read_marks")
				.select("id,network,treasury,event_id,chain,marked_at")
				.order("id", { ascending: false })
				.limit(2000),
		markRows,
	);
}

/** How much history one read of "what happened since" takes. */
export const NEWS_PAGE = 1000;

/**
 * History entries after `afterId` across the wallet's treasuries, newest
 * first: when there are more than a page, it is the oldest that are left out.
 */
export function listEventsAfter(
	client: RelayClient,
	afterId: number,
	opts: { limit?: number } = {},
): Promise<Result<Parsed<EventRow>>> {
	return read(
		() =>
			client
				.from("events")
				.select(EVENT)
				.gt("id", afterId)
				.order("id", { ascending: false })
				.limit(opts.limit ?? NEWS_PAGE),
		eventRows,
	);
}

/** Proposals by digest, whichever of the wallet's treasuries they belong to. */
export async function listProposalsIn(
	client: RelayClient,
	digests: readonly Hex[],
): Promise<Result<Parsed<ProposalRow>>> {
	const rows: ProposalRow[] = [];
	let dropped = 0;
	// a digest is 66 characters: a hundred of them fit a request line comfortably
	for (let i = 0; i < digests.length; i += 100) {
		const part = await read(
			() =>
				client
					.from("proposals")
					.select(PROPOSAL)
					.in("digest", digests.slice(i, i + 100)),
			proposalRows,
		);
		if (!part.data) return { data: null, issue: part.issue };
		rows.push(...part.data.rows);
		dropped += part.data.dropped;
	}
	return { data: { rows, dropped }, issue: null };
}

/**
 * Proposals that were carried out (through the tool or outside it) with a
 * nonce above `afterNonce`, across the wallet's treasuries, newest first.
 * They tell which older pending sends Hyperliquid will now refuse.
 */
export function listCarriedOutAfter(
	client: RelayClient,
	afterNonce: number,
): Promise<Result<Parsed<ProposalRow>>> {
	return read(
		() =>
			client
				.from("proposals")
				.select(PROPOSAL)
				.in("status", ["accepted", "carried_out"])
				.gt("nonce", afterNonce)
				.order("nonce", { ascending: false })
				.limit(200),
		proposalRows,
	);
}

/** Proposals nobody ended whose signing window closed between two moments. */
export function listLapsed(
	client: RelayClient,
	since: number,
	now: number = Date.now(),
): Promise<Result<Parsed<ProposalRow>>> {
	return read(
		() =>
			client
				.from("proposals")
				.select(PROPOSAL)
				.eq("status", "open")
				.gt("expires_at", new Date(since).toISOString())
				.lte("expires_at", new Date(now).toISOString())
				.order("expires_at", { ascending: false })
				.limit(200),
		proposalRows,
	);
}

/** Every nickname the wallet may read: those of the treasuries it signs for, each under its own treasury. */
export function listNicknames(
	client: RelayClient,
): Promise<Result<Parsed<NicknameRow>>> {
	return read(
		() => client.from("nicknames").select(NICKNAME).limit(5000),
		nicknameRows,
	);
}

// ----------------------------------------------------------------------- writes

/** Ask the relay to look an account up: `add` to start tracking it, `check` to refresh its signer copy. */
export async function requestTreasury(
	client: RelayClient,
	as: Address,
	network: Network,
	address: Address,
	kind: RequestKind,
): Promise<Result<RequestRow>> {
	const wrong = await wrongWallet(client, as);
	if (wrong) return { data: null, issue: wrong };
	const r = await read(
		() =>
			client
				.from("treasury_requests")
				.insert({ network, address, kind })
				.select(REQUEST),
		(data) => requestRows(data).rows[0] ?? null,
	);
	if (r.issue) return { data: null, issue: r.issue };
	if (!r.data) {
		return {
			data: null,
			issue: issue(
				"relay.error",
				"error",
				"The relay accepted the request but did not return it.",
			),
		};
	}
	return { data: r.data, issue: null };
}

/** Share a proposal. Already there counts as done. */
export function publishProposal(
	client: RelayClient,
	as: Address,
	row: PublishRow,
): Promise<Result<true>> {
	return write(client, as, () => client.from("proposals").insert(row), {
		duplicateIsFine: true,
	});
}

/** Add the session wallet's own signature. Already there counts as done. */
export function addSignature(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
	signature: { readonly r: Hex; readonly s: Hex; readonly v: 27 | 28 },
): Promise<Result<true>> {
	return write(
		client,
		as,
		() =>
			client
				.from("signatures")
				.insert({ ...key, r: signature.r, s: signature.s, v: signature.v }),
		{ duplicateIsFine: true },
	);
}

/** Take the session wallet's own signature back. */
export function removeSignature(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
): Promise<Result<true>> {
	return write(client, as, () =>
		client
			.from("signatures")
			.delete()
			.eq("network", key.network)
			.eq("treasury", key.treasury)
			.eq("digest", key.digest)
			.eq("signer", as),
	);
}

/**
 * Point the relay at the transaction that carried a proposal out without it.
 * The relay checks the transaction itself before closing anything. Already
 * told (by this wallet or a co-signer) counts as done.
 */
export function reportExecution(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
	txHash: Hex,
): Promise<Result<true>> {
	return write(
		client,
		as,
		() => client.from("execution_reports").insert({ ...key, tx_hash: txHash }),
		{ duplicateIsFine: true },
	);
}

/**
 * Record that the signed-in wallet has opened a proposal. The relay keeps the
 * first look only, and none at all for a closed proposal; both come back as
 * done.
 */
export function recordView(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
): Promise<Result<true>> {
	return write(client, as, () => client.from("proposal_views").insert(key), {
		duplicateIsFine: true,
	});
}

/** A marker to write: everything up to `eventId` is read, and what the signer now knows of the chain. */
export interface MarkWrite {
	readonly network: Network;
	readonly treasury: Address;
	readonly eventId: number;
	readonly chain: MarkChain;
}

/**
 * Move the signed-in wallet's markers ("Got it", "Mark all as read"): one
 * request for all of them. The relay never moves a marker back.
 */
export function markRead(
	client: RelayClient,
	as: Address,
	marks: readonly MarkWrite[],
): Promise<Result<true>> {
	if (marks.length === 0) return Promise.resolve({ data: true, issue: null });
	return write(client, as, () =>
		client.from("read_marks").insert(
			marks.map((m) => ({
				network: m.network,
				treasury: m.treasury,
				event_id: m.eventId,
				chain: m.chain,
			})),
		),
	);
}

/**
 * Give an address a nickname inside one treasury, or (with null) take it
 * away. No signature: it is a label for the treasury's signers, not an action.
 */
export function setNickname(
	client: RelayClient,
	as: Address,
	change: {
		readonly network: Network;
		readonly treasury: Address;
		readonly address: Address;
		readonly name: string | null;
	},
): Promise<Result<true>> {
	return write(client, as, () =>
		client.from("nickname_changes").insert({
			network: change.network,
			treasury: change.treasury,
			address: change.address,
			name: change.name,
		}),
	);
}

/**
 * Withdraw a proposal: its proposer ends it for everyone. Cannot be undone.
 * It is the only way a proposal is ended by a signer; the finaliser's
 * "decline" is gone (the relay refuses it), a finaliser says no instead.
 */
export function withdrawProposal(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
): Promise<Result<true>> {
	return write(client, as, () =>
		client.from("endings").insert({ ...key, kind: "withdrawn" }),
	);
}

/**
 * Say no as the session wallet: an objection the co-signers see, which ends
 * nothing. The relay takes the wallet's own signature on the proposal back
 * with it (one position at a time). Already said counts as done.
 */
export function addObjection(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
): Promise<Result<true>> {
	return write(client, as, () => client.from("objections").insert({ ...key }), {
		duplicateIsFine: true,
	});
}

/** Take the session wallet's own no back. */
export function removeObjection(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
): Promise<Result<true>> {
	return write(client, as, () =>
		client
			.from("objections")
			.delete()
			.eq("network", key.network)
			.eq("treasury", key.treasury)
			.eq("digest", key.digest)
			.eq("signer", as),
	);
}

// ------------------------------------------------------------------- a move
//
// A move is two proposals the pages show as one (model/move.ts). The relay
// knows nothing of that: what it gives is that ONE statement is taken whole
// or not at all, so its limits, the proposer rule and a step that closed in
// the meantime never leave a move half shared, half withdrawn or half
// objected to (pgTAP 170_moves.sql). Every key of a move has the same network
// and treasury.

/**
 * One statement for all rows; when the relay refuses it only because one of
 * them is already there, each row by itself, where that counts as done.
 */
async function together<T>(
	client: RelayClient,
	as: Address,
	rows: readonly T[],
	all: () => PromiseLike<Answer>,
	each: (row: T) => Promise<Result<true>>,
): Promise<Result<true>> {
	const wrong = await wrongWallet(client, as);
	if (wrong) return { data: null, issue: wrong };
	try {
		const { error } = await all();
		if (!error) return { data: true, issue: null };
		if (!isDuplicate(error)) return { data: null, issue: relayIssue(error) };
	} catch (e) {
		return { data: null, issue: relayIssue(e) };
	}
	for (const row of rows) {
		const one = await each(row);
		if (one.issue) return one;
	}
	return { data: true, issue: null };
}

/** Share the proposals of a move: all of them, or none. */
export function publishMove(
	client: RelayClient,
	as: Address,
	rows: readonly PublishRow[],
): Promise<Result<true>> {
	return together(
		client,
		as,
		rows,
		() => client.from("proposals").insert([...rows]),
		(row) => publishProposal(client, as, row),
	);
}

/**
 * Share a move as it is in this browser: its steps in one write (all of them
 * or none; a step the relay has already counts as done), then the session
 * wallet's own signature on each. Sharing one step and not the other would
 * put half a move in the co-signers' lists.
 */
export async function shareMove(
	client: RelayClient,
	as: Address,
	steps: readonly Proposal[],
): Promise<Result<true>> {
	const shared = await publishMove(client, as, steps.map(publishRow));
	if (shared.issue) return shared;
	for (const p of steps) {
		const mine = p.signatures.find((x) => x.signer === as);
		if (!mine) continue;
		const signed = await addSignature(
			client,
			as,
			{
				network: p.payload.network,
				treasury: p.payload.multiSigUser,
				digest: p.digest,
			},
			mine,
		);
		if (signed.issue) return signed;
	}
	return { data: true, issue: null };
}

/** Withdraw the open proposals of a move as their proposer: all of them, or none. */
export function withdrawMove(
	client: RelayClient,
	as: Address,
	keys: readonly ProposalKey[],
): Promise<Result<true>> {
	return write(client, as, () =>
		client
			.from("endings")
			.insert(keys.map((key) => ({ ...key, kind: "withdrawn" }))),
	);
}

/** Say no to the open proposals of a move: to all of them, or to none. */
export function addObjections(
	client: RelayClient,
	as: Address,
	keys: readonly ProposalKey[],
): Promise<Result<true>> {
	return together(
		client,
		as,
		keys,
		() => client.from("objections").insert(keys.map((key) => ({ ...key }))),
		(key) => addObjection(client, as, key),
	);
}

/** One statement that removes the session wallet's own rows on the proposals named. */
function removeOwn(
	client: RelayClient,
	as: Address,
	table: "objections" | "signatures",
	keys: readonly ProposalKey[],
): Promise<Result<true>> {
	const [first] = keys;
	if (!first) return Promise.resolve({ data: true, issue: null });
	return write(client, as, () =>
		client
			.from(table)
			.delete()
			.eq("network", first.network)
			.eq("treasury", first.treasury)
			.in(
				"digest",
				keys.map((key) => key.digest),
			)
			.eq("signer", as),
	);
}

/** Take the session wallet's no back from the open proposals of a move. */
export function removeObjections(
	client: RelayClient,
	as: Address,
	keys: readonly ProposalKey[],
): Promise<Result<true>> {
	return removeOwn(client, as, "objections", keys);
}

/** Take the session wallet's signatures back from the open proposals of a move. */
export function removeSignatures(
	client: RelayClient,
	as: Address,
	keys: readonly ProposalKey[],
): Promise<Result<true>> {
	return removeOwn(client, as, "signatures", keys);
}

/** Record what Hyperliquid answered. The same attempt twice counts as done. */
export function recordReceipt(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
	receipt: Receipt,
): Promise<Result<true>> {
	return write(
		client,
		as,
		() =>
			client.from("receipts").insert({
				...key,
				submitted_at: receipt.submittedAt,
				signature_chain_id: receipt.signatureChainId,
				outer_r: receipt.outerSignature.r,
				outer_s: receipt.outerSignature.s,
				outer_v: receipt.outerSignature.v,
				http_status: receipt.httpStatus,
				response: receiptText(receipt),
			}),
		{ duplicateIsFine: true },
	);
}
