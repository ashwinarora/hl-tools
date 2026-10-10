/**
 * HyperCore explorer API (`<coreExplorerApiUrl>`, JSON POST like the info
 * endpoint). It is the only public source of an account's past actions, but
 * every request weighs 40 of the 1200/min per-IP budget and the answer is
 * capped at the newest ~101 transactions, so callers fetch on demand and never
 * poll. Multi-sig envelopes appear as their inner action attributed to the
 * multi-sig user; the leader and the signatures are not visible.
 */
import { type Observed, observed } from "../identity.ts";
import { type Network, networkConfig } from "../network.ts";
import { InfoRequestError } from "./info.ts";

/** One explorer transaction as `userDetails` returns it (newest first). */
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
	/** The API returns at most ~101 entries; true when the list may be cut. */
	readonly truncated: boolean;
}

/** Observed on testnet 2026-10-08: `userDetails` answered exactly 101 entries for a busy account. */
export const EXPLORER_PAGE_CAP = 101;

export interface ExplorerOptions {
	readonly signal?: AbortSignal;
	readonly fetch?: typeof fetch;
	readonly now?: () => number;
}

export async function explorerUserDetails<N extends Network>(
	network: N,
	user: string,
	options: ExplorerOptions = {},
): Promise<Observed<ExplorerHistory, N>> {
	const body = { type: "userDetails", user: user.toLowerCase() };
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
	const text = await res.text();
	if (!res.ok) {
		throw new InfoRequestError(
			network,
			body,
			res.status === 429
				? "Explorer rate limit hit (every explorer request weighs 40 of the 1200/min budget)."
				: `Explorer answered HTTP ${res.status}.`,
			res.status,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new InfoRequestError(
			network,
			body,
			"Explorer answered non-JSON.",
			res.status,
		);
	}
	const raw = (parsed as { txs?: unknown })?.txs;
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
		.map((t) => ({
			time: Number(t.time),
			user: String(t.user ?? "").toLowerCase(),
			action: (t.action && typeof t.action === "object"
				? t.action
				: { type: "unknown" }) as ExplorerTx["action"],
			block: Number(t.block),
			hash: String(t.hash ?? ""),
			error: typeof t.error === "string" ? t.error : null,
		}))
		.sort((a, b) => b.time - a.time);
	return observed(
		network,
		`POST ${url} userDetails`,
		{ txs, truncated: txs.length >= EXPLORER_PAGE_CAP },
		(options.now ?? Date.now)(),
	);
}
