import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildUniverse,
	classifyQuery,
	IDENTIFIER_FAMILIES,
	identitySpellings,
	normalizeSettledOutcome,
	outcomeIdOfQuery,
	type RawMetadata,
	type RawSettledOutcome,
	relatedIdentities,
	resolveAsset,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) =>
	JSON.parse(readFileSync(join(here, "..", "fixtures", p), "utf8"));
const meta = load("metadata/mainnet.json") as RawMetadata & {
	observedAt: number;
};
const universe = buildUniverse("mainnet", meta, meta.observedAt);

describe("classifyQuery", () => {
	it("decodes the outcome spellings to the same parts", () => {
		for (const q of ["#83061", "+83061", "100083061"]) {
			const c = classifyQuery(q);
			expect(c.outcome, q).toEqual({ outcome: 8306, side: 1, encoding: 83061 });
			expect(c.derived.map((d) => d.value).join(" "), q).toContain("#83061");
			expect(outcomeIdOfQuery(q)).toBe(8306);
		}
		expect(classifyQuery("#83061").shape).toBe("outcome-coin");
		expect(classifyQuery("+83061").shape).toBe("outcome-token");
		expect(classifyQuery("100083061").shape).toBe("number");
	});
	it("rejects an outcome side other than 0 or 1", () => {
		expect(classifyQuery("#83062").outcome).toBeNull();
		expect(classifyQuery("#83062").explanation).toContain(
			"only 0 (Yes) and 1 (No)",
		);
		expect(outcomeIdOfQuery("100083062")).toBeNull();
	});
	it("derives the asset ID of a spot index", () => {
		const c = classifyQuery("@107");
		expect(c.shape).toBe("spot-index");
		expect(c.derived).toContainEqual({ label: "asset ID", value: "10107" });
	});
	it("explains why a small number is ambiguous", () => {
		const c = classifyQuery("150");
		expect(c.shape).toBe("number");
		expect(c.explanation).toContain("four separate index spaces");
		expect(c.derived.map((d) => d.label)).toEqual([
			"as asset ID",
			"as spot pair index",
			"as token index",
			"as outcome ID",
		]);
	});
	it("classifies the other shapes", () => {
		expect(classifyQuery("xyz:TSLA").shape).toBe("hip3-coin");
		expect(classifyQuery("HYPE/USDC").shape).toBe("pair-name");
		expect(classifyQuery("BTC-PERP").shape).toBe("symbol-suffix");
		expect(classifyQuery("BTC").shape).toBe("symbol");
		expect(classifyQuery("0x0d01dc56dcaaca66ad901c959b4011ec").shape).toBe(
			"token-id",
		);
		expect(
			classifyQuery("0x5555555555555555555555555555555555555555").shape,
		).toBe("evm-address");
		expect(classifyQuery("@abc").shape).toBe("malformed-prefix");
		expect(classifyQuery("  ").shape).toBe("empty");
		expect(classifyQuery("110001").derived[0]?.value).toContain("dex 1");
	});
	it("has a legend entry for every family a query can map to", () => {
		const families = new Set(IDENTIFIER_FAMILIES.map((f) => f.family));
		for (const q of [
			"@1",
			"#10",
			"+10",
			"5",
			"BTC",
			"BTC-PERP",
			"0x0d01dc56dcaaca66ad901c959b4011ec",
		]) {
			const f = classifyQuery(q).family;
			expect(f && families.has(f), q).toBe(true);
		}
	});
});

describe("identitySpellings", () => {
	const first = (q: string) => {
		const m = resolveAsset(universe, q).matches[0];
		if (!m) throw new Error(`no match for ${q}`);
		return m;
	};
	it("lists every spelling of a spot pair with where it is used", () => {
		const s = identitySpellings(first("@107"));
		const byLabel = Object.fromEntries(s.map((x) => [x.label, x]));
		expect(byLabel.coin?.value).toBe("@107");
		expect(byLabel.coin?.usedIn).toEqual(["info", "ws"]);
		expect(byLabel["asset ID"]?.value).toBe("10107");
		expect(byLabel["asset ID"]?.usedIn).toContain("exchange");
		expect(byLabel["display symbol"]?.value).toBe("HYPE/USDC");
		expect(byLabel["display symbol"]?.usedIn).toEqual(["frontend"]);
		expect(byLabel["base token index"]?.value).toBe("150");
		expect(byLabel["base token string"]?.value).toMatch(/^HYPE:0x/);
	});
	it("spells a perp and an outcome", () => {
		const perp = identitySpellings(first("BTC"));
		expect(perp.find((x) => x.label === "asset ID")?.value).toBe("0");
		const out = identitySpellings(first("#14720"));
		const labels = out.map((x) => x.label);
		expect(labels).toEqual(
			expect.arrayContaining([
				"coin",
				"token",
				"asset ID",
				"encoding",
				"outcome",
				"side",
			]),
		);
		expect(out.find((x) => x.label === "token")?.value).toBe("+14720");
		expect(out.find((x) => x.label === "asset ID")?.value).toBe("100014720");
	});
	it("spells a token", () => {
		const t = identitySpellings(first("usdc"));
		expect(t.map((x) => x.label).slice(0, 4)).toEqual([
			"token name",
			"token index",
			"token ID",
			"token string",
		]);
		expect(t.find((x) => x.label === "token string")?.usedIn).toEqual([
			"transfers",
		]);
	});
});

describe("relatedIdentities", () => {
	it("links the HYPE perp to its spot pairs and token, excluding itself", () => {
		const perp = resolveAsset(universe, "HYPE").matches.find(
			(m) => m.kind === "asset" && m.asset.venue.kind === "perp",
		);
		if (!perp) throw new Error("no HYPE perp");
		const rel = relatedIdentities(universe, perp);
		const ids = rel.map(
			(r) =>
				`${r.relation}:${r.match.kind === "asset" ? r.match.asset.coin : r.match.token.name}`,
		);
		expect(ids).toContain("spot:@107");
		expect(ids).toContain("token:HYPE");
		expect(ids).not.toContain("perp:HYPE");
	});
	it("links an outcome to its other side", () => {
		const yes = resolveAsset(universe, "#14720").matches[0];
		if (!yes) throw new Error("no outcome");
		const rel = relatedIdentities(universe, yes);
		expect(
			rel.some(
				(r) =>
					r.relation === "other-side" &&
					r.match.kind === "asset" &&
					r.match.asset.coin === "#14721",
			),
		).toBe(true);
	});
});

describe("normalizeSettledOutcome", () => {
	const fx = load("outcomes/settled-8306.json") as {
		response: RawSettledOutcome;
	};
	it("normalises the recorded mainnet response", () => {
		const s = normalizeSettledOutcome("mainnet", fx.response);
		expect(s).not.toBeNull();
		if (!s) return;
		expect(s.outcomeId).toBe(8306);
		expect(s.name).toBe("binaryPrice");
		expect(s.parsedDescription?.perp).toBe("BTC");
		expect(s.parsedDescription?.threshold).toBe("85252");
		expect(s.settleFraction).toBe("0");
		expect(
			s.sides.map((x) => [x.name, x.coin, x.token, x.actionAssetId, x.payout]),
		).toEqual([
			["Yes", "#83060", "+83060", 100083060, "0"],
			["No", "#83061", "+83061", 100083061, "1"],
		]);
	});
	it("computes partial payouts and treats null as not settled", () => {
		const s = normalizeSettledOutcome("mainnet", {
			...fx.response,
			settleFraction: "0.25",
		});
		expect(s?.sides.map((x) => x.payout)).toEqual(["0.25", "0.75"]);
		expect(normalizeSettledOutcome("mainnet", null)).toBeNull();
	});
});
