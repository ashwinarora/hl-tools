import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSessionFile } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { fakeHub } from "#/test/fakeSocket";
import {
	DOWN_AFTER,
	LIVE_GRACE_MS,
	LIVE_INITIAL,
	type LiveAccount,
	LiveAccountStore,
	liveStatus,
} from "./account";

/** The account in the recorded sessions, as the sanitiser renamed it. */
const ME = `0x${"0".repeat(39)}1`;

function recorded(name: string): unknown[] {
	const path = fileURLToPath(
		new URL(
			`../../../../../packages/hl-core/fixtures/ws/testnet-account-${name}.json`,
			import.meta.url,
		),
	);
	const parsed = parseSessionFile(readFileSync(path, "utf8"));
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.file.messages
		.filter((m) => m.dir === "in")
		.map((m) => JSON.parse(m.text) as { channel: string; data: unknown })
		.filter((m) => m.channel === parsed.file.channel)
		.map((m) => m.data);
}

function setup() {
	const f = fakeHub();
	const store = new LiveAccountStore({
		hub: f.make,
		account: ME.toUpperCase().replace("0X", "0x"),
		timers: f.clock.timers,
	});
	const seen: LiveAccount[] = [];
	store.subscribe(() => seen.push(store.getSnapshot()));
	return { ...f, store, seen, now: () => store.getSnapshot() };
}

const perp = (
	accountValue: string,
	time: number,
	positions: unknown[] = [],
) => ({
	dex: "",
	user: ME,
	clearinghouseState: {
		marginSummary: { accountValue, totalNtlPos: "0.0", totalMarginUsed: "0.0" },
		withdrawable: accountValue,
		assetPositions: positions,
		time,
	},
});
const dexes = (...pairs: [string, string][]) => ({
	user: ME,
	clearinghouseStates: pairs.map(([dex, accountValue]) => [
		dex,
		{
			marginSummary: { accountValue, totalNtlPos: "0", totalMarginUsed: "0" },
			withdrawable: accountValue,
			assetPositions: [],
			time: 1,
		},
	]),
});

describe("liveStatus", () => {
	const hub = (status: string, failures = 0) =>
		({ status, failures, lastMessageAt: null, nextAttemptAt: null }) as never;
	const live = { status: "live", reason: null } as const;
	const pending = { status: "pending", reason: null } as const;
	const refused = { status: "refused", reason: "limit" } as const;
	it("is live only when the socket is open and every holdings subscription is", () => {
		expect(
			liveStatus({ hub: hub("open"), holdings: [live, live], everLive: false }),
		).toBe("live");
		expect(
			liveStatus({
				hub: hub("open"),
				holdings: [live, pending],
				everLive: false,
			}),
		).toBe("connecting");
		expect(
			liveStatus({ hub: hub("open"), holdings: [], everLive: false }),
		).toBe("connecting");
		expect(
			liveStatus({ hub: hub("connecting"), holdings: [live], everLive: false }),
		).toBe("connecting");
	});
	it("says reconnecting once it has been live or has failed, and down after several failures", () => {
		expect(
			liveStatus({
				hub: hub("open"),
				holdings: [live, pending],
				everLive: true,
			}),
		).toBe("reconnecting");
		expect(
			liveStatus({
				hub: hub("waiting", 1),
				holdings: [pending],
				everLive: false,
			}),
		).toBe("reconnecting");
		expect(
			liveStatus({ hub: hub("suspended"), holdings: [live], everLive: false }),
		).toBe("reconnecting");
		expect(
			liveStatus({
				hub: hub("waiting", DOWN_AFTER),
				holdings: [pending],
				everLive: true,
			}),
		).toBe("down");
		expect(
			liveStatus({
				hub: hub("connecting", DOWN_AFTER + 2),
				holdings: [pending],
				everLive: true,
			}),
		).toBe("down");
	});
	it("says refused when Hyperliquid will not send holdings, whatever else is live", () => {
		expect(
			liveStatus({
				hub: hub("open"),
				holdings: [live, refused],
				everLive: true,
			}),
		).toBe("refused");
		// a refusal heard on a socket that is gone says nothing about the next one
		expect(
			liveStatus({
				hub: hub("waiting", 1),
				holdings: [refused],
				everLive: true,
			}),
		).toBe("reconnecting");
	});
});

describe("LiveAccountStore: holdings", () => {
	it("connects only when a group is acquired, and asks for the holdings of the account", () => {
		const { store, made, sockets, last, now } = setup();
		expect(now()).toBe(LIVE_INITIAL);
		expect(made()).toBe(0);
		expect(sockets).toHaveLength(0);
		store.acquire("holdings");
		expect(made()).toBe(1);
		last().open();
		expect(last().sent).toEqual(
			[
				"clearinghouseState",
				"spotState",
				"openOrders",
				"allDexsClearinghouseState",
			].map((type) => ({
				method: "subscribe",
				subscription: { type, user: ME },
			})),
		);
		expect(now().status).toBe("connecting");
		last().ackAll();
		expect(now().status).toBe("live");
	});
	it("replays the recorded account: a position opens and closes, an order rests", () => {
		const { store, last, now, seen } = setup();
		store.acquire("holdings");
		last().open();
		last().ackAll();
		const before = seen.length;
		for (const d of recorded("clearinghouse"))
			last().say("clearinghouseState", d);
		// ten pushes, four distinct states: nothing is announced when nothing changed
		expect(seen.length - before).toBe(4);
		expect(now().perp).toMatchObject({
			accountValue: "163.389235",
			time: null,
		});
		expect(now().perp?.positions.map((p) => p.coin)).toEqual(["BTC"]);
		for (const d of recorded("spot")) last().say("spotState", d);
		expect(now().spot).toEqual([
			{
				key: "USDC",
				coin: "USDC",
				token: 0,
				total: "10.5",
				hold: "0.0",
				available: "10.5",
			},
		]);
		for (const d of recorded("open-orders")) last().say("openOrders", d);
		expect(now().openOrders?.map((o) => o.coin)).toEqual(["ETH", "BTC"]);
		// and a push that repeats the state hands back the very same rows
		const rows = now().openOrders;
		last().say("openOrders", recorded("open-orders").at(-1));
		expect(now().openOrders).toBe(rows);
	});
	it("looks once at every perp dex, then lets that subscription go", () => {
		const { store, last, now } = setup();
		store.acquire("holdings");
		last().open();
		last().ackAll();
		expect(now().otherDexes).toBeNull();
		last().say(
			"allDexsClearinghouseState",
			dexes(["", "9.8"], ["abcd", "0.0"], ["xyz", "12.5"]),
		);
		expect(now().otherDexes).toEqual(["xyz"]);
		expect(last().sent).toEqual([
			{
				method: "unsubscribe",
				subscription: { type: "allDexsClearinghouseState", user: ME },
			},
		]);
		// still live: that look was never part of it
		expect(now().status).toBe("live");
		// a second screen wanting holdings does not look again
		store.acquire("holdings");
		expect(last().sent).toHaveLength(1);
	});
	it("ignores messages that are not the channel's shape", () => {
		const { store, last, now, seen } = setup();
		store.acquire("holdings");
		store.acquire("history");
		last().open();
		last().ackAll();
		const before = seen.length;
		for (const channel of [
			"clearinghouseState",
			"spotState",
			"openOrders",
			"allDexsClearinghouseState",
			"userFills",
			"userHistoricalOrders",
			"userFundings",
			"userNonFundingLedgerUpdates",
		])
			last().say(channel, { user: ME, nothing: true });
		expect(seen.length).toBe(before);
		expect(now().perp).toBeNull();
		expect(now().fills).toBeNull();
	});
});

describe("LiveAccountStore: history", () => {
	it("keeps each table newest first; empty is known only once the snapshot came", () => {
		const { store, last, now } = setup();
		store.acquire("history");
		last().open();
		expect(last().types("subscribe")).toEqual([
			"userNonFundingLedgerUpdates",
			"userFills",
			"userHistoricalOrders",
			"userFundings",
		]);
		last().ackAll();
		expect(now().fundings).toBeNull();
		last().say("userFundings", { isSnapshot: true, user: ME, fundings: [] });
		expect(now().fundings).toEqual([]);
		for (const d of recorded("fills")) last().say("userFills", d);
		expect(
			now()
				.fills?.map((f) => `${f.coin} ${f.dir}`)
				.slice(0, 3),
		).toEqual(["ETH Close Long", "ETH Open Long", "BTC Open Long"]);
		for (const d of recorded("order-history"))
			last().say("userHistoricalOrders", d);
		expect(now().orderHistory).toHaveLength(20);
		for (const d of recorded("ledger"))
			last().say("userNonFundingLedgerUpdates", d);
		expect(now().ledger).toHaveLength(25);
		expect(now().ledger?.at(-1)).toMatchObject({
			type: "send",
			direction: "in",
		});
		for (const d of recorded("fundings")) last().say("userFundings", d);
		expect(now().fundings).toHaveLength(1);
		expect(now().gaps).toEqual([]);
		// history alone is not "live": that word is about the holdings
		expect(now().status).toBe("connecting");
	});
	it("after a reconnect the snapshot adds what was missed and repeats nothing", () => {
		const { store, last, now, clock } = setup();
		store.acquire("holdings");
		store.acquire("history");
		last().open();
		last().ackAll();
		const [snapshot, ...later] = recorded("fills");
		last().say("userFills", snapshot);
		expect(now().fills).toHaveLength(5);
		expect(now().status).toBe("live");
		last().drop();
		expect(now().status).toBe("reconnecting");
		// what was on screen stays on screen while the socket is away
		expect(now().fills).toHaveLength(5);
		clock.advance(1_000);
		last().open();
		last().ackAll();
		expect(now().status).toBe("live");
		// the new snapshot: the same five, and the two fills that happened meanwhile
		const fills = (snapshot as { fills: unknown[] }).fills;
		const missed = later.flatMap((d) => (d as { fills: unknown[] }).fills);
		last().say("userFills", {
			isSnapshot: true,
			user: ME,
			fills: [...fills, ...missed],
		});
		expect(now().fills).toHaveLength(7);
		expect(new Set(now().fills?.map((f) => f.key)).size).toBe(7);
		expect(now().gaps).toEqual([]);
	});
	it("says so when a reconnect's snapshot does not reach back to what was known", () => {
		const { store, last, now, clock, seen } = setup();
		store.acquire("history");
		last().open();
		last().ackAll();
		const fill = (tid: number, time: number) => ({
			coin: "BTC",
			px: "1",
			sz: "1",
			side: "B",
			time,
			dir: "Open Long",
			tid,
		});
		last().say("userFills", {
			isSnapshot: true,
			user: ME,
			fills: [fill(1, 10), fill(2, 20)],
		});
		last().drop();
		clock.advance(1_000);
		last().open();
		last().ackAll();
		last().say("userFills", {
			isSnapshot: true,
			user: ME,
			fills: [fill(8, 80), fill(9, 90)],
		});
		expect(now().fills?.map((f) => f.tid)).toEqual([9, 8, 2, 1]);
		expect(now().gaps).toEqual(["fills"]);
		// said once; a later stream message is not a gap
		const before = seen.length;
		last().say("userFills", { user: ME, fills: [fill(8, 80)] });
		expect(seen.length).toBe(before);
		last().say("userFills", { user: ME, fills: [fill(10, 95)] });
		expect(now().gaps).toEqual(["fills"]);
	});
});

describe("LiveAccountStore: trouble", () => {
	it("refused holdings make the account 'refused', in the server's words; retry asks again", () => {
		const { store, last, now } = setup();
		store.acquire("holdings");
		last().open();
		last().say(
			"error",
			`Cannot track more than 10 total users: {"type":"spotState","user":"${ME}"}`,
		);
		last().ackAll();
		expect(now().status).toBe("refused");
		expect(now().refused).toEqual([
			{
				part: "spot",
				reason: `Cannot track more than 10 total users: {"type":"spotState","user":"${ME}"}`,
			},
		]);
		store.retry();
		expect(last().types("subscribe").at(-1)).toBe("spotState");
		expect(now().refused).toEqual([]);
		last().ackAll();
		expect(now().status).toBe("live");
	});
	it("a refused history table leaves the holdings live", () => {
		const { store, last, now } = setup();
		store.acquire("holdings");
		store.acquire("history");
		last().open();
		last().say(
			"error",
			`Error parsing JSON into valid websocket request: {"method":"subscribe","subscription":{"type":"userHistoricalOrders","user":"${ME}"}}`,
		);
		last().ackAll();
		expect(now().status).toBe("live");
		expect(now().refused.map((r) => r.part)).toEqual(["orderHistory"]);
	});
	it("goes from reconnecting to down when attempts keep failing, and back to live", () => {
		const { store, last, now, clock } = setup();
		store.acquire("holdings");
		const states: string[] = [];
		for (let i = 0; i < DOWN_AFTER; i++) {
			last().drop();
			states.push(now().status);
			clock.advance(30_000);
		}
		expect(states).toEqual(["reconnecting", "reconnecting", "down"]);
		last().open();
		last().ackAll();
		expect(now().status).toBe("live");
	});
});

describe("LiveAccountStore: who wants what", () => {
	it("keeps a group while anyone wants it, and a little longer", () => {
		const { store, last, now, clock, hub } = setup();
		const a = store.acquire("holdings");
		const b = store.acquire("holdings");
		last().open();
		last().ackAll();
		last().say("clearinghouseState", perp("5.0", 1));
		a();
		a();
		clock.advance(LIVE_GRACE_MS * 2);
		expect(last().types("unsubscribe")).toEqual([]);
		b();
		clock.advance(LIVE_GRACE_MS - 1);
		// the next page of the same treasury takes it over without a new subscription
		const c = store.acquire("holdings");
		clock.advance(LIVE_GRACE_MS * 2);
		expect(last().types("unsubscribe")).toEqual([]);
		expect(now().perp?.accountValue).toBe("5.0");
		c();
		clock.advance(LIVE_GRACE_MS);
		expect(last().closed).toBe(true);
		expect(hub.state().status).toBe("idle");
		// what was shown does not come back as if it were current
		expect(now()).toBe(LIVE_INITIAL);
		expect(clock.waiting).toBe(0);
	});
	it("drops history alone when only that is released", () => {
		const { store, last, now, clock } = setup();
		store.acquire("holdings");
		const leave = store.acquire("history");
		last().open();
		last().ackAll();
		last().say("userFundings", { isSnapshot: true, user: ME, fundings: [] });
		leave();
		clock.advance(LIVE_GRACE_MS);
		expect(last().types("unsubscribe").sort()).toEqual(
			[
				"userFills",
				"userFundings",
				"userHistoricalOrders",
				"userNonFundingLedgerUpdates",
			].sort(),
		);
		expect(last().closed).toBe(false);
		expect(now().status).toBe("live");
	});
	it("starts over cleanly after everything was released", () => {
		const { store, last, now, clock, sockets, made } = setup();
		store.acquire("holdings")();
		clock.advance(LIVE_GRACE_MS);
		expect(now()).toBe(LIVE_INITIAL);
		store.acquire("holdings");
		expect(made()).toBe(2);
		expect(sockets).toHaveLength(2);
		last().open();
		// the look at every dex is taken again, since nothing is known any more
		expect(last().types("subscribe")).toContain("allDexsClearinghouseState");
		last().ackAll();
		expect(now().status).toBe("live");
	});
	it("retry before anything was acquired does nothing", () => {
		const { store, made } = setup();
		store.retry();
		expect(made()).toBe(0);
	});
	it("uses real timers for the grace period when none are passed", () => {
		const f = fakeHub();
		const store = new LiveAccountStore({
			hub: f.make,
			account: ME,
			graceMs: 0,
		});
		const leave = store.acquire("holdings");
		const unsubscribe = store.subscribe(() => {});
		unsubscribe();
		leave();
		return new Promise<void>((resolve) =>
			setTimeout(() => {
				expect(f.hub.state().status).toBe("idle");
				resolve();
			}, 5),
		);
	});
});
