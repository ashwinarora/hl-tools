import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	EXPLORER_PAGE_CAP,
	ExplorerAllowanceError,
	explorerListMayBeCut,
	explorerTxDetails,
	explorerUserDetails,
	InfoRequestError,
} from "../src/index.ts";

/** Answers recorded from the testnet explorer on 2026-10-11 ("allowance-spent" on 2026-10-12). */
const RECORDED = JSON.parse(
	readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"fixtures",
			"explorer",
			"testnet-txdetails.json",
		),
		"utf8",
	),
) as { name: string; hash: string; status: number; body: unknown }[];
const recorded = (name: string) => {
	const r = RECORDED.find((x) => x.name === name);
	if (!r) throw new Error(`no recorded answer "${name}"`);
	return r;
};

/** Answers to `userDetails` recorded from the testnet explorer on 2026-10-13. */
const LISTS = (
	JSON.parse(
		readFileSync(
			join(
				dirname(fileURLToPath(import.meta.url)),
				"..",
				"fixtures",
				"explorer",
				"testnet-userdetails.json",
			),
			"utf8",
		),
	) as {
		answers: {
			name: string;
			user: string;
			status: number;
			returned: number;
			body: unknown;
		}[];
	}
).answers;
const list = (name: string) => {
	const r = LISTS.find((x) => x.name === name);
	if (!r) throw new Error(`no recorded list "${name}"`);
	return r;
};

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
	it("says a list may be cut at either length the explorer was seen to stop at, and beyond", () => {
		// 101 a week before 300: the note must not vanish if the cap moves back
		expect(explorerListMayBeCut(101)).toBe(true);
		expect(explorerListMayBeCut(EXPLORER_PAGE_CAP)).toBe(true);
		expect(explorerListMayBeCut(EXPLORER_PAGE_CAP + 1)).toBe(true);
		for (const n of [0, 39, 100, 102, 299])
			expect(explorerListMayBeCut(n)).toBe(false);
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
	it("reads the recorded answer for a busy account: its newest transactions, each with the action as it was sent", async () => {
		const rec = list("busy-account");
		// the explorer answered with exactly as many as it ever returns
		expect(rec.returned).toBe(EXPLORER_PAGE_CAP);
		const r = await explorerUserDetails("testnet", rec.user, {
			fetch: fetchWith(rec.status, rec.body),
		});
		const { txs } = r.data;
		expect(txs.length).toBeGreaterThan(5);
		// newest first, all of them this account's, each with its transaction id
		expect(txs.map((t) => t.time)).toEqual(
			[...txs.map((t) => t.time)].sort((a, b) => b - a),
		);
		expect(txs.every((t) => t.user === rec.user)).toBe(true);
		expect(txs.every((t) => /^0x[0-9a-f]{64}$/.test(t.hash))).toBe(true);
		// a user-signed action carries its own number, which is what ties it to a proposal
		const move = txs.find((t) => t.action.type === "usdClassTransfer");
		expect(move?.action).toMatchObject({ amount: "3", toPerp: true });
		expect(typeof move?.action.nonce).toBe("number");
		// a vault action carries none
		const vault = txs.find((t) => t.action.type === "vaultTransfer");
		expect(vault?.action).not.toHaveProperty("nonce");
		// an attempt Hyperliquid refused is listed too, with its reason
		const refusedOne = txs.find((t) => t.error !== null);
		expect(refusedOne?.error).toBe(
			"Cannot disable unified account with open positions, open orders, or active TWAP orders",
		);
		// what an API wallet did for the account is in the same list
		expect(txs.some((t) => t.action.type === "order")).toBe(true);
	});
	it("reads the recorded answer for an account that has done nothing as an empty list", async () => {
		const rec = list("empty-account");
		const r = await explorerUserDetails("testnet", rec.user, {
			fetch: fetchWith(rec.status, rec.body),
		});
		expect(r.data).toEqual({ txs: [], truncated: false });
	});
	it('a used-up allowance is an error, never "no transactions"', async () => {
		// the refusal as the explorer words it (recorded for txDetails)
		const refusal = recorded("allowance-spent");
		const e = await explorerUserDetails("testnet", USER, {
			fetch: fetchWith(refusal.status, refusal.body),
		}).catch((x) => x);
		expect(e).toBeInstanceOf(ExplorerAllowanceError);
		expect((e as Error).message).toBe(
			"More than 100 archived blocks queried in one day",
		);
		// any other error answer is not that
		const other = await explorerUserDetails("testnet", USER, {
			fetch: fetchWith(200, { type: "error", message: "something else" }),
		}).catch((x) => x);
		expect(other).not.toBeInstanceOf(ExplorerAllowanceError);
		expect((other as Error).message).toMatch(/no txs/);
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
		// an answer that is no object at all is no list either
		await expect(
			explorerUserDetails("testnet", USER, { fetch: fetchWith(200, "null") }),
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

describe("explorerTxDetails", () => {
	it("finds a transaction: the multi-sig account and the inner action as signed", async () => {
		const rec = recorded("found");
		const capture: { body?: string; url?: string } = {};
		const r = await explorerTxDetails(
			"testnet",
			rec.hash.toUpperCase().replace("0X", "0x"),
			{ fetch: fetchWith(rec.status, rec.body, capture), now: () => 42 },
		);
		expect(capture.url).toBe("https://rpc.hyperliquid-testnet.xyz/explorer");
		expect(JSON.parse(capture.body ?? "")).toEqual({
			type: "txDetails",
			hash: rec.hash,
		});
		expect(r.observedAt).toBe(42);
		expect(r.source).toContain("txDetails");
		expect(r.data).toEqual({
			found: true,
			tx: {
				time: 1791400180792,
				user: "0xf8365a35694f401a554e4ffa51b5afe3b203d148",
				action: {
					type: "usdSend",
					signatureChainId: "0x66eee",
					hyperliquidChain: "Testnet",
					destination: "0x5e7c3420160987d04db5e8ed6d5bc14f61237216",
					amount: "110",
					time: 1791400180224,
				},
				block: 723825086,
				hash: rec.hash,
				error: null,
			},
		});
		// key order is the signed order: a comparison with a proposal's action can be exact
		if (r.data.found)
			expect(Object.keys(r.data.tx.action)).toEqual([
				"type",
				"signatureChainId",
				"hyperliquidChain",
				"destination",
				"amount",
				"time",
			]);
	});
	it("finds a rejected attempt too, with the chain's error", async () => {
		const rec = recorded("failed");
		const r = await explorerTxDetails("testnet", rec.hash, {
			fetch: fetchWith(rec.status, rec.body),
		});
		expect(r.data).toMatchObject({
			found: true,
			tx: {
				action: { type: "convertToMultiSigUser" },
				error: "Invalid multi-sig threshold",
			},
		});
	});
	it("an unknown hash is an answer, in the explorer's words", async () => {
		for (const [name, reason] of [
			["unknown-block", "invalid block height: 0"],
			["unknown-in-block", "Unexpected error (code=10014)"],
		] as const) {
			const rec = recorded(name);
			const r = await explorerTxDetails("testnet", rec.hash, {
				fetch: fetchWith(rec.status, rec.body),
			});
			expect(r.data).toEqual({ found: false, reason });
		}
		const silent = await explorerTxDetails("mainnet", recorded("found").hash, {
			fetch: fetchWith(200, { type: "error" }),
		});
		expect(silent.data).toEqual({
			found: false,
			reason: "The explorer does not know this hash.",
		});
		expect(silent.source).toContain("https://rpc.hyperliquid.xyz/explorer");
	});
	it('a used-up allowance is an error, never "not found"', async () => {
		// answered to every look-up once the day's allowance is spent: it says
		// nothing about the hash
		const rec = recorded("allowance-spent");
		const asked = explorerTxDetails("testnet", rec.hash, {
			fetch: fetchWith(rec.status, rec.body),
		});
		await expect(asked).rejects.toBeInstanceOf(ExplorerAllowanceError);
		await expect(asked).rejects.toThrow(
			"More than 100 archived blocks queried in one day",
		);
	});
	it("a malformed hash is never sent; the explorer's own 422 reads the same way", async () => {
		const rec = recorded("malformed");
		expect(rec.status).toBe(422);
		let asked = 0;
		const counting = (async () => {
			asked++;
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		for (const hash of [
			rec.hash,
			"",
			"0x",
			`0x${"g".repeat(64)}`,
			`0x${"a".repeat(40)}`,
		]) {
			const r = await explorerTxDetails("testnet", hash, { fetch: counting });
			expect(r.data).toEqual({
				found: false,
				reason: "Not a transaction hash.",
			});
		}
		expect(asked).toBe(0);
		const r = await explorerTxDetails("testnet", recorded("found").hash, {
			fetch: fetchWith(rec.status, rec.body),
		});
		expect(r.data).toEqual({
			found: false,
			reason: "The explorer did not accept the hash.",
		});
	});
	it("never passes off an answer about another transaction, or a shapeless one", async () => {
		const rec = recorded("found");
		const other = `0x${"1".repeat(64)}`;
		await expect(
			explorerTxDetails("testnet", other, { fetch: fetchWith(200, rec.body) }),
		).rejects.toThrow(/another transaction/);
		for (const body of [
			{ type: "txDetails" },
			{ type: "txDetails", tx: 5 },
			{ tx: {} },
			null,
			[],
		])
			await expect(
				explorerTxDetails("testnet", other, { fetch: fetchWith(200, body) }),
			).rejects.toThrow(/no transaction/);
		// missing fields are read the way userDetails reads them
		const bare = await explorerTxDetails("testnet", other, {
			fetch: fetchWith(200, { type: "txDetails", tx: { hash: other } }),
		});
		expect(bare.data).toMatchObject({
			found: true,
			tx: { user: "", action: { type: "unknown" }, error: null },
		});
	});
	it("maps HTTP errors, 429 and non-JSON to InfoRequestError; network failures carry no status", async () => {
		const hash = recorded("found").hash;
		await expect(
			explorerTxDetails("testnet", hash, { fetch: fetchWith(500, "boom") }),
		).rejects.toMatchObject({ name: "InfoRequestError", status: 500 });
		await expect(
			explorerTxDetails("testnet", hash, {
				fetch: fetchWith(429, "slow down"),
			}),
		).rejects.toThrow(/rate limit/);
		await expect(
			explorerTxDetails("testnet", hash, { fetch: fetchWith(200, "<html>") }),
		).rejects.toThrow(/non-JSON/);
		const failing = (async () => {
			throw new TypeError("Failed to fetch");
		}) as typeof fetch;
		await expect(
			explorerTxDetails("testnet", hash, { fetch: failing }),
		).rejects.toMatchObject({ status: null });
		const capture: { signal?: AbortSignal | null } = {};
		const ctrl = new AbortController();
		await explorerTxDetails("testnet", hash, {
			fetch: fetchWith(200, { type: "error", message: "x" }, capture),
			signal: ctrl.signal,
		});
		expect(capture.signal).toBe(ctrl.signal);
	});
});

describe("explorerTxDetails default fetch", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("uses the global fetch and clock when none are injected", async () => {
		const rec = recorded("found");
		vi.stubGlobal("fetch", fetchWith(rec.status, rec.body));
		const before = Date.now();
		const r = await explorerTxDetails("testnet", rec.hash);
		expect(r.data.found).toBe(true);
		expect(r.observedAt).toBeGreaterThanOrEqual(before);
		const bad = await explorerTxDetails("testnet", "nope");
		expect(bad.observedAt).toBeGreaterThanOrEqual(before);
	});
});
