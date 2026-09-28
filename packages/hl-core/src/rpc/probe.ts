/**
 * Bounded, read-only capability probe for an EVM JSON-RPC endpoint, tuned
 * for HyperEVM. Around 25 requests, paced for the public endpoint's
 * 100 requests/minute limit.
 *
 * The central question: does the endpoint really serve historical state, or
 * does it silently answer historical queries with the latest state? Two
 * exact controls decide it:
 *  - nonce oracle: a transaction from X with nonce n in block B means X's
 *    nonce at block B−1 is exactly n, and "latest" is at least n+1;
 *  - code existence: a well-known contract has no code at a very early block.
 */

import type { Network } from "../network.ts";
import { networkForChainId } from "../network.ts";
import { DEFAULT_RPC_LIMITS } from "../rules/hyperevm.ts";
import {
	hexToBigInt,
	type RpcExchange,
	rpcCall,
	toHexQuantity,
} from "./client.ts";

export type ProbeStatus = "supported" | "unsupported" | "inconclusive";

export interface ProbeFlag {
	readonly kind:
		| "latest-for-historical"
		| "limit-differs"
		| "network-mismatch"
		| "not-hyperevm";
	readonly message: string;
}

export interface ProbeCheck {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly status: ProbeStatus;
	readonly detail: string;
	readonly value?: string;
	readonly flag?: ProbeFlag;
	readonly exchanges: readonly RpcExchange[];
}

export interface ProbeResult {
	readonly displayUrl: string;
	readonly sensitive: boolean;
	readonly startedAt: number;
	readonly finishedAt: number;
	readonly chainId: number | null;
	readonly network: Network | null;
	readonly checks: readonly ProbeCheck[];
	readonly aborted: string | null;
}

/** Well-known contracts used as code-existence controls (USDC on each network). */
export const CODE_CONTROLS: Readonly<Record<Network, string>> = {
	mainnet: "0xb88339CB7199b77E23DB6E890353E22632Ba630f",
	testnet: "0x2B3370eE501B4a559b57D449569354196457D8Ab",
};
/** ERC-20 totalSupply() selector. */
const TOTAL_SUPPLY = "0x18160ddd";
const EARLY_BLOCK = 1000n;
const COREWRITER = "0x3333333333333333333333333333333333333333";

const SECRET_PARAM =
	/^(api[-_]?key|key|token|access[-_]?token|auth|secret|apikey|x-api-key)$/i;

/** Redact API keys in a URL (query params, long path segments, userinfo). */
export function redactUrl(raw: string): {
	display: string;
	sensitive: boolean;
	valid: boolean;
} {
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		return { display: "invalid URL", sensitive: false, valid: false };
	}
	if (u.protocol !== "https:" && u.protocol !== "http:")
		return {
			display: `${u.protocol} not supported`,
			sensitive: false,
			valid: false,
		};
	let sensitive = false;
	if (u.username || u.password) {
		sensitive = true;
		u.username = u.username ? "•••" : "";
		u.password = u.password ? "•••" : "";
	}
	for (const k of [...u.searchParams.keys()]) {
		if (SECRET_PARAM.test(k) || (u.searchParams.get(k) ?? "").length >= 20) {
			u.searchParams.set(k, "•••");
			sensitive = true;
		}
	}
	const segs = u.pathname.split("/").map((s) => {
		if (/^[A-Za-z0-9_-]{20,}$/.test(s) && !/^evm$/.test(s)) {
			sensitive = true;
			return "•••";
		}
		return s;
	});
	u.pathname = segs.join("/");
	return { display: decodeURI(u.toString()), sensitive, valid: true };
}

export interface ProbeOptions {
	readonly signal?: AbortSignal;
	readonly onCheck?: (check: ProbeCheck) => void;
	/** Delay between requests (ms). */
	readonly pacingMs?: number;
	readonly fetch?: typeof fetch;
	/** Network the user expects this endpoint to serve (for mismatch flags). */
	readonly expectedNetwork?: Network;
}

function rateLimited(ex: RpcExchange): boolean {
	return (
		(ex.failure?.kind === "http" && ex.failure.status === 429) ||
		(ex.failure?.kind === "rpc" &&
			(ex.failure.code === -32005 || /rate/i.test(ex.failure.message)))
	);
}

function explainFailure(ex: RpcExchange): string {
	const f = ex.failure;
	if (!f) return "";
	if (f.kind === "rpc") return `error ${f.code}: ${f.message}`;
	if (f.kind === "http") return `HTTP ${f.status}`;
	if (f.kind === "timeout") return `timed out after ${f.ms / 1000}s`;
	if (f.kind === "network") return `request failed (${f.message})`;
	return "malformed response";
}

export async function probeEndpoint(
	url: string,
	options: ProbeOptions = {},
): Promise<ProbeResult> {
	const startedAt = Date.now();
	const { display, sensitive } = redactUrl(url);
	const checks: ProbeCheck[] = [];
	const pacing = options.pacingMs ?? 250;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const call = async (method: string, params: unknown[] = []) => {
		if (options.signal?.aborted)
			throw new DOMException("aborted", "AbortError");
		const ex = await rpcCall(url, method, params, {
			signal: options.signal,
			fetch: options.fetch,
			timeoutMs: 12_000,
		});
		await sleep(pacing);
		return ex;
	};
	const add = (c: ProbeCheck) => {
		checks.push(c);
		options.onCheck?.(c);
	};
	const finish = (
		aborted: string | null,
		chainId: number | null,
	): ProbeResult => ({
		displayUrl: display,
		sensitive,
		startedAt,
		finishedAt: Date.now(),
		chainId,
		network: chainId !== null ? networkForChainId(chainId) : null,
		checks,
		aborted,
	});

	// 1. Chain ID (also detects CORS/unreachable before anything else).
	const cid = await call("eth_chainId");
	if (cid.failure) {
		const cors = cid.failure.kind === "network";
		add({
			id: "chainId",
			title: "Chain ID",
			description: "eth_chainId — the first request, also a reachability test.",
			status: "inconclusive",
			detail: cors
				? "The browser could not complete the request. The endpoint most likely doesn't send CORS headers for this origin (browser-only probing needs Access-Control-Allow-Origin), or it is unreachable. Try it from a server or with a provider that allows browser access."
				: explainFailure(cid),
			exchanges: [cid],
		});
		return finish(
			cors
				? "Endpoint unreachable from the browser (CORS or network). Remaining checks skipped."
				: `eth_chainId failed: ${explainFailure(cid)}. Remaining checks skipped.`,
			null,
		);
	}
	const chainId = Number(hexToBigInt(cid.result) ?? -1n);
	const network = networkForChainId(chainId);
	add({
		id: "chainId",
		title: "Chain ID",
		description: "eth_chainId — identifies which network the endpoint serves.",
		status: "supported",
		value: `${chainId}${network ? ` (HyperEVM ${network})` : ""}`,
		detail: network
			? `Serves HyperEVM ${network}.`
			: "Not a HyperEVM chain (999 mainnet / 998 testnet). HyperEVM-specific checks will fail.",
		flag: !network
			? { kind: "not-hyperevm", message: `Chain ${chainId} is not HyperEVM.` }
			: options.expectedNetwork && options.expectedNetwork !== network
				? {
						kind: "network-mismatch",
						message: `This endpoint serves ${network}, but ${options.expectedNetwork} is selected. Results are labelled ${network}.`,
					}
				: undefined,
		exchanges: [cid],
	});

	// 2. Client version.
	const cv = await call("web3_clientVersion");
	add({
		id: "clientVersion",
		title: "Client version",
		description: "web3_clientVersion",
		status: cv.failure ? "unsupported" : "supported",
		value: typeof cv.result === "string" ? cv.result : undefined,
		detail: cv.failure ? explainFailure(cv) : String(cv.result),
		exchanges: [cv],
	});

	// 3. Head block and freshness.
	const bn = await call("eth_blockNumber");
	const head = hexToBigInt(bn.result);
	let headTs: number | null = null;
	const hb =
		head !== null
			? await call("eth_getBlockByNumber", ["latest", false])
			: null;
	if (hb && !hb.failure && hb.result && typeof hb.result === "object")
		headTs = Number(
			hexToBigInt((hb.result as { timestamp: string }).timestamp) ?? 0n,
		);
	const lag = headTs !== null ? Math.round(Date.now() / 1000 - headTs) : null;
	add({
		id: "head",
		title: "Latest block",
		description: "eth_blockNumber + eth_getBlockByNumber(latest)",
		status: head !== null ? "supported" : "unsupported",
		value: head !== null ? head.toString() : undefined,
		detail:
			head === null
				? explainFailure(bn)
				: lag !== null
					? `Head ${head} produced ${lag}s ago${lag > 30 ? " — the endpoint may be lagging." : "."}`
					: `Head ${head}.`,
		exchanges: hb ? [bn, hb] : [bn],
	});
	if (head === null)
		return finish("No block height; historical checks need one.", chainId);

	// 4. Historical state: nonce oracle.
	const nonceExchanges: RpcExchange[] = [];
	let oracle: { from: string; nonce: bigint; block: bigint } | null = null;
	for (let k = 0n; k < 6n && !oracle; k++) {
		const b = head - 1000n - k;
		const blk = await call("eth_getBlockByNumber", [toHexQuantity(b), true]);
		nonceExchanges.push(blk);
		const txs =
			(
				blk.result as {
					transactions?: { from: string; nonce: string }[];
				} | null
			)?.transactions ?? [];
		const tx = txs.find((t) => typeof t === "object" && t.from && t.nonce);
		if (tx)
			oracle = { from: tx.from, nonce: hexToBigInt(tx.nonce) ?? 0n, block: b };
	}
	let historicalFlagged = false;
	if (!oracle) {
		add({
			id: "historicalNonce",
			title: "Historical state (nonce oracle)",
			description:
				"eth_getTransactionCount at a past block, checked against a transaction known to be in that block.",
			status: "inconclusive",
			detail: "No transaction found in the six blocks tried ~1000 blocks back.",
			exchanges: nonceExchanges,
		});
	} else {
		const past = await call("eth_getTransactionCount", [
			oracle.from,
			toHexQuantity(oracle.block - 1n),
		]);
		const latest = await call("eth_getTransactionCount", [
			oracle.from,
			"latest",
		]);
		nonceExchanges.push(past, latest);
		const pv = hexToBigInt(past.result);
		const lv = hexToBigInt(latest.result);
		if (past.failure) {
			add({
				id: "historicalNonce",
				title: "Historical state (nonce oracle)",
				description: `Nonce of ${oracle.from} at block ${oracle.block - 1n}; its transaction in block ${oracle.block} has nonce ${oracle.nonce}.`,
				status: rateLimited(past) ? "inconclusive" : "unsupported",
				detail: `${explainFailure(past)} — the endpoint refuses historical state (an honest answer).`,
				exchanges: nonceExchanges,
			});
		} else if (pv === oracle.nonce) {
			add({
				id: "historicalNonce",
				title: "Historical state (nonce oracle)",
				description: `Nonce of ${oracle.from} at block ${oracle.block - 1n}; its transaction in block ${oracle.block} has nonce ${oracle.nonce}.`,
				status: "supported",
				value: `${pv} at block ${oracle.block - 1n}, ${lv ?? "?"} now`,
				detail:
					"Returned exactly the nonce the account had at that block: real historical state.",
				exchanges: nonceExchanges,
			});
		} else {
			historicalFlagged = pv !== null && lv !== null && pv === lv;
			add({
				id: "historicalNonce",
				title: "Historical state (nonce oracle)",
				description: `Nonce of ${oracle.from} at block ${oracle.block - 1n}; its transaction in block ${oracle.block} has nonce ${oracle.nonce}.`,
				status: "unsupported",
				value: `${pv ?? "?"} (expected ${oracle.nonce})`,
				detail: historicalFlagged
					? `Returned ${pv}, the account's current nonce, instead of ${oracle.nonce}. The endpoint answers historical queries with latest state without an error.`
					: `Returned ${pv}, expected ${oracle.nonce}.`,
				flag: historicalFlagged
					? {
							kind: "latest-for-historical",
							message:
								"Historical eth_getTransactionCount silently returns the latest value.",
						}
					: undefined,
				exchanges: nonceExchanges,
			});
		}
	}

	// 5. Historical code.
	const control = network ? CODE_CONTROLS[network] : null;
	if (control) {
		const early = await call("eth_getCode", [
			control,
			toHexQuantity(EARLY_BLOCK),
		]);
		const now = await call("eth_getCode", [control, "latest"]);
		const earlyCode = typeof early.result === "string" ? early.result : null;
		const nowCode = typeof now.result === "string" ? now.result : null;
		const base = {
			id: "historicalCode",
			title: "Historical eth_getCode",
			description: `Code of USDC (${control}) at block ${EARLY_BLOCK}, long before it was deployed, vs latest.`,
			exchanges: [early, now],
		};
		if (early.failure) {
			add({
				...base,
				status: rateLimited(early) ? "inconclusive" : "unsupported",
				detail: `${explainFailure(early)} — historical code is refused (an honest answer).`,
			});
		} else if (earlyCode === "0x" && nowCode && nowCode.length > 2) {
			add({
				...base,
				status: "supported",
				value: "empty at block 1000, code now",
				detail: "No code before deployment, code now: real historical state.",
			});
		} else if (earlyCode && earlyCode === nowCode) {
			add({
				...base,
				status: "unsupported",
				value: `${(earlyCode.length - 2) / 2} bytes at block ${EARLY_BLOCK}`,
				detail:
					"Returned the contract's current bytecode for a block before it existed.",
				flag: {
					kind: "latest-for-historical",
					message: "Historical eth_getCode silently returns the latest code.",
				},
			});
			historicalFlagged = true;
		} else {
			add({
				...base,
				status: "inconclusive",
				detail: "Unexpected combination of results.",
			});
		}
	}

	// 6. Historical eth_call.
	if (control) {
		const at = oracle ? oracle.block - 1n : head - 1000n;
		const past = await call("eth_call", [
			{ to: control, data: TOTAL_SUPPLY },
			toHexQuantity(at),
		]);
		const now = await call("eth_call", [
			{ to: control, data: TOTAL_SUPPLY },
			"latest",
		]);
		const base = {
			id: "historicalCall",
			title: "Historical eth_call",
			description: `USDC totalSupply() at block ${at} vs latest.`,
			exchanges: [past, now],
		};
		if (past.failure)
			add({
				...base,
				status: rateLimited(past) ? "inconclusive" : "unsupported",
				detail: `${explainFailure(past)} — historical calls are refused.`,
			});
		else if (past.result !== now.result)
			add({
				...base,
				status: "supported",
				value: "differs from latest",
				detail:
					"Supply at the past block differs from now: the call ran against historical state.",
			});
		else
			add({
				...base,
				status: historicalFlagged ? "unsupported" : "inconclusive",
				value: "same as latest",
				detail: historicalFlagged
					? "Same value as latest, consistent with the endpoint answering every historical query with latest state."
					: "Same as latest — supply may simply not have changed.",
				flag: historicalFlagged
					? {
							kind: "latest-for-historical",
							message:
								"Historical eth_call matches latest while other controls prove state is not historical.",
						}
					: undefined,
			});
	}

	// 7. HyperEVM-specific and misc methods.
	const simple: [string, string, unknown[], string][] = [
		[
			"bigBlockGasPrice",
			"eth_bigBlockGasPrice",
			[],
			"Base fee for the next big block (HyperEVM).",
		],
		[
			"usingBigBlocks",
			"eth_usingBigBlocks",
			[COREWRITER],
			"Whether an address targets big blocks (HyperEVM).",
		],
		[
			"systemTxs",
			"eth_getSystemTxsByBlockNumber",
			[toHexQuantity(head - 5n)],
			"System transactions originating from HyperCore (HyperEVM).",
		],
		[
			"blockReceipts",
			"eth_getBlockReceipts",
			[toHexQuantity(head - 5n)],
			"All receipts of a block in one call.",
		],
		["feeHistory", "eth_feeHistory", ["0x4", "latest", []], "Fee history."],
		["syncing", "eth_syncing", [], "Sync status."],
	];
	for (const [id, method, params, description] of simple) {
		const ex = await call(method, params);
		add({
			id,
			title: method,
			description,
			status: ex.failure
				? rateLimited(ex)
					? "inconclusive"
					: "unsupported"
				: "supported",
			value: ex.failure
				? rateLimited(ex)
					? "rate limited"
					: undefined
				: summarize(ex.result),
			detail: ex.failure
				? rateLimited(ex)
					? `${explainFailure(ex)} — rate limited, so support is unknown. Wait a minute and re-run.`
					: explainFailure(ex)
				: "Responded.",
			exchanges: [ex],
		});
	}

	// 8. Batch requests.
	const batch = await rpcBatch(
		url,
		[
			["eth_chainId", []],
			["eth_blockNumber", []],
		],
		options,
	);
	add({
		id: "batch",
		title: "JSON-RPC batch",
		description: "Two calls in one HTTP request.",
		status: batch.ok
			? "supported"
			: batch.limited
				? "inconclusive"
				: "unsupported",
		value: batch.limited ? "rate limited" : undefined,
		detail: batch.ok ? "Returned an array of results." : batch.detail,
		exchanges: [batch.exchange],
	});

	// 9. eth_getLogs range limit — last: large ranges are expensive and can
	// exhaust the rate limit, which then only truncates this check.
	const ranges = [1n, 50n, 51n, 500n, 1000n, 5000n];
	const logsEx: RpcExchange[] = [];
	const accepted: bigint[] = [];
	const rejected: bigint[] = [];
	let limitedAt: bigint | null = null;
	for (const r of ranges) {
		const to = head - 10n;
		const from = to - r + 1n;
		const ex = await call("eth_getLogs", [
			{
				fromBlock: toHexQuantity(from),
				toBlock: toHexQuantity(to),
				address: COREWRITER,
			},
		]);
		logsEx.push(ex);
		if (ex.failure) {
			if (rateLimited(ex)) {
				limitedAt = r;
				break;
			}
			rejected.push(r);
		} else accepted.push(r);
	}
	const maxOk: bigint | null = accepted.at(-1) ?? null;
	const doc = BigInt(DEFAULT_RPC_LIMITS.getLogsMaxBlocks);
	add({
		id: "getLogs",
		title: "eth_getLogs range limit",
		description: `CoreWriter logs over ranges of ${ranges.join(", ")} blocks.`,
		status: accepted.length
			? "supported"
			: limitedAt !== null
				? "inconclusive"
				: "unsupported",
		value:
			maxOk !== null
				? `≥ ${maxOk} blocks${rejected.length ? `, rejects ${rejected[0]}` : limitedAt !== null ? `; rate limited at ${limitedAt}` : ""}`
				: limitedAt !== null
					? "rate limited"
					: undefined,
		detail: accepted.length
			? `Accepted: ${accepted.join(", ")} blocks. ${rejected.length ? `Rejected: ${rejected.join(", ")}.` : limitedAt !== null ? `Rate limited before testing ${limitedAt} blocks, so the upper bound is unknown.` : "No tested range was rejected."}`
			: limitedAt !== null
				? "Rate limited before any range could be tested."
				: `All ranges rejected: ${explainFailure(logsEx[0] as RpcExchange)}`,
		flag:
			maxOk !== null && network && maxOk > doc
				? {
						kind: "limit-differs",
						message: `Accepts ranges above the documented ${doc}-block limit of the default RPC.`,
					}
				: undefined,
		exchanges: logsEx,
	});

	return finish(null, chainId);
}

function summarize(v: unknown): string {
	if (v === null) return "null";
	if (typeof v === "string") return v.length > 42 ? `${v.slice(0, 42)}…` : v;
	if (typeof v === "boolean") return String(v);
	if (Array.isArray(v)) return `${v.length} item(s)`;
	return "object";
}

async function rpcBatch(
	url: string,
	calls: [string, unknown[]][],
	options: ProbeOptions,
): Promise<{
	ok: boolean;
	limited?: boolean;
	detail: string;
	exchange: RpcExchange;
}> {
	const request = calls.map(([method, params], i) => ({
		jsonrpc: "2.0" as const,
		id: 1000 + i,
		method,
		params,
	}));
	const startedAt = Date.now();
	const f = options.fetch ?? fetch;
	try {
		const res = await f(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: options.signal,
		});
		const text = await res.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {
			// keep text
		}
		const ok = Array.isArray(body) && body.length === calls.length;
		const errObj = (Array.isArray(body) ? body[0] : body) as {
			error?: { code?: number; message?: string };
		} | null;
		const limited =
			res.status === 429 ||
			errObj?.error?.code === -32005 ||
			/rate/i.test(errObj?.error?.message ?? "");
		return {
			ok,
			limited: !ok && limited,
			detail: ok
				? ""
				: limited
					? "Rate limited, so batch support is unknown. Wait a minute and re-run."
					: `Response was ${Array.isArray(body) ? `an array of ${body.length}` : typeof body === "object" ? "a single object" : "not JSON"} (HTTP ${res.status}).`,
			exchange: {
				request: request[0] as never,
				response: body,
				result: body,
				failure: ok ? null : { kind: "malformed", body: text.slice(0, 500) },
				durationMs: Date.now() - startedAt,
				startedAt,
			},
		};
	} catch (e) {
		return {
			ok: false,
			detail: `Request failed: ${(e as Error).message}`,
			exchange: {
				request: request[0] as never,
				response: undefined,
				result: undefined,
				failure: { kind: "network", message: (e as Error).message },
				durationMs: Date.now() - startedAt,
				startedAt,
			},
		};
	}
}
