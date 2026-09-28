import { describe, expect, it } from "vitest";
import { probeEndpoint, redactUrl } from "../src/index.ts";

describe("redactUrl", () => {
	it.each([
		[
			"https://rpc.hyperliquid.xyz/evm",
			"https://rpc.hyperliquid.xyz/evm",
			false,
		],
		[
			"https://eth.example.com/v2/aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
			"https://eth.example.com/v2/•••",
			true,
		],
		[
			"https://node.example.com/evm?apikey=abc",
			"https://node.example.com/evm?apikey=•••",
			true,
		],
		[
			"https://user:pass@node.example.com/",
			"https://•••:•••@node.example.com/",
			true,
		],
	])("%s", (input, display, sensitive) => {
		const r = redactUrl(input);
		expect(r.display).toBe(display);
		expect(r.sensitive).toBe(sensitive);
	});
	it("rejects non-http URLs", () => {
		expect(redactUrl("ws://x").valid).toBe(false);
		expect(redactUrl("not a url").valid).toBe(false);
	});
});

type Mode = "archive" | "latest";
function fakeRpc(mode: Mode, opts: { logsMax?: number } = {}): typeof fetch {
	const HEAD = 50_000n;
	const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;
	const handle = (method: string, params: unknown[]): unknown => {
		switch (method) {
			case "eth_chainId":
				return hex(999);
			case "web3_clientVersion":
				return "fake/1.0";
			case "eth_blockNumber":
				return hex(HEAD);
			case "eth_getBlockByNumber": {
				const tag = params[0] as string;
				const n = tag === "latest" ? HEAD : BigInt(tag);
				return {
					number: hex(n),
					timestamp: hex(Math.floor(Date.now() / 1000) - 1),
					transactions: params[1]
						? [
								{
									from: "0xaaaa000000000000000000000000000000000001",
									nonce: hex(7),
								},
							]
						: [],
				};
			}
			case "eth_getTransactionCount":
				return params[1] === "latest"
					? hex(12)
					: mode === "archive"
						? hex(7)
						: hex(12);
			case "eth_getCode":
				return params[1] === "latest" || mode === "latest" ? "0x6080" : "0x";
			case "eth_call":
				return params[1] === "latest" || mode === "latest"
					? hex(1_000_000)
					: hex(900_000);
			case "eth_getLogs": {
				const f = params[0] as { fromBlock: string; toBlock: string };
				const range = BigInt(f.toBlock) - BigInt(f.fromBlock) + 1n;
				if (range > BigInt(opts.logsMax ?? 50))
					throw { code: -32000, message: "query exceeds max block range" };
				return [];
			}
			case "eth_bigBlockGasPrice":
				return hex(100);
			case "eth_usingBigBlocks":
				return false;
			default:
				return null;
		}
	};
	return (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		const one = (r: { id: number; method: string; params: unknown[] }) => {
			try {
				return { jsonrpc: "2.0", id: r.id, result: handle(r.method, r.params) };
			} catch (e) {
				return { jsonrpc: "2.0", id: r.id, error: e };
			}
		};
		const out = Array.isArray(body) ? body.map(one) : one(body);
		return new Response(JSON.stringify(out), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

describe("probeEndpoint", () => {
	it("recognises an honest archive node", async () => {
		const r = await probeEndpoint("https://archive.example/evm", {
			fetch: fakeRpc("archive"),
			pacingMs: 0,
		});
		const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
		expect(r.network).toBe("mainnet");
		expect(by.historicalNonce?.status).toBe("supported");
		expect(by.historicalCode?.status).toBe("supported");
		expect(by.historicalCall?.status).toBe("supported");
		expect(by.getLogs?.value).toContain("≥ 50");
		expect(by.batch?.status).toBe("supported");
	});
	it("flags a node that answers historical queries with latest state", async () => {
		const r = await probeEndpoint("https://lying.example/evm", {
			fetch: fakeRpc("latest", { logsMax: 5000 }),
			pacingMs: 0,
		});
		const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
		expect(by.historicalNonce?.flag?.kind).toBe("latest-for-historical");
		expect(by.historicalCode?.flag?.kind).toBe("latest-for-historical");
		expect(by.historicalCall?.status).toBe("unsupported");
		expect(by.getLogs?.flag?.kind).toBe("limit-differs");
	});
	it("flags a network mismatch", async () => {
		const r = await probeEndpoint("https://archive.example/evm", {
			fetch: fakeRpc("archive"),
			pacingMs: 0,
			expectedNetwork: "testnet",
		});
		expect(r.checks[0]?.flag?.kind).toBe("network-mismatch");
	});
	it("reports rate limiting instead of silently dropping results (browser bug 2026-09-28)", async () => {
		const base = fakeRpc("archive", { logsMax: 5000 });
		let logsCalls = 0;
		const limited = (async (url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			if (
				!Array.isArray(body) &&
				(body.method === "eth_feeHistory" ||
					(body.method === "eth_getLogs" && ++logsCalls >= 5))
			) {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						id: body.id,
						error: { code: -32005, message: "rate limited" },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return base(url, init);
		}) as typeof fetch;
		const r = await probeEndpoint("https://busy.example/evm", {
			fetch: limited,
			pacingMs: 0,
		});
		const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
		expect(by.getLogs?.value).toBe("≥ 500 blocks; rate limited at 1000");
		expect(by.feeHistory?.status).toBe("inconclusive");
		expect(by.feeHistory?.value).toBe("rate limited");
	});
	it("aborts with a CORS explanation when the browser can't reach the endpoint", async () => {
		const failing = (async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;
		const r = await probeEndpoint("https://no-cors.example/evm", {
			fetch: failing,
			pacingMs: 0,
		});
		expect(r.aborted).toMatch(/CORS/);
		expect(r.checks).toHaveLength(1);
		expect(r.checks[0]?.detail).toMatch(/CORS/);
	});
});
