/**
 * HyperCore explorer API (`<coreExplorerApiUrl>`, JSON POST like the info
 * endpoint). It is the only public source of an account's past actions, but
 * every request weighs 40 of the 1200/min per-IP budget and `userDetails`
 * answers with the account's newest transactions only (`EXPLORER_PAGE_CAP`),
 * so callers fetch on demand and never poll. Multi-sig envelopes appear as
 * their inner action attributed to the multi-sig user; the leader and the
 * signatures are not visible.
 *
 * Two requests, rationed differently (measured on testnet, 2026-10-13):
 * `txDetails` is refused for the rest of the day once an address has asked
 * for about a hundred older transactions; `userDetails` kept answering then.
 * One `userDetails` therefore does the work of many `txDetails` for anything
 * among an account's newest transactions.
 */
import { type Observed, observed } from "../identity.ts";
import { type Network, networkConfig } from "../network.ts";
import { type InfoBody, InfoRequestError } from "./info.ts";

/** One explorer transaction, as `userDetails` lists it and `txDetails` returns it. */
export interface ExplorerTx {
	readonly time: number;
	readonly user: string;
	readonly action: { readonly type: string } & Record<string, unknown>;
	readonly block: number;
	readonly hash: string;
	/** The chain's error string when the action was rejected, else null. */
	readonly error: string | null;
}

export interface ExplorerHistory {
	readonly txs: readonly ExplorerTx[];
	/** The API returns the newest entries only; true when the list may be cut. */
	readonly truncated: boolean;
}

/**
 * How many transactions `userDetails` answers with at most: the account's
 * newest. Measured 2026-10-13: exactly 300 for busy accounts on mainnet and
 * on testnet (fixtures/explorer/testnet-userdetails.json), whatever time
 * range or paging field the request carried; Hyperliquid's own explorer page
 * sends the same request and pages through those 300. It was 101 when first
 * observed (testnet, 2026-10-08), so nothing should depend on the figure
 * beyond saying that a list may be cut.
 */
export const EXPLORER_PAGE_CAP = 300;

export interface ExplorerOptions {
	readonly signal?: AbortSignal;
	readonly fetch?: typeof fetch;
	readonly now?: () => number;
}

/** POST one explorer request; hands back the status and the body as text. */
async function post<N extends Network>(
	network: N,
	body: { readonly type: string } & Record<string, unknown>,
	options: ExplorerOptions,
): Promise<{
	readonly status: number;
	readonly ok: boolean;
	readonly text: string;
	readonly url: string;
}> {
	const url = networkConfig(network).coreExplorerApiUrl;
	const doFetch = options.fetch ?? fetch;
	let res: Response;
	try {
		res = await doFetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: options.signal,
		});
	} catch (e) {
		throw new InfoRequestError(
			network,
			body,
			(e as Error).name === "AbortError"
				? "Stopped."
				: `Explorer request failed: ${(e as Error).message}`,
			null,
			e,
		);
	}
	return { status: res.status, ok: res.ok, text: await res.text(), url };
}

function refused<N extends Network>(
	network: N,
	body: { readonly type: string } & Record<string, unknown>,
	status: number,
): InfoRequestError {
	return new InfoRequestError(
		network,
		body,
		status === 429
			? "Explorer rate limit hit (every explorer request weighs 40 of the 1200/min budget)."
			: `Explorer answered HTTP ${status}.`,
		status,
	);
}

function txOf(t: Record<string, unknown>): ExplorerTx {
	return {
		time: Number(t.time),
		user: String(t.user ?? "").toLowerCase(),
		action: (t.action && typeof t.action === "object"
			? t.action
			: { type: "unknown" }) as ExplorerTx["action"],
		block: Number(t.block),
		hash: String(t.hash ?? ""),
		error: typeof t.error === "string" ? t.error : null,
	};
}

/**
 * The explorer refused a request because this network address has used up its
 * allowance for the day. Measured on testnet (2026-10-12 and 13): "More than
 * 100 archived blocks queried in one day", answered with HTTP 200 to every
 * `txDetails` from then on, a transaction seconds old included. It says
 * nothing about the hash or the account, so it is an error and never "not
 * found"; a caller should stop asking for a while instead of trying again.
 */
export class ExplorerAllowanceError extends InfoRequestError {
	constructor(
		network: Network,
		body: InfoBody,
		message: string,
		status: number,
	) {
		super(network, body, message, status);
		this.name = "ExplorerAllowanceError";
	}
}
const ALLOWANCE_SPENT = /queried in one day/i;

export async function explorerUserDetails<N extends Network>(
	network: N,
	user: string,
	options: ExplorerOptions = {},
): Promise<Observed<ExplorerHistory, N>> {
	const body = { type: "userDetails", user: user.toLowerCase() };
	const res = await post(network, body, options);
	if (!res.ok) throw refused(network, body, res.status);
	let parsed: unknown;
	try {
		parsed = JSON.parse(res.text);
	} catch {
		throw new InfoRequestError(
			network,
			body,
			"Explorer answered non-JSON.",
			res.status,
		);
	}
	const answer = (parsed ?? {}) as {
		type?: unknown;
		message?: unknown;
		txs?: unknown;
	};
	// a refusal says nothing about the account: never "no transactions"
	if (
		answer.type === "error" &&
		typeof answer.message === "string" &&
		ALLOWANCE_SPENT.test(answer.message)
	)
		throw new ExplorerAllowanceError(network, body, answer.message, res.status);
	const raw = answer.txs;
	if (!Array.isArray(raw)) {
		throw new InfoRequestError(
			network,
			body,
			"Explorer answer has no txs list.",
			res.status,
		);
	}
	const txs: ExplorerTx[] = raw
		.filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
		.map(txOf)
		.sort((a, b) => b.time - a.time);
	return observed(
		network,
		`POST ${res.url} userDetails`,
		{ txs, truncated: txs.length >= EXPLORER_PAGE_CAP },
		(options.now ?? Date.now)(),
	);
}

/**
 * What `txDetails` says about one hash. `found: false` is an answer, not a
 * failure: the explorer does not know the hash (yet, or at all).
 */
export type ExplorerTxLookup =
	| { readonly found: true; readonly tx: ExplorerTx }
	| { readonly found: false; readonly reason: string };

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Look one transaction up by hash. For a multi-sig transaction `user` is the
 * multi-sig account and `action` the inner action exactly as it was signed;
 * a rejected attempt is found too, with `error` set. Measured on testnet
 * (2026-10-11): the hash of a transfer is known about 0.2 s after the ledger
 * shows it; an unknown hash answers 200 with `{"type":"error"}`, a malformed
 * one HTTP 422. One request, weight 40. Throws `ExplorerAllowanceError` once
 * the day's allowance is used up.
 */
export async function explorerTxDetails<N extends Network>(
	network: N,
	hash: string,
	options: ExplorerOptions = {},
): Promise<Observed<ExplorerTxLookup, N>> {
	const now = options.now ?? Date.now;
	const source = `POST ${networkConfig(network).coreExplorerApiUrl} txDetails`;
	// not worth a request, and the explorer would answer 422
	if (!TX_HASH.test(hash))
		return observed(
			network,
			source,
			{ found: false, reason: "Not a transaction hash." },
			now(),
		);
	const wanted = hash.toLowerCase();
	const body = { type: "txDetails", hash: wanted };
	const res = await post(network, body, options);
	if (res.status === 422)
		return observed(
			network,
			source,
			{ found: false, reason: "The explorer did not accept the hash." },
			now(),
		);
	if (!res.ok) throw refused(network, body, res.status);
	let parsed: unknown;
	try {
		parsed = JSON.parse(res.text);
	} catch {
		throw new InfoRequestError(
			network,
			body,
			"Explorer answered non-JSON.",
			res.status,
		);
	}
	const answer = (parsed ?? {}) as {
		type?: unknown;
		message?: unknown;
		tx?: unknown;
	};
	if (
		answer.type === "error" &&
		typeof answer.message === "string" &&
		ALLOWANCE_SPENT.test(answer.message)
	)
		throw new ExplorerAllowanceError(network, body, answer.message, res.status);
	if (answer.type === "error")
		return observed(
			network,
			source,
			{
				found: false,
				reason:
					typeof answer.message === "string" && answer.message
						? answer.message
						: "The explorer does not know this hash.",
			},
			now(),
		);
	if (
		answer.type !== "txDetails" ||
		!answer.tx ||
		typeof answer.tx !== "object"
	)
		throw new InfoRequestError(
			network,
			body,
			"Explorer answer has no transaction.",
			res.status,
		);
	const tx = txOf(answer.tx as Record<string, unknown>);
	// an answer about another transaction must never be matched to this one
	if (tx.hash.toLowerCase() !== wanted)
		throw new InfoRequestError(
			network,
			body,
			"Explorer answered for another transaction.",
			res.status,
		);
	return observed(network, source, { found: true, tx }, now());
}
