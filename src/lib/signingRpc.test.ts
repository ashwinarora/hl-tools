import { describe, expect, it } from "vitest";
import {
	answerSigningRpc,
	REFUSES_TRANSACTIONS,
	SIGNING_RPC_CHAIN_ID,
	SIGNING_RPC_PAGE,
	signingRpcResponse,
} from "./signingRpc";

const NOW = Date.UTC(2026, 9, 13, 12);
const ask = (method: string, params: unknown[] = [], id: number | string = 1) =>
	answerSigningRpc({ jsonrpc: "2.0", id, method, params }, NOW) as {
		id: unknown;
		result?: unknown;
		error?: { code: number; message: string };
	};

describe("the stand-in behind the signing network", () => {
	it("says it is chain 1337, in the two ways a wallet asks", () => {
		expect(SIGNING_RPC_CHAIN_ID).toBe(1337);
		expect(ask("eth_chainId")).toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: "0x539",
		});
		expect(ask("net_version", [], "a").result).toBe("1337");
		expect(ask("net_version", [], "a").id).toBe("a");
	});

	it("looks like a network that is alive and empty", () => {
		const latest = ask("eth_blockNumber").result as string;
		expect(latest).toMatch(/^0x[0-9a-f]+$/);
		const block = ask("eth_getBlockByNumber", ["latest", false]).result as {
			number: string;
			timestamp: string;
			transactions: unknown[];
		};
		expect(block.number).toBe(latest);
		expect(block.transactions).toEqual([]);
		// a block every 12 seconds: the number moves with the clock
		const later = answerSigningRpc(
			{ jsonrpc: "2.0", id: 1, method: "eth_blockNumber" },
			NOW + 24_000,
		) as { result: string };
		expect(
			Number.parseInt(later.result, 16) - Number.parseInt(latest, 16),
		).toBe(2);
		for (const method of [
			"eth_getBalance",
			"eth_getTransactionCount",
			"eth_gasPrice",
			"eth_maxPriorityFeePerGas",
		])
			expect(
				ask(method, ["0x00000000000000000000000000000000000000aa"]).result,
			).toBe("0x0");
		expect(ask("eth_getCode").result).toBe("0x");
		expect(ask("eth_call").result).toBe("0x");
		expect(ask("eth_estimateGas").result).toBe("0x5208");
		expect(ask("eth_getLogs").result).toEqual([]);
		expect(ask("eth_accounts").result).toEqual([]);
		expect(ask("eth_syncing").result).toBe(false);
		expect(ask("net_listening").result).toBe(true);
		expect(ask("eth_getTransactionReceipt").result).toBeNull();
		expect(ask("eth_getTransactionByHash").result).toBeNull();
		expect(ask("eth_getBlockByHash").result).toMatchObject({ gasUsed: "0x0" });
		expect(ask("web3_clientVersion").result).toBe("hl-tools-signing-network/1");
		expect(
			(ask("eth_feeHistory").result as { baseFeePerGas: string[] })
				.baseFeePerGas,
		).toEqual(["0x0", "0x0"]);
	});

	it("refuses every transaction, and says why", () => {
		for (const method of ["eth_sendRawTransaction", "eth_sendTransaction"]) {
			const a = ask(method, ["0x02f8"]);
			expect(a.result).toBeUndefined();
			expect(a.error).toEqual({ code: -32000, message: REFUSES_TRANSACTIONS });
		}
		expect(REFUSES_TRANSACTIONS).toContain("Nothing can be sent on it.");
	});

	it("answers a batch in order, and anything else as an error", () => {
		const batch = answerSigningRpc(
			[
				{ jsonrpc: "2.0", id: 1, method: "eth_chainId" },
				{ jsonrpc: "2.0", id: 2, method: "debug_traceTransaction" },
				"nonsense",
			],
			NOW,
		) as { id: unknown; result?: unknown; error?: { code: number } }[];
		expect(batch.map((a) => a.id)).toEqual([1, 2, null]);
		expect(batch[0]?.result).toBe("0x539");
		expect(batch[1]?.error?.code).toBe(-32601);
		expect(batch[2]?.error?.code).toBe(-32600);
		for (const bad of [null, 5, "x", {}, { method: 7 }])
			expect(
				(answerSigningRpc(bad, NOW) as { error: { code: number } }).error.code,
			).toBe(-32600);
		// an id that is no string or number is not echoed back
		expect(
			(
				answerSigningRpc({ id: { a: 1 }, method: "eth_chainId" }, NOW) as {
					id: unknown;
				}
			).id,
		).toBeNull();
		// the clock is the machine's when none is given
		expect(
			(
				answerSigningRpc({ id: 1, method: "eth_blockNumber" }) as {
					result: string;
				}
			).result,
		).toMatch(/^0x/);
	});
});

describe("the signing network over HTTP", () => {
	const URL_ = "https://hltools.tech/rpc/1337";
	const post = (body: string) =>
		signingRpcResponse(new Request(URL_, { method: "POST", body }), NOW);

	it("answers a wallet's POST with JSON, open to any origin", async () => {
		const res = await post(
			JSON.stringify({ jsonrpc: "2.0", id: 7, method: "eth_chainId" }),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json");
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(await res.json()).toEqual({
			jsonrpc: "2.0",
			id: 7,
			result: "0x539",
		});
	});

	it("answers the browser's CORS question and a person's GET", async () => {
		const pre = await signingRpcResponse(
			new Request(URL_, { method: "OPTIONS" }),
		);
		expect(pre.status).toBe(204);
		expect(pre.headers.get("access-control-allow-methods")).toBe(
			"POST, OPTIONS",
		);
		const page = await signingRpcResponse(new Request(URL_));
		expect(page.headers.get("content-type")).toBe("text/plain; charset=utf-8");
		expect(await page.text()).toBe(SIGNING_RPC_PAGE);
	});

	it("takes a body that is not JSON, or far too large, as no request", async () => {
		const notJson = (await (await post("{nope")).json()) as {
			error: { code: number };
		};
		expect(notJson.error.code).toBe(-32600);
		const huge = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_chainId",
			pad: "x".repeat(100_001),
		});
		const big = (await (await post(huge)).json()) as {
			error: { code: number };
		};
		expect(big.error.code).toBe(-32600);
	});
});
