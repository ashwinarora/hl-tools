/** Account channels: recorded testnet sessions replayed through the parsers, and the merge's invariants. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	FILL_MERGE,
	type FillRow,
	FUNDING_MERGE,
	LEDGER_MERGE,
	type LedgerRow,
	leavesGap,
	type MergeOptions,
	mergeRows,
	ORDER_HISTORY_MERGE,
	type OrderHistoryRow,
	type PerpAccount,
	parseAllDexs,
	parseFills,
	parseFundings,
	parseLedger,
	parseOpenOrders,
	parseOrderHistory,
	parsePerpAccount,
	parseSessionFile,
	parseSpotState,
	perpAccountInUse,
	shareStructure,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** The `data` of every channel message in a recorded session, in order. */
function recorded(name: string): unknown[] {
	const parsed = parseSessionFile(
		readFileSync(
			join(here, "..", "fixtures", "ws", `testnet-account-${name}.json`),
			"utf8",
		),
	);
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.file.messages
		.filter((m) => m.dir === "in")
		.map((m) => JSON.parse(m.text) as { channel: string; data: unknown })
		.filter((m) => m.channel === parsed.file.channel)
		.map((m) => m.data);
}
/** The recorded account, as the sanitiser renamed it. */
const ME = `0x${"0".repeat(39)}1`;
const other = (n: number) => `0x${"0".repeat(39)}${n}`;

describe("holdings, replayed from testnet", () => {
	it("perps: a position opens and closes; unchanged positions keep their object", () => {
		let prev: PerpAccount | null = null;
		const coins: string[] = [];
		let reused = 0;
		for (const data of recorded("clearinghouse")) {
			const parsed = parsePerpAccount(data);
			expect(parsed).not.toBeNull();
			const next: PerpAccount = prev
				? shareStructure(prev, parsed as PerpAccount)
				: (parsed as PerpAccount);
			if (prev && next.positions === prev.positions) reused++;
			coins.push(next.positions.map((p) => p.coin).join("+"));
			prev = next;
		}
		// BTC was held throughout; ETH was opened and closed while recording
		expect(new Set(coins)).toEqual(new Set(["BTC", "BTC+ETH"]));
		expect(coins.at(0)).toBe("BTC");
		expect(coins.at(-1)).toBe("BTC");
		expect(reused).toBeGreaterThan(3);
		const btc = (prev as PerpAccount | null)?.positions[0];
		expect(btc).toMatchObject({
			key: ":BTC",
			dex: "",
			coin: "BTC",
			szi: "0.00019",
			entryPx: "82689.0",
			liquidationPx: null,
			leverage: { type: "cross", value: 20 },
			fundingSinceOpen: "0.0",
		});
		// the server sends no mark price: value ÷ size
		expect(btc?.markPx).toBe("82689");
		expect(prev).toMatchObject({ dex: "", accountValue: "163.389235" });
		expect(perpAccountInUse(prev as unknown as PerpAccount)).toBe(true);
	});
	it("spot: balances with what is free of open orders", () => {
		expect(parseSpotState(recorded("spot")[0])).toEqual([
			{
				key: "USDC",
				coin: "USDC",
				token: 0,
				total: "10.5",
				hold: "0.0",
				available: "10.5",
			},
		]);
		expect(
			parseSpotState({
				spotState: {
					balances: [
						{ coin: "HYPE", token: 150, total: "12.5", hold: "2.25" },
						{ coin: "BAD", total: "twelve" },
						null,
					],
				},
			}),
		).toEqual([
			{
				key: "HYPE",
				coin: "HYPE",
				token: 150,
				total: "12.5",
				hold: "2.25",
				available: "10.25",
			},
		]);
	});
	it("open orders: the resting order appears the moment it is placed", () => {
		const counts = recorded("open-orders").map(
			(d) => parseOpenOrders(d)?.orders.length,
		);
		expect(counts.at(0)).toBe(1);
		expect(counts.at(-1)).toBe(2);
		const last = parseOpenOrders(recorded("open-orders").at(-1));
		expect(last?.dex).toBe("");
		expect(last?.orders.find((o) => o.coin === "ETH")).toMatchObject({
			side: "B",
			limitPx: "2003.0",
			sz: "0.006",
			origSz: "0.006",
			orderType: "Limit",
			tif: "Gtc",
			reduceOnly: false,
			isTrigger: false,
			triggerPx: null,
			triggerCondition: null,
		});
	});
	it("all dexes: one state per dex, and which of them hold anything", () => {
		const state = (accountValue: string, positions: unknown[] = []) => ({
			marginSummary: {
				accountValue,
				totalNtlPos: "0.0",
				totalMarginUsed: "0.0",
			},
			withdrawable: accountValue,
			assetPositions: positions,
			time: 5,
		});
		const all = parseAllDexs({
			user: ME,
			clearinghouseStates: [
				["", state("9.8")],
				["abcd", state("0.0")],
				[
					"xyz",
					state("0", [
						{
							position: {
								coin: "xyz:GOLD",
								szi: "-2",
								positionValue: "5000.0",
								unrealizedPnl: "1.5",
								marginUsed: "250",
							},
						},
					]),
				],
				["broken", { withdrawable: "1" }],
				"not a pair",
			],
		});
		expect(all?.map((s) => [s.dex, perpAccountInUse(s)])).toEqual([
			["", true],
			["abcd", false],
			["xyz", true],
		]);
		expect(all?.[2]?.positions[0]).toMatchObject({
			key: "xyz:xyz:GOLD",
			szi: "-2",
			markPx: "2500",
			entryPx: null,
			leverage: null,
		});
	});
	it("amounts sent as numbers are read like the strings the server sends today", () => {
		const s = parsePerpAccount({
			dex: "",
			clearinghouseState: {
				marginSummary: {
					accountValue: 163.4,
					totalNtlPos: 0,
					totalMarginUsed: 0,
				},
				withdrawable: 161.2,
				assetPositions: [
					{
						position: {
							coin: "BTC",
							szi: 0,
							positionValue: 0,
							unrealizedPnl: 0,
							marginUsed: 0,
						},
					},
					{ position: { coin: "ETH", szi: "NaN" } },
				],
			},
		});
		expect(s).toMatchObject({ accountValue: "163.4", withdrawable: "161.2" });
		// a zero size has no mark price, and a row with a bad amount is dropped
		expect(s?.positions).toHaveLength(1);
		expect(s?.positions[0]?.markPx).toBeNull();
	});
	it("answers null for anything that is not the channel's shape", () => {
		for (const junk of [null, undefined, 5, "x", [], {}, { orders: {} }]) {
			expect(parsePerpAccount(junk)).toBeNull();
			expect(parseAllDexs(junk)).toBeNull();
			expect(parseSpotState(junk)).toBeNull();
			expect(parseOpenOrders(junk)).toBeNull();
			expect(parseFills(junk)).toBeNull();
			expect(parseOrderHistory(junk)).toBeNull();
			expect(parseFundings(junk)).toBeNull();
			expect(parseLedger(junk, ME)).toBeNull();
		}
	});
});

describe("history, replayed from testnet", () => {
	it("fills: the snapshot, then each fill once, newest first", () => {
		let rows: readonly FillRow[] = [];
		const flags: boolean[] = [];
		for (const data of recorded("fills")) {
			const b = parseFills(data);
			if (!b) throw new Error("not a fills message");
			flags.push(b.snapshot);
			rows = mergeRows(rows, b.rows, FILL_MERGE);
		}
		expect(flags).toEqual([true, false, false]);
		expect(rows.map((r) => `${r.coin} ${r.dir} ${r.sz}`)).toEqual([
			"ETH Close Long 0.006",
			"ETH Open Long 0.006",
			"BTC Open Long 0.00019",
			// three fills of one order in one transaction: told apart by tid, ordered by it
			...rows.slice(3, 6).map((r) => `BTC Close Long ${r.sz}`),
			"BTC Open Long 0.001",
		]);
		expect(new Set(rows.slice(3, 6).map((r) => r.hash)).size).toBe(1);
		expect(new Set(rows.map((r) => r.key)).size).toBe(7);
		expect(rows[0]).toMatchObject({
			side: "A",
			px: "2503.7",
			fee: "0.006759",
			feeToken: "USDC",
			closedPnl: "-0.0012",
			crossed: true,
		});
		// a reconnect replays the snapshot: nothing is added, the same array comes back
		const again = recorded("fills").reduce<readonly FillRow[]>(
			(acc, d) => mergeRows(acc, parseFills(d)?.rows ?? [], FILL_MERGE),
			rows,
		);
		expect(again).toBe(rows);
	});
	it("order history: one row per order, at the last status it reached", () => {
		let rows: readonly OrderHistoryRow[] = [];
		let entries = 0;
		for (const data of recorded("order-history")) {
			const b = parseOrderHistory(data);
			if (!b) throw new Error("not an order history message");
			entries += b.rows.length;
			rows = mergeRows(rows, b.rows, ORDER_HISTORY_MERGE);
		}
		expect(entries).toBe(35);
		expect(rows).toHaveLength(20);
		expect(new Set(rows.map((r) => r.oid)).size).toBe(20);
		expect(
			rows.slice(0, 5).map((r) => `${r.coin} ${r.tif} ${r.status} ${r.sz}`),
		).toEqual([
			"ETH Ioc filled 0.0",
			"ETH Ioc filled 0.0",
			"ETH Gtc open 0.006",
			"BTC Ioc filled 0.0",
			"BTC Gtc open 0.00019",
		]);
		expect(rows.slice(5).every((r) => r.status === "canceled")).toBe(true);
		expect(rows[0]?.origSz).toBe("0.006");
	});
	it("an order's 'open' never replaces what happened to it at the same instant", () => {
		const row = (status: string, statusTimestamp: number): OrderHistoryRow => ({
			key: "7",
			oid: 7,
			coin: "BTC",
			side: "B",
			limitPx: "1",
			sz: "1",
			origSz: "1",
			timestamp: 1,
			orderType: "Limit",
			tif: "Ioc",
			reduceOnly: false,
			isTrigger: false,
			triggerPx: null,
			triggerCondition: null,
			cloid: null,
			status,
			statusTimestamp,
		});
		const merge = (...r: OrderHistoryRow[]) =>
			r.reduce<readonly OrderHistoryRow[]>(
				(acc, x) => mergeRows(acc, [x], ORDER_HISTORY_MERGE),
				[],
			)[0]?.status;
		expect(merge(row("open", 5), row("filled", 5))).toBe("filled");
		expect(merge(row("filled", 5), row("open", 5))).toBe("filled");
		expect(merge(row("open", 5), row("triggered", 5), row("filled", 5))).toBe(
			"filled",
		);
		expect(merge(row("filled", 5), row("triggered", 5))).toBe("filled");
		expect(merge(row("canceled", 9), row("open", 5))).toBe("canceled");
		expect(merge(row("open", 5), row("canceled", 9))).toBe("canceled");
		// two closing statuses at one instant cannot be ordered by time: the choice is fixed, not by arrival
		expect(merge(row("filled", 5), row("canceled", 5))).toBe("filled");
		expect(merge(row("canceled", 5), row("filled", 5))).toBe("filled");
		const once = mergeRows([], [row("filled", 5)], ORDER_HISTORY_MERGE);
		expect(mergeRows(once, [row("filled", 5)], ORDER_HISTORY_MERGE)).toBe(once);
	});
	it("funding: the hourly payment of the recorded position", () => {
		const b = parseFundings(recorded("fundings")[0]);
		expect(b).toEqual({
			snapshot: true,
			rows: [
				{
					key: "1791662400025:BTC",
					time: 1791662400025,
					coin: "BTC",
					// a long position while the rate was negative: received
					usdc: "0.008398",
					szi: "0.00019",
					fundingRate: "-0.000532081",
				},
			],
		});
	});
	it("funding: the stream's flat rows and the info endpoint's wrapped ones", () => {
		const flat = parseFundings({
			isSnapshot: true,
			user: ME,
			fundings: [
				{
					time: 3600000,
					coin: "BTC",
					usdc: "-0.000196",
					szi: "0.00019",
					fundingRate: "0.0000125",
				},
				{ time: 3600000, coin: "ETH", usdc: "0.0001", szi: "-0.006" },
				{ time: "soon", coin: "SOL", usdc: "1" },
			],
		});
		expect(flat?.snapshot).toBe(true);
		expect(flat?.rows).toEqual([
			{
				key: "3600000:BTC",
				time: 3600000,
				coin: "BTC",
				usdc: "-0.000196",
				szi: "0.00019",
				fundingRate: "0.0000125",
			},
			{
				key: "3600000:ETH",
				time: 3600000,
				coin: "ETH",
				usdc: "0.0001",
				szi: "-0.006",
				fundingRate: null,
			},
		]);
		const wrapped = parseFundings({
			fundings: [
				{
					time: 7200000,
					hash: `0x${"0".repeat(64)}`,
					delta: { type: "funding", coin: "BTC", usdc: "-0.0002" },
				},
			],
		});
		expect(wrapped).toEqual({
			snapshot: false,
			rows: [
				{
					key: "7200000:BTC",
					time: 7200000,
					coin: "BTC",
					usdc: "-0.0002",
					szi: null,
					fundingRate: null,
				},
			],
		});
		const merged = mergeRows(
			flat?.rows ?? [],
			wrapped?.rows ?? [],
			FUNDING_MERGE,
		);
		expect(merged.map((r) => r.key)).toEqual([
			"7200000:BTC",
			"3600000:BTC",
			"3600000:ETH",
		]);
	});
	it("ledger: which way each entry went, seen from the account", () => {
		const b = parseLedger(recorded("ledger")[0], ME);
		expect(b?.snapshot).toBe(true);
		expect(b?.rows).toHaveLength(25);
		const rows = mergeRows([], b?.rows ?? [], LEDGER_MERGE);
		expect(rows.at(-1)).toMatchObject({
			type: "send",
			direction: "in",
			token: "USDC",
			amount: "400.0",
			counterparty: other(2),
			fromVenue: "spot",
			toVenue: "spot",
		});
		const first = (type: string, direction: string) =>
			[...rows]
				.reverse()
				.find((r) => r.type === type && r.direction === direction);
		expect(first("accountClassTransfer", "within")).toMatchObject({
			amount: "399.0",
			counterparty: null,
			fromVenue: "spot",
			toVenue: "perp",
			fee: null,
		});
		expect(first("internalTransfer", "out")).toMatchObject({
			token: "USDC",
			amount: "40.0",
			counterparty: other(3),
			fee: "1.0",
			feeToken: "USDC",
		});
		expect(first("internalTransfer", "in")).toMatchObject({
			amount: "109.0",
			counterparty: other(3),
		});
		expect(first("spotTransfer", "out")).toMatchObject({
			token: "USDC",
			amount: "0.5",
			fromVenue: "spot",
			feeToken: null,
		});
		// whole hashes, one row each, and the delta as sent for the details
		expect(rows.every((r) => /^0x[0-9a-f]{64}$/.test(r.hash))).toBe(true);
		expect(new Set(rows.map((r) => r.key)).size).toBe(25);
		expect(rows.at(-1)?.delta.nonce).toBe(1791399248245);
	});
	it("ledger: every documented kind, and kinds nobody has documented yet", () => {
		const hash = `0x${"ab".repeat(32)}`;
		const one = (delta: Record<string, unknown>): LedgerRow | undefined =>
			parseLedger({ nonFundingLedgerUpdates: [{ time: 1, hash, delta }] }, ME)
				?.rows[0];
		const shape = (delta: Record<string, unknown>) => {
			const r = one(delta);
			return r
				? [
						r.direction,
						r.amount,
						r.token,
						r.counterparty,
						r.fromVenue,
						r.toVenue,
					]
				: null;
		};
		expect(shape({ type: "deposit", usdc: "50" })).toEqual([
			"in",
			"50",
			"USDC",
			null,
			null,
			"perp",
		]);
		expect(
			one({ type: "withdraw", usdc: "20", nonce: 5, fee: "1" }),
		).toMatchObject({
			direction: "out",
			amount: "20",
			fromVenue: "perp",
			fee: "1",
			feeToken: "USDC",
		});
		expect(
			shape({
				type: "subAccountTransfer",
				usdc: "5",
				user: ME.toUpperCase().replace("0X", "0x"),
				destination: other(9),
			}),
		).toEqual(["out", "5", "USDC", other(9), "perp", "perp"]);
		expect(
			shape({
				type: "send",
				user: ME,
				destination: ME,
				sourceDex: "",
				destinationDex: "xyz",
				token: "USDC",
				amount: "7",
			}),
		).toEqual(["within", "7", "USDC", null, "perp", "xyz"]);
		expect(
			shape({
				type: "internalTransfer",
				usdc: "1",
				user: other(4),
				destination: other(5),
			}),
		).toEqual(["other", "1", "USDC", null, "perp", "perp"]);
		expect(
			shape({ type: "accountClassTransfer", usdc: "3", toPerp: false }),
		).toEqual(["within", "3", "USDC", null, "perp", "spot"]);
		expect(
			shape({
				type: "cStakingTransfer",
				token: "HYPE",
				amount: "2",
				isDeposit: true,
			}),
		).toEqual(["within", "2", "HYPE", null, "spot", "staking"]);
		expect(
			shape({
				type: "cStakingTransfer",
				token: "HYPE",
				amount: "2",
				isDeposit: false,
			}),
		).toEqual(["within", "2", "HYPE", null, "staking", "spot"]);
		expect(
			shape({ type: "vaultDeposit", vault: other(6), usdc: "10" }),
		).toEqual(["within", "10", "USDC", other(6), "perp", "vault"]);
		expect(
			one({ type: "vaultCreate", vault: other(6), usdc: "100", fee: "100" }),
		).toMatchObject({ fee: "100", feeToken: "USDC", toVenue: "vault" });
		expect(
			shape({
				type: "vaultWithdraw",
				vault: other(6),
				user: ME,
				requestedUsd: "10",
				netWithdrawnUsd: "9.5",
			}),
		).toEqual(["within", "9.5", "USDC", other(6), "vault", "perp"]);
		expect(
			shape({ type: "vaultDistribution", vault: other(6), usdc: "4" }),
		).toEqual(["within", "4", "USDC", other(6), "vault", "perp"]);
		expect(
			shape({ type: "rewardsClaim", amount: "1.5", token: "HYPE" }),
		).toEqual(["in", "1.5", "HYPE", null, null, "spot"]);
		expect(shape({ type: "spotGenesis", token: "NEW", amount: "9" })?.[0]).toBe(
			"in",
		);
		// a row naming no other account still says which way it went
		expect(
			shape({
				type: "internalTransfer",
				usdc: "1",
				user: ME,
				destination: "nobody",
			}),
		).toEqual(["out", "1", "USDC", null, "perp", "perp"]);
		// shown by name with what it carries, never guessed at
		expect(
			shape({ type: "liquidation", liquidatedNtlPos: "50", accountValue: "1" }),
		).toEqual(["other", null, null, null, null, null]);
		expect(shape({ type: "somethingNew", token: "X", amount: "1" })).toEqual([
			"other",
			"1",
			"X",
			null,
			null,
			null,
		]);
		// rows that cannot be placed in time, or have no kind, are dropped
		expect(
			parseLedger(
				{
					nonFundingLedgerUpdates: [
						{ time: 1, hash, delta: {} },
						{ time: 1, delta: { type: "deposit", usdc: "1" } },
						{ hash, delta: { type: "deposit", usdc: "1" } },
						7,
					],
				},
				ME,
			)?.rows,
		).toEqual([]);
	});
});

describe("mergeRows", () => {
	interface Row {
		readonly key: string;
		readonly time: number;
		readonly rank: number;
	}
	const opts: MergeOptions<Row> = {
		compare: (a, b) =>
			b.time - a.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
		cap: 8,
		supersedes: (next, prev) =>
			(next.time - prev.time || next.rank - prev.rank) > 0,
	};
	// a version of a row: later versions of one key never move back in time
	const version = fc.record({
		id: fc.integer({ min: 0, max: 11 }),
		step: fc.integer({ min: 0, max: 3 }),
	});
	const rowOf = (v: { id: number; step: number }): Row => ({
		key: `k${v.id}`,
		time: v.id * 10 + v.step,
		rank: v.step,
	});
	const batches = fc.array(fc.array(version.map(rowOf), { maxLength: 6 }), {
		maxLength: 8,
	});
	const fold = (bs: readonly (readonly Row[])[]) =>
		bs.reduce<readonly Row[]>((acc, b) => mergeRows(acc, b, opts), []);

	it("gives the same table whatever order the messages arrive in", () => {
		fc.assert(
			fc.property(batches, fc.infiniteStream(fc.nat()), (bs, seeds) => {
				const it = seeds[Symbol.iterator]();
				const shuffled = bs
					.map((b) => ({ b, at: it.next().value as number }))
					.sort((x, y) => x.at - y.at)
					.map((x) => x.b);
				expect(fold(shuffled)).toEqual(fold(bs));
				// one message or many: the same rows
				expect(fold([bs.flat()])).toEqual(fold(bs));
			}),
		);
	});
	it("changes nothing when the same messages are merged again", () => {
		fc.assert(
			fc.property(batches, (bs) => {
				const once = fold(bs);
				expect(bs.reduce((acc, b) => mergeRows(acc, b, opts), once)).toBe(once);
			}),
		);
	});
	it("keeps the newest rows, newest first, one per key, at most the cap", () => {
		fc.assert(
			fc.property(batches, (bs) => {
				const out = fold(bs);
				expect(out.length).toBeLessThanOrEqual(opts.cap);
				expect(new Set(out.map((r) => r.key)).size).toBe(out.length);
				expect([...out].sort(opts.compare)).toEqual(out);
				// each key shows its latest version, and nothing newer was left out
				const latest = new Map<string, Row>();
				for (const r of bs.flat()) {
					const have = latest.get(r.key);
					if (!have || opts.supersedes?.(r, have)) latest.set(r.key, r);
				}
				expect(out).toEqual(
					[...latest.values()].sort(opts.compare).slice(0, opts.cap),
				);
			}),
		);
	});
	it("hands back the same array when a message adds nothing", () => {
		const a = { key: "a", time: 5, rank: 0 };
		const table = mergeRows([], [a], opts);
		expect(mergeRows(table, [], opts)).toBe(table);
		expect(mergeRows(table, [{ ...a }], opts)).toBe(table);
		// an older version of a row already shown
		expect(mergeRows(table, [{ key: "a", time: 4, rank: 3 }], opts)).toBe(
			table,
		);
		// a row older than everything the cap keeps
		const full = mergeRows(
			[],
			Array.from({ length: 8 }, (_, i) => ({
				key: `n${i}`,
				time: 100 + i,
				rank: 0,
			})),
			opts,
		);
		expect(mergeRows(full, [{ key: "old", time: 1, rank: 0 }], opts)).toBe(
			full,
		);
		expect(mergeRows(full, [a], { ...opts, cap: 0 })).toEqual([]);
	});
	it("without `supersedes`, the first row seen under a key stays", () => {
		const first = { key: "a", time: 5, rank: 0 };
		const out = mergeRows([first], [{ key: "a", time: 9, rank: 9 }], {
			compare: opts.compare,
			cap: 8,
		});
		expect(out[0]).toBe(first);
	});
});

describe("leavesGap", () => {
	const row = (n: number) => ({ key: `r${n}`, time: n });
	const time = (r: { time: number }) => r.time;
	it("is true only when a reconnect's snapshot does not reach back to known rows", () => {
		const known = [row(3), row(2), row(1)];
		expect(leavesGap(known, [row(9), row(8)], time)).toBe(true);
		// overlaps: nothing was missed
		expect(leavesGap(known, [row(9), row(3)], time)).toBe(false);
		// nothing known yet, or an empty snapshot: nothing to compare
		expect(leavesGap([], [row(9)], time)).toBe(false);
		expect(leavesGap(known, [], time)).toBe(false);
		// older rows than known ones are not a gap after the known ones
		expect(leavesGap([row(9)], [row(1)], time)).toBe(false);
	});
});

describe("shareStructure", () => {
	it("returns the previous value when nothing changed, and keeps unchanged parts", () => {
		const prev = {
			accountValue: "10",
			time: 1,
			positions: [
				{ coin: "BTC", lev: { type: "cross", value: 20 } },
				{ coin: "ETH" },
			],
		};
		expect(shareStructure(prev, structuredClone(prev))).toBe(prev);
		const next = shareStructure(prev, { ...structuredClone(prev), time: 2 });
		expect(next).not.toBe(prev);
		expect(next.time).toBe(2);
		expect(next.positions).toBe(prev.positions);
		const moved = shareStructure(prev, {
			...structuredClone(prev),
			positions: [
				{ coin: "BTC", lev: { type: "cross", value: 25 } },
				{ coin: "ETH" },
			],
		});
		expect(moved.positions).not.toBe(prev.positions);
		expect(moved.positions[1]).toBe(prev.positions[1]);
		expect(moved.positions[0]?.lev?.value).toBe(25);
	});
	it("notices added, removed and retyped parts", () => {
		expect(shareStructure<unknown>({ a: 1 }, { a: 1, b: 2 })).toEqual({
			a: 1,
			b: 2,
		});
		expect(shareStructure<unknown>({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
		expect(shareStructure<unknown>([1, 2], [1])).toEqual([1]);
		expect(shareStructure<unknown>([1], [1, 2])).toEqual([1, 2]);
		expect(shareStructure<unknown>({ a: [1] }, { a: { 0: 1 } })).toEqual({
			a: { 0: 1 },
		});
		expect(shareStructure<unknown>(null, { a: 1 })).toEqual({ a: 1 });
		expect(shareStructure<unknown>({ a: 1 }, null)).toBeNull();
		const same = [1, "x", null];
		expect(shareStructure(same, [1, "x", null])).toBe(same);
	});
});
