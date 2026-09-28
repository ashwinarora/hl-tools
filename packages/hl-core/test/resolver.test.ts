import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	assetSnippets,
	buildUniverse,
	compareAcrossNetworks,
	type Network,
	type RawMetadata,
	type ResolvedMatch,
	resolveAsset,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) =>
	JSON.parse(readFileSync(join(here, "..", "fixtures", p), "utf8"));

const meta = {
	mainnet: load("metadata/mainnet.json"),
	testnet: load("metadata/testnet.json"),
} as Record<
	Network,
	RawMetadata & { allMids: Record<string, string>; observedAt: number }
>;
const universes = {
	mainnet: buildUniverse("mainnet", meta.mainnet, meta.mainnet.observedAt),
	testnet: buildUniverse("testnet", meta.testnet, meta.testnet.observedAt),
};

const id = (m: ResolvedMatch) =>
	m.kind === "asset" ? m.asset.coin : `token:${m.token.index}`;

interface Case {
	network: Network;
	query: string;
	first?: string;
	firstOf?: string[];
	ambiguous?: boolean;
	includes?: string[];
	excludes?: string[];
	matches?: number;
	noteIncludes?: string;
	expect?: Record<string, unknown>;
}

describe("resolver fixtures", () => {
	const { cases } = load("resolver/cases.json") as { cases: Case[] };
	for (const c of cases) {
		it(`${c.network}: ${JSON.stringify(c.query)}`, () => {
			const r = resolveAsset(universes[c.network], c.query);
			const ids = r.matches.map(id);
			if (c.matches !== undefined) expect(ids).toHaveLength(c.matches);
			if (c.first) expect(ids[0]).toBe(c.first);
			if (c.firstOf) expect(c.firstOf).toContain(ids[0]);
			if (c.ambiguous !== undefined) expect(r.ambiguous).toBe(c.ambiguous);
			for (const inc of c.includes ?? []) expect(ids).toContain(inc);
			for (const exc of c.excludes ?? []) expect(ids).not.toContain(exc);
			if (c.noteIncludes) expect(r.notes.join(" ")).toContain(c.noteIncludes);
			if (c.expect) {
				const top = r.matches[0];
				expect(top?.kind).toBe("asset");
				if (top?.kind !== "asset") return;
				const a = top.asset;
				const view: Record<string, unknown> = {
					actionAssetId: a.actionAssetId,
					szDecimals: a.szDecimals,
					pxDecimals: a.pxDecimals,
					venue: a.venue.kind,
					base: a.base,
					quote: a.quote,
					isDelisted: a.isDelisted,
				};
				for (const [k, v] of Object.entries(c.expect))
					expect(view[k], k).toEqual(v);
			}
			// Every match is tagged with the network it came from.
			for (const m of r.matches) {
				expect(m.kind === "asset" ? m.asset.network : m.token.network).toBe(
					c.network,
				);
			}
		});
	}
});

describe("normalisation by explicit IDs", () => {
	it("keys spot pairs by `index`, not array position", () => {
		const shuffled = structuredClone(meta.mainnet);
		shuffled.spotMeta.universe.reverse();
		shuffled.spotMeta.tokens.reverse();
		const u = buildUniverse("mainnet", shuffled);
		expect(u.spotByIndex.get(107)?.base).toBe("HYPE");
		expect(u.spotByIndex.get(107)?.actionAssetId).toBe(10107);
		expect(u.tokensByIndex.get(150)?.name).toBe("HYPE");
	});

	it("refuses HIP-3 dexes whose metadata doesn't line up", () => {
		const broken = structuredClone(meta.mainnet);
		const [a, b] = [broken.allPerpMetas[1], broken.allPerpMetas[2]];
		if (!a || !b) throw new Error("fixture needs 3 dexes");
		broken.allPerpMetas[1] = b;
		broken.allPerpMetas[2] = a;
		const u = buildUniverse("mainnet", broken);
		expect(u.warnings.map((w) => w.code)).toContain("dex.prefix_mismatch");
		expect(u.byCoin.get("xyz:TSLA")).toBeUndefined();
	});

	it("gives mainnet and testnet HYPE different IDs", () => {
		const rows = compareAcrossNetworks(
			resolveAsset(universes.mainnet, "HYPE/USDC"),
			resolveAsset(universes.testnet, "HYPE/USDC"),
		);
		const row = rows.find((r) => r.label === "HYPE/USDC");
		expect(row?.mainnet && row.testnet).toBeTruthy();
		expect(row?.differences).toEqual(
			expect.arrayContaining([
				"coin",
				"action asset ID",
				"spot pair index",
				"base token index",
			]),
		);
	});
});

describe("snippets", () => {
	it("prices a valid post-only example order from the mid", () => {
		const btc = universes.mainnet.byCoin.get("BTC");
		if (!btc) throw new Error("no BTC");
		const s = assetSnippets(btc, "82921.5");
		const order = (
			s.order.action?.orders as { p: string; s: string; a: number }[]
		)[0];
		expect(order?.a).toBe(0);
		expect(order?.p).toBe("81263");
		expect(order?.s).toBe("0.00013");
		expect(s.wsSubscribe).toEqual({
			method: "subscribe",
			subscription: { type: "l2Book", coin: "BTC" },
		});
	});
	it("says so when there is no mid", () => {
		const btc = universes.mainnet.byCoin.get("BTC");
		if (!btc) throw new Error("no BTC");
		expect(assetSnippets(btc, null).order.action).toBeNull();
	});
});
