import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildUniverse,
	type ComposeInput,
	composeOrder,
	explainResponse,
	lintPrice,
	lintSize,
	type RawMetadata,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) =>
	JSON.parse(readFileSync(join(here, "..", "fixtures", p), "utf8"));
const u = buildUniverse(
	"mainnet",
	load("metadata/mainnet.json") as RawMetadata,
);
const asset = (coin: string) => {
	const a = u.byCoin.get(coin);
	if (!a) throw new Error(`no ${coin}`);
	return a;
};

describe("precision linter fixtures", () => {
	const cases = load("orders/lint-cases.json") as {
		price: {
			coin: string;
			input: string;
			valid: boolean;
			wire?: string;
			options?: string[];
		}[];
		size: {
			coin: string;
			input: string;
			valid: boolean;
			roundsToZero?: boolean;
			options?: string[];
		}[];
	};
	for (const c of cases.price) {
		it(`price ${c.coin} ${c.input}`, () => {
			const r = lintPrice(c.input, asset(c.coin));
			expect(r.valid).toBe(c.valid);
			if (c.wire) expect(r.wire).toBe(c.wire);
			if (c.options) expect(r.options.map((o) => o.value)).toEqual(c.options);
		});
	}
	for (const c of cases.size) {
		it(`size ${c.coin} ${c.input}`, () => {
			const r = lintSize(c.input, asset(c.coin));
			expect(r.valid).toBe(c.valid);
			if (c.roundsToZero !== undefined)
				expect(r.roundsToZero).toBe(c.roundsToZero);
			if (c.roundsToZero) expect(r.issues[0]?.code).toBe("sz.rounds_to_zero");
			if (c.options) expect(r.options.map((o) => o.value)).toEqual(c.options);
		});
	}
});

const base: ComposeInput = {
	asset: asset("BTC"),
	intent: "long-tpsl",
	side: "buy",
	size: "0.001",
	price: "80000",
	entryType: "limit",
	mid: "83000",
	slippage: "0.05",
	tp: "90000",
	sl: "75000",
	tpslMarket: true,
	cloid: "",
	builderAddress: "",
	builderFee: "",
};

describe("composer", () => {
	it("builds a normalTpsl bracket with reduce-only children", () => {
		const r = composeOrder(base);
		expect(r.action).not.toBeNull();
		const a = r.action as {
			orders: Record<string, unknown>[];
			grouping: string;
		};
		expect(a.grouping).toBe("normalTpsl");
		expect(a.orders).toHaveLength(3);
		expect(a.orders[0]).toEqual({
			a: 0,
			b: true,
			p: "80000",
			s: "0.001",
			r: false,
			t: { limit: { tif: "Gtc" } },
		});
		expect(a.orders[1]).toEqual({
			a: 0,
			b: false,
			p: "90000",
			s: "0.001",
			r: true,
			t: { trigger: { isMarket: true, triggerPx: "90000", tpsl: "tp" } },
		});
		expect(a.orders[2]?.t).toEqual({
			trigger: { isMarket: true, triggerPx: "75000", tpsl: "sl" },
		});
		expect(r.sequence.some((s) => s.label.includes("Sibling"))).toBe(true);
	});
	it("blocks when a positive size rounds to zero (never silently rounds)", () => {
		const r = composeOrder({ ...base, size: "0.000001" });
		expect(r.action).toBeNull();
		expect(r.issues[0]?.code).toBe("sz.rounds_to_zero");
	});
	it("blocks invalid prices and offers explicit options", () => {
		const r = composeOrder({ ...base, price: "80000.5" });
		expect(r.action).toBeNull();
		expect(r.orders[0]?.price.options.map((o) => o.value)).toEqual([
			"80000",
			"80001",
		]);
	});
	it("warns about TP/SL on the wrong side", () => {
		const r = composeOrder({ ...base, tp: "70000" });
		expect(r.issues.map((i) => i.code)).toContain("tpsl.side");
	});
	it("derives market prices conservatively and says so", () => {
		const r = composeOrder({
			...base,
			intent: "market",
			side: "buy",
			tp: "",
			sl: "",
		});
		expect(r.orders[0]?.price.wire).toBe("87150");
		expect(r.orders[0]?.derived).toMatch(/rounded down/);
		const sell = composeOrder({
			...base,
			intent: "market",
			side: "sell",
			tp: "",
			sl: "",
		});
		expect(sell.orders[0]?.price.wire).toBe("78850");
	});
	it("reduce-only close sells a long with IOC and r=true", () => {
		const r = composeOrder({
			...base,
			intent: "reduce-only-close",
			side: "sell",
			tp: "",
			sl: "",
			size: "0.0001",
		});
		const o = (r.action as { orders: Record<string, unknown>[] }).orders[0];
		expect(o?.r).toBe(true);
		expect(o?.b).toBe(false);
		expect(o?.t).toEqual({ limit: { tif: "Ioc" } });
		expect(r.notional?.ok).toBe(true);
	});
	it("enforces minimum notional and builder fee caps", () => {
		expect(
			composeOrder({
				...base,
				intent: "post-only",
				size: "0.0001",
				tp: "",
				sl: "",
			}).issues.map((i) => i.code),
		).toContain("notional.min");
		expect(
			composeOrder({
				...base,
				builderAddress: "0x8c967e73e7b15087c42a10d344cff4c96d877f1d",
				builderFee: "101",
			}).issues.map((i) => i.code),
		).toContain("builder.fee_max");
	});
	it("flags post-only prices that would cross", () => {
		expect(
			composeOrder({
				...base,
				intent: "post-only",
				price: "84000",
				size: "0.001",
				tp: "",
				sl: "",
			}).issues.map((i) => i.code),
		).toContain("alo.crosses");
	});
});

describe("explainer fixtures", () => {
	for (const c of (
		load("orders/explain-cases.json") as {
			cases: {
				name: string;
				input: string;
				request?: unknown;
				kind: string;
				outcomes: string[];
				catalog?: (string | null)[];
			}[];
		}
	).cases) {
		it(c.name, () => {
			const r = explainResponse(c.input, c.request);
			expect(r.kind).toBe(c.kind);
			expect(r.entries.map((e) => e.outcome)).toEqual(c.outcomes);
			c.catalog?.forEach((id, i) =>
				expect(r.entries[i]?.catalog?.id ?? null).toBe(id),
			);
		});
	}
});
