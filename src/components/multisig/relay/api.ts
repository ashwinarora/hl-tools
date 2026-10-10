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
	type Receipt,
} from "@hl-tools/core";
import { receiptText } from "../model/relay/assemble";
import { isDuplicate, relayIssue } from "../model/relay/errors";
import type { PublishRow } from "../model/relay/push";
import {
	type EndingKind,
	type EventRow,
	eventRows,
	type Parsed,
	type ProposalRow,
	proposalRows,
	type RequestKind,
	type RequestRow,
	requestRows,
	type TreasuryRow,
	treasuryRows,
} from "../model/relay/rows";
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
	"endings(kind,ended_by,ended_at)," +
	"receipts(submitted_at,submitted_by,signature_chain_id,outer_r,outer_s,outer_v,http_status,response,accepted,recorded_at)";
const EVENT = "id,network,treasury,digest,kind,actor,data,at";
const REQUEST = "id,network,address,kind,status,reason,created_at,finished_at";

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

/** Withdraw (the proposer) or decline (the finaliser). Cannot be undone. */
export function endProposal(
	client: RelayClient,
	as: Address,
	key: ProposalKey,
	kind: EndingKind,
): Promise<Result<true>> {
	return write(client, as, () =>
		client.from("endings").insert({ ...key, kind }),
	);
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
