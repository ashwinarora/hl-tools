import { afterEach, describe, expect, it, vi } from "vitest";
import {
	EXPLORER_PAGE_CAP,
	explorerUserDetails,
	InfoRequestError,
} from "../src/index.ts";

const USER = "0xF8365A35694F401a554E4Ffa51b5AfE3B203d148";
const tx = (i: number, extra: Record<string, unknown> = {}) => ({
	time: 1_791_475_799_000 + i,
	user: USER.toLowerCase(),
	action: { type: i % 2 ? "order" : "cancel" },
	block: 725_000_000 + i,
	hash: `0x${i.toString(16).padStart(64, "0")}`,
	...extra,
});
const fetchWith = (
	status: number,
	body: unknown,
	capture?: { body?: string; url?: string; signal?: AbortSignal | null },
) =>
	(async (url: string | URL | Request, init?: RequestInit) => {
		if (capture) {
			capture.url = String(url);
			capture.body = String(init?.body);
			capture.signal = init?.signal ?? null;
		}
		return new Response(
			typeof body === "string" ? body : JSON.stringify(body),
			{ status },
		);
	}) as typeof fetch;

describe("explorerUserDetails", () => {
	it("posts userDetails with a lowercased user to the network's explorer API and returns newest-first", async () => {
		const capture: { body?: string; url?: string } = {};
		const r = await explorerUserDetails("testnet", USER, {
			fetch: fetchWith(
				200,
				{ txs: [tx(1), tx(3, { error: "Multi-sig required" }), tx(2)] },
				capture,
			),
			now: () => 42,
		});
		expect(capture.url).toBe("https://rpc.hyperliquid-testnet.xyz/explorer");
		expect(JSON.parse(capture.body ?? "")).toEqual({
			type: "userDetails",
			user: USER.toLowerCase(),
		});
		expect(r.network).toBe("testnet");
		expect(r.observedAt).toBe(42);
		expect(r.source).toContain("userDetails");
		expect(r.data.truncated).toBe(false);
		expect(r.data.txs.map((t) => t.time - 1_791_475_799_000)).toEqual([
			3, 2, 1,
		]);
		expect(r.data.txs[0]?.error).toBe("Multi-sig required");
		expect(r.data.txs[1]?.error).toBeNull();
		expect(r.data.txs[0]?.action.type).toBe("order");
	});
	it("mainnet uses the mainnet explorer URL", async () => {
		const capture: { url?: string } = {};
		await explorerUserDetails("mainnet", USER, {
			fetch: fetchWith(200, { txs: [] }, capture),
		});
		expect(capture.url).toBe("https://rpc.hyperliquid.xyz/explorer");
	});
	it("flags truncation at the page cap and tolerates malformed entries", async () => {
		const txs = Array.from({ length: EXPLORER_PAGE_CAP }, (_, i) => tx(i));
		const r = await explorerUserDetails("testnet", USER, {
			fetch: fetchWith(200, { txs: [...txs, null, 5, { time: "7" }] }),
		});
		expect(r.data.truncated).toBe(true);
		expect(r.data.txs.length).toBe(EXPLORER_PAGE_CAP + 1);
		const odd = r.data.txs.find((t) => t.hash === "");
		expect(odd).toMatchObject({
			time: 7,
			user: "",
			action: { type: "unknown" },
			error: null,
		});
	});
	it("maps HTTP errors, 429, non-JSON and missing txs to InfoRequestError with the status", async () => {
		await expect(
			explorerUserDetails("testnet", USER, { fetch: fetchWith(500, "boom") }),
		).rejects.toMatchObject({ name: "InfoRequestError", status: 500 });
		await expect(
			explorerUserDetails("testnet", USER, {
				fetch: fetchWith(429, "slow down"),
			}),
		).rejects.toThrow(/rate limit/);
		await expect(
			explorerUserDetails("testnet", USER, { fetch: fetchWith(200, "<html>") }),
		).rejects.toThrow(/non-JSON/);
		await expect(
			explorerUserDetails("testnet", USER, {
				fetch: fetchWith(200, { nope: 1 }),
			}),
		).rejects.toThrow(/no txs/);
	});
	it("network failures and aborts surface as InfoRequestError without a status", async () => {
		const failing = (async () => {
			throw new TypeError("Failed to fetch");
		}) as typeof fetch;
		const e = (await explorerUserDetails("testnet", USER, {
			fetch: failing,
		}).catch((x) => x)) as InfoRequestError;
		expect(e).toBeInstanceOf(InfoRequestError);
		expect(e.status).toBeNull();
		expect(e.message).toContain("Failed to fetch");
		const aborting = (async () => {
			const err = new Error("aborted");
			err.name = "AbortError";
			throw err;
		}) as typeof fetch;
		await expect(
			explorerUserDetails("testnet", USER, { fetch: aborting }),
		).rejects.toThrow("Stopped.");
	});
	it("passes the abort signal through to fetch", async () => {
		const capture: { signal?: AbortSignal | null } = {};
		const ctrl = new AbortController();
		await explorerUserDetails("testnet", USER, {
			fetch: fetchWith(200, { txs: [] }, capture),
			signal: ctrl.signal,
		});
		expect(capture.signal).toBe(ctrl.signal);
	});
});

describe("explorerUserDetails default fetch", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("uses the global fetch and clock when none are injected", async () => {
		vi.stubGlobal("fetch", fetchWith(200, { txs: [] }));
		const before = Date.now();
		const r = await explorerUserDetails("testnet", USER);
		expect(r.data).toEqual({ txs: [], truncated: false });
		expect(r.observedAt).toBeGreaterThanOrEqual(before);
	});
});
