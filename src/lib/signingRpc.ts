/**
 * The stand-in behind the signing network.
 *
 * A wallet signs one of Hyperliquid's codes only while it is on a network
 * whose chain id is 1337, and it adds a network only if the link it is given
 * answers as that chain. Nothing is ever sent on this network: the wallet
 * only has to believe it is there while it signs. So the link answers the
 * few questions a wallet asks of any network (which chain, the latest block,
 * a balance of zero) with fixed answers, and refuses every transaction.
 *
 * Pure: a request body in, the answer out. It reads nothing and keeps
 * nothing, so whatever serves it has nothing to log either.
 */

export const SIGNING_RPC_CHAIN_ID = 1337;
const CHAIN_HEX = `0x${SIGNING_RPC_CHAIN_ID.toString(16)}`;
/** A new block every 12 seconds since this moment, so a wallet sees a network that is alive. */
const GENESIS_MS = Date.UTC(2026, 0, 1);
const BLOCK_MS = 12_000;
const ZERO_32 = `0x${"0".repeat(64)}`;

export const REFUSES_TRANSACTIONS =
	"This network exists only so that a wallet can sign for Hyperliquid. Nothing can be sent on it.";

interface RpcError {
	readonly code: number;
	readonly message: string;
}
type Answer = { readonly result: unknown } | { readonly error: RpcError };

const hex = (n: number) => `0x${n.toString(16)}`;

function block(now: number) {
	const number = Math.max(1, Math.floor((now - GENESIS_MS) / BLOCK_MS));
	return {
		number: hex(number),
		hash: `0x${number.toString(16).padStart(64, "0")}`,
		parentHash: `0x${(number - 1).toString(16).padStart(64, "0")}`,
		timestamp: hex(Math.floor((GENESIS_MS + number * BLOCK_MS) / 1000)),
		gasLimit: "0x1c9c380",
		gasUsed: "0x0",
		baseFeePerGas: "0x0",
		miner: "0x0000000000000000000000000000000000000000",
		transactions: [],
		uncles: [],
		difficulty: "0x0",
		totalDifficulty: "0x0",
		extraData: "0x",
		logsBloom: `0x${"0".repeat(512)}`,
		nonce: "0x0000000000000000",
		sha3Uncles: ZERO_32,
		size: "0x0",
		stateRoot: ZERO_32,
		transactionsRoot: ZERO_32,
		receiptsRoot: ZERO_32,
		mixHash: ZERO_32,
	};
}

function answer(method: string, now: number): Answer {
	switch (method) {
		case "eth_chainId":
			return { result: CHAIN_HEX };
		case "net_version":
			return { result: String(SIGNING_RPC_CHAIN_ID) };
		case "web3_clientVersion":
			return { result: "hl-tools-signing-network/1" };
		case "eth_blockNumber":
			return { result: block(now).number };
		case "eth_getBlockByNumber":
		case "eth_getBlockByHash":
			return { result: block(now) };
		// every account is empty and has done nothing
		case "eth_getBalance":
		case "eth_getTransactionCount":
		case "eth_gasPrice":
		case "eth_maxPriorityFeePerGas":
			return { result: "0x0" };
		case "eth_getCode":
		case "eth_call":
			return { result: "0x" };
		case "eth_estimateGas":
			return { result: "0x5208" };
		case "eth_feeHistory":
			return {
				result: {
					oldestBlock: block(now).number,
					baseFeePerGas: ["0x0", "0x0"],
					gasUsedRatio: [0],
					reward: [["0x0"]],
				},
			};
		case "eth_getLogs":
		case "eth_accounts":
			return { result: [] };
		case "net_listening":
			return { result: true };
		case "eth_syncing":
			return { result: false };
		case "eth_getTransactionByHash":
		case "eth_getTransactionReceipt":
			return { result: null };
		case "eth_sendRawTransaction":
		case "eth_sendTransaction":
			return { error: { code: -32000, message: REFUSES_TRANSACTIONS } };
		default:
			return {
				error: {
					code: -32601,
					message: `Method ${method} is not available on this network.`,
				},
			};
	}
}

function one(request: unknown, now: number): unknown {
	const q =
		request && typeof request === "object" && !Array.isArray(request)
			? (request as { id?: unknown; method?: unknown })
			: null;
	const id =
		q && (typeof q.id === "number" || typeof q.id === "string") ? q.id : null;
	if (!q || typeof q.method !== "string")
		return {
			jsonrpc: "2.0",
			id,
			error: { code: -32600, message: "Not a JSON-RPC request." },
		};
	return { jsonrpc: "2.0", id, ...answer(q.method, now) };
}

/** The answer to one JSON-RPC request body: an object, or an array for a batch. */
export function answerSigningRpc(
	body: unknown,
	now: number = Date.now(),
): unknown {
	return Array.isArray(body) ? body.map((q) => one(q, now)) : one(body, now);
}

/** Anyone's wallet may ask: the answers are the same for everybody. */
const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "content-type",
	"access-control-allow-methods": "POST, OPTIONS",
} as const;

/** A wallet's questions are a few hundred bytes; anything this large is not one. */
const MAX_BODY = 100_000;

/** What a person opening the link in a browser reads. */
export const SIGNING_RPC_PAGE =
	"The hl-tools signing network (chain 1337). Wallets post JSON-RPC here; nothing can be sent on it.\n";

/**
 * The whole HTTP exchange of the signing network, for whatever serves it (the
 * app's `/rpc/1337` route, `bun run rpc:1337`): JSON-RPC by POST, a line of
 * text on GET, the CORS answer on OPTIONS. Reads the body only; never logs.
 */
export async function signingRpcResponse(
	request: Request,
	now: number = Date.now(),
): Promise<Response> {
	if (request.method === "OPTIONS")
		return new Response(null, { status: 204, headers: CORS });
	if (request.method !== "POST")
		return new Response(SIGNING_RPC_PAGE, {
			headers: { "content-type": "text/plain; charset=utf-8", ...CORS },
		});
	let body: unknown = null;
	try {
		const text = await request.text();
		if (text.length <= MAX_BODY) body = JSON.parse(text);
	} catch {
		body = null;
	}
	return new Response(JSON.stringify(answerSigningRpc(body, now)), {
		headers: { "content-type": "application/json", ...CORS },
	});
}
