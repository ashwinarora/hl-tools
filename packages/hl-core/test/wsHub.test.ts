/** The socket hub against a fake socket and a fake clock: nothing here opens a connection. */
import { describe, expect, it, vi } from "vitest";
import {
	HUB_DEFAULTS,
	type HubMessage,
	type HubSocket,
	type HubState,
	type HubSubscriptionState,
	hubBackoff,
	type WsChannelSpec,
	WsHub,
	wsChannel,
} from "../src/index.ts";

const ch = (t: string) => wsChannel(t) as WsChannelSpec;
const A = `0x${"a".repeat(40)}`;
const B = `0x${"b".repeat(40)}`;

class FakeClock {
	time = 1_000_000;
	private seq = 0;
	private pending: { id: number; at: number; fn: () => void }[] = [];
	readonly timers = {
		set: (fn: () => void, ms: number) => {
			const id = ++this.seq;
			this.pending.push({ id, at: this.time + ms, fn });
			return id;
		},
		clear: (id: unknown) => {
			this.pending = this.pending.filter((t) => t.id !== id);
		},
	};
	now = () => this.time;
	get waiting() {
		return this.pending.length;
	}
	/** Move the clock, running every timer that comes due, in order. */
	advance(ms: number) {
		const end = this.time + ms;
		for (;;) {
			const due = this.pending
				.filter((t) => t.at <= end)
				.sort((a, b) => a.at - b.at || a.id - b.id)[0];
			if (!due) break;
			this.pending = this.pending.filter((t) => t !== due);
			this.time = due.at;
			due.fn();
		}
		this.time = end;
	}
}

class FakeSocket implements HubSocket {
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { readonly data: unknown }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly sent: Record<string, unknown>[] = [];
	closed = false;
	failSend = false;
	failClose = false;
	send(data: string) {
		if (this.failSend) throw new Error("not open");
		this.sent.push(JSON.parse(data) as Record<string, unknown>);
	}
	close() {
		this.closed = true;
		if (this.failClose) throw new Error("already closing");
	}
	/** The server side. */
	open() {
		this.onopen?.({});
	}
	say(message: unknown) {
		this.onmessage?.({
			data: typeof message === "string" ? message : JSON.stringify(message),
		});
	}
	ack(subscription: Record<string, unknown>) {
		this.say({
			channel: "subscriptionResponse",
			data: { method: "subscribe", subscription },
		});
	}
	drop() {
		this.onclose?.({});
	}
	subscribes() {
		return this.sent
			.filter((m) => m.method === "subscribe")
			.map((m) => m.subscription as Record<string, unknown>);
	}
	methods() {
		return this.sent.map((m) => m.method);
	}
}

function setup(options: { random?: number; failCreate?: () => boolean } = {}) {
	const clock = new FakeClock();
	const sockets: FakeSocket[] = [];
	const hub = new WsHub({
		url: "wss://example.invalid/ws",
		createSocket: (url) => {
			if (options.failCreate?.()) throw new Error("blocked");
			expect(url).toBe("wss://example.invalid/ws");
			const s = new FakeSocket();
			sockets.push(s);
			return s;
		},
		now: clock.now,
		timers: clock.timers,
		random: () => options.random ?? 1,
	});
	const last = () => sockets.at(-1) as FakeSocket;
	return { clock, sockets, hub, last };
}

/** A listener that keeps what it heard. */
function ear() {
	const messages: HubMessage[] = [];
	const states: HubSubscriptionState[] = [];
	return {
		messages,
		states,
		listener: {
			onMessage: (m: HubMessage) => void messages.push(m),
			onStatus: (s: HubSubscriptionState) => void states.push(s),
		},
		status: () => states.at(-1)?.status,
	};
}

describe("hubBackoff", () => {
	it("doubles from one second to thirty, shortened by up to half", () => {
		expect([1, 2, 3, 4, 5, 6, 7, 40].map((n) => hubBackoff(n, 1))).toEqual([
			1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
		]);
		expect(hubBackoff(1, 0)).toBe(500);
		expect(hubBackoff(3, 0.5)).toBe(3000);
		// out-of-range inputs are clamped, not trusted
		expect(hubBackoff(0, 2)).toBe(1000);
		expect(hubBackoff(-3, -1)).toBe(500);
		expect(hubBackoff(2.9, 1)).toBe(2000);
	});
});

describe("connecting and subscribing", () => {
	it("opens no socket until something subscribes, and one socket for everything", () => {
		const { hub, sockets, last } = setup();
		expect(hub.state()).toEqual({
			status: "idle",
			failures: 0,
			lastMessageAt: null,
			nextAttemptAt: null,
		});
		expect(sockets).toHaveLength(0);
		const a = ear();
		const b = ear();
		hub.subscribe(ch("spotState"), { user: A }, a.listener);
		expect(hub.state().status).toBe("connecting");
		// same subscription, written differently: still one
		hub.subscribe(
			ch("spotState"),
			{ user: A.toUpperCase().replace("0X", "0x") },
			b.listener,
		);
		hub.subscribe(ch("userFills"), { user: A }, ear().listener);
		expect(sockets).toHaveLength(1);
		expect(last().sent).toEqual([]);
		last().open();
		expect(hub.state().status).toBe("open");
		expect(last().subscribes()).toEqual([
			{ type: "spotState", user: A },
			{ type: "userFills", user: A },
		]);
		expect(hub.subscriptionState(ch("spotState"), { user: A })).toEqual({
			status: "pending",
			reason: null,
		});
		// the server adds fields of its own to the ack
		last().ack({ type: "spotState", user: A, ignorePortfolioMargin: false });
		expect(a.status()).toBe("live");
		expect(b.status()).toBe("live");
		expect(hub.subscriptionState(ch("userFills"), { user: A })?.status).toBe(
			"pending",
		);
		expect(hub.subscriptionState(ch("userFills"), { user: B })).toBeNull();
		expect(hub.subscriptionState(ch("userFills"), { user: "0x1" })).toBeNull();
	});
	it("flags the first message of a subscription and hands every listener the same data", () => {
		const { hub, last, clock } = setup();
		const a = ear();
		const b = ear();
		hub.subscribe(ch("spotState"), { user: A }, a.listener);
		last().open();
		last().ack({ type: "spotState", user: A });
		last().say({ channel: "spotState", data: { user: A, n: 1 } });
		// a listener that joins later hears messages from then on
		hub.subscribe(ch("spotState"), { user: A }, b.listener);
		expect(last().subscribes()).toHaveLength(1);
		clock.advance(40);
		last().say({ channel: "spotState", data: { user: A, n: 2 } });
		expect(a.messages).toEqual([
			{ data: { user: A, n: 1 }, first: true, at: 1_000_000 },
			{ data: { user: A, n: 2 }, first: false, at: 1_000_040 },
		]);
		expect(b.messages).toEqual([
			{ data: { user: A, n: 2 }, first: false, at: 1_000_040 },
		]);
		expect(hub.state().lastMessageAt).toBe(1_000_040);
	});
	it("subscribes at once when the socket is already open", () => {
		const { hub, last } = setup();
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		last().open();
		hub.subscribe(ch("openOrders"), { user: A }, ear().listener);
		expect(last().subscribes().at(-1)).toEqual({ type: "openOrders", user: A });
	});
	it("withdraws a subscription with its last listener and closes with the last subscription", () => {
		const { hub, last, sockets, clock } = setup();
		const leaveA1 = hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		const leaveA2 = hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		const leaveF = hub.subscribe(ch("userFills"), { user: A }, ear().listener);
		last().open();
		last().ack({ type: "spotState", user: A });
		leaveA1();
		leaveA1();
		expect(last().methods()).toEqual(["subscribe", "subscribe"]);
		leaveA2();
		expect(last().sent.at(-1)).toEqual({
			method: "unsubscribe",
			subscription: { type: "spotState", user: A },
		});
		expect(last().closed).toBe(false);
		leaveF();
		expect(last().closed).toBe(true);
		expect(hub.state().status).toBe("idle");
		// nothing left running
		expect(clock.waiting).toBe(0);
		// and it starts again from nothing
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		expect(sockets).toHaveLength(2);
	});
	it("refuses invalid parameters at once and sends nothing", () => {
		const { hub, sockets } = setup();
		const a = ear();
		const leave = hub.subscribe(ch("userFills"), { user: "0x123" }, a.listener);
		expect(a.states).toEqual([
			{ status: "refused", reason: "user must be a 20-byte address." },
		]);
		leave();
		expect(sockets).toHaveLength(0);
		expect(hub.state().status).toBe("idle");
	});
	it("a listener may leave while it is being called", () => {
		const { hub, last } = setup();
		const heard: number[] = [];
		const leave = hub.subscribe(
			ch("spotState"),
			{ user: A },
			{
				onMessage: () => {
					heard.push(1);
					leave();
				},
			},
		);
		const b = ear();
		hub.subscribe(ch("spotState"), { user: A }, b.listener);
		last().open();
		last().say({ channel: "spotState", data: { user: A } });
		last().say({ channel: "spotState", data: { user: A } });
		expect(heard).toEqual([1]);
		expect(b.messages).toHaveLength(2);
	});
});

describe("routing", () => {
	it("keeps two accounts on one channel apart", () => {
		const { hub, last } = setup();
		const a = ear();
		const b = ear();
		hub.subscribe(ch("userFills"), { user: A }, a.listener);
		hub.subscribe(ch("userFills"), { user: B }, b.listener);
		last().open();
		last().say({
			channel: "userFills",
			data: { user: B.toUpperCase(), fills: [] },
		});
		expect(a.messages).toHaveLength(0);
		expect(b.messages).toHaveLength(1);
	});
	it("keeps the first perp dex and a named one apart", () => {
		const { hub, last } = setup();
		const main = ear();
		const xyz = ear();
		hub.subscribe(ch("clearinghouseState"), { user: A }, main.listener);
		hub.subscribe(
			ch("clearinghouseState"),
			{ user: A, dex: "xyz" },
			xyz.listener,
		);
		last().open();
		last().say({ channel: "clearinghouseState", data: { user: A, dex: "" } });
		last().say({
			channel: "clearinghouseState",
			data: { user: A, dex: "xyz" },
		});
		last().say({
			channel: "clearinghouseState",
			data: { user: A, dex: "xyz" },
		});
		expect(main.messages).toHaveLength(1);
		expect(xyz.messages).toHaveLength(2);
	});
	it("tells coins apart, also in list messages, and gives unlabelled data to the whole channel", () => {
		const { hub, last } = setup();
		const btc = ear();
		const eth = ear();
		const book = ear();
		const orders = ear();
		const events = ear();
		hub.subscribe(ch("trades"), { coin: "BTC" }, btc.listener);
		hub.subscribe(ch("trades"), { coin: "ETH" }, eth.listener);
		hub.subscribe(ch("l2Book"), { coin: "BTC" }, book.listener);
		hub.subscribe(ch("orderUpdates"), { user: A }, orders.listener);
		hub.subscribe(ch("userEvents"), { user: A }, events.listener);
		last().open();
		last().say({ channel: "trades", data: [{ coin: "ETH", px: "1" }] });
		last().say({ channel: "trades", data: [] });
		last().say({ channel: "l2Book", data: { coin: "ETH", levels: [] } });
		last().say({ channel: "l2Book", data: { coin: "BTC", levels: [] } });
		last().say({
			channel: "orderUpdates",
			data: [{ order: { coin: "BTC" }, status: "open" }],
		});
		// the subscription type is userEvents; its messages arrive on "user"
		last().say({ channel: "user", data: { fills: [] } });
		last().say({ channel: "user", data: "odd" });
		last().say({ channel: "nobodyAsked", data: {} });
		expect(eth.messages).toHaveLength(2);
		expect(btc.messages).toHaveLength(1);
		expect(book.messages).toHaveLength(1);
		expect(orders.messages).toHaveLength(1);
		expect(events.messages).toHaveLength(2);
	});
	it("ignores what is not a message, yet counts it as a sign of life", () => {
		const { hub, last, clock } = setup();
		const a = ear();
		hub.subscribe(ch("spotState"), { user: A }, a.listener);
		last().open();
		clock.advance(7);
		for (const junk of ["not json", "null", "5", '{"data":1}', '{"channel":5}'])
			last().say(junk);
		expect(a.messages).toHaveLength(0);
		expect(hub.state().lastMessageAt).toBe(1_000_007);
	});
});

describe("liveness", () => {
	it("pings after ten quiet seconds and reconnects when nothing answers", () => {
		const { hub, last, sockets, clock } = setup();
		const a = ear();
		hub.subscribe(ch("userFills"), { user: A }, a.listener);
		last().open();
		last().ack({ type: "userFills", user: A });
		last().say({
			channel: "userFills",
			data: { user: A, isSnapshot: true, fills: [] },
		});
		clock.advance(9_999);
		expect(last().methods()).toEqual(["subscribe"]);
		clock.advance(1);
		expect(last().methods()).toEqual(["subscribe", "ping"]);
		// silence goes on: one ping, not one per look
		clock.advance(5_000);
		expect(last().methods()).toEqual(["subscribe", "ping"]);
		expect(hub.state().status).toBe("open");
		clock.advance(5_000);
		const dead = sockets[0] as FakeSocket;
		expect(dead.closed).toBe(true);
		expect(hub.state()).toMatchObject({
			status: "waiting",
			failures: 1,
			nextAttemptAt: clock.time + 1000,
		});
		clock.advance(1_000);
		expect(sockets).toHaveLength(2);
		expect(hub.state().status).toBe("connecting");
		last().open();
		// sent again, and its next message is a fresh start
		expect(last().subscribes()).toEqual([{ type: "userFills", user: A }]);
		expect(a.states.at(-1)).toEqual({ status: "pending", reason: null });
		last().say({
			channel: "userFills",
			data: { user: A, isSnapshot: true, fills: [] },
		});
		expect(a.messages.map((m) => m.first)).toEqual([true, true]);
		expect(a.status()).toBe("live");
		expect(hub.state()).toMatchObject({ status: "open", failures: 0 });
		// what the dead socket says afterwards is not heard
		dead.onmessage?.({ data: '{"channel":"userFills","data":{}}' });
		dead.onclose?.({});
		expect(a.messages).toHaveLength(2);
		expect(hub.state().status).toBe("open");
	});
	it("a pong keeps the socket, and the next silence is pinged again", () => {
		const { hub, last, sockets, clock } = setup();
		hub.subscribe(ch("userFills"), { user: A }, ear().listener);
		last().open();
		clock.advance(10_000);
		expect(last().methods()).toEqual(["subscribe", "ping"]);
		clock.advance(300);
		last().say({ channel: "pong" });
		clock.advance(9_700);
		expect(last().methods()).toEqual(["subscribe", "ping"]);
		clock.advance(5_000);
		expect(last().methods()).toEqual(["subscribe", "ping", "ping"]);
		last().say({ channel: "pong" });
		clock.advance(9_000);
		expect(sockets).toHaveLength(1);
		expect(hub.state().status).toBe("open");
	});
	it("never pings a socket that keeps talking", () => {
		const { hub, last, clock } = setup();
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		last().open();
		for (let i = 0; i < 30; i++) {
			clock.advance(5_000);
			last().say({ channel: "spotState", data: { user: A } });
		}
		expect(last().methods()).toEqual(["subscribe"]);
	});
	it("a socket that opens and says nothing is pinged from the moment it opened", () => {
		const { hub, last, clock } = setup();
		hub.subscribe(ch("userFills"), { user: A }, ear().listener);
		clock.advance(60_000);
		last().open();
		clock.advance(5_000);
		expect(last().methods()).toEqual(["subscribe"]);
		clock.advance(5_000);
		expect(last().methods()).toEqual(["subscribe", "ping"]);
	});
	it("waits longer after each failure in a row, and starts over once a message arrives", () => {
		const { hub, last, sockets, clock } = setup({ random: 1 });
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		const waits: number[] = [];
		for (let i = 0; i < 7; i++) {
			// refused before it opens (the server is down, or the address is rate limited)
			if (i % 2) last().drop();
			else last().onerror?.({});
			const s = hub.state();
			expect(s.status).toBe("waiting");
			expect(s.failures).toBe(i + 1);
			waits.push((s.nextAttemptAt as number) - clock.time);
			clock.advance(waits[i] as number);
			expect(sockets).toHaveLength(i + 2);
		}
		expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
		last().open();
		// open is not proof: only a message is
		expect(hub.state().failures).toBe(7);
		last().say({ channel: "spotState", data: { user: A } });
		expect(hub.state().failures).toBe(0);
		last().drop();
		expect((hub.state().nextAttemptAt as number) - clock.time).toBe(1000);
	});
	it("spreads reconnects with the random source", () => {
		const { hub, last, clock } = setup({ random: 0 });
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		last().drop();
		expect((hub.state().nextAttemptAt as number) - clock.time).toBe(500);
	});
	it("treats a socket that cannot be created, or cannot send, as lost", () => {
		let blocked = true;
		const { hub, sockets, clock, last } = setup({ failCreate: () => blocked });
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		expect(sockets).toHaveLength(0);
		expect(hub.state()).toMatchObject({ status: "waiting", failures: 1 });
		blocked = false;
		clock.advance(1_000);
		expect(sockets).toHaveLength(1);
		last().failSend = true;
		last().open();
		expect(hub.state()).toMatchObject({ status: "waiting", failures: 2 });
		expect(last().closed).toBe(true);
	});
	it("retryNow does not wait out the schedule", () => {
		const { hub, last, sockets } = setup();
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		// nothing to hurry while connecting
		hub.retryNow();
		expect(sockets).toHaveLength(1);
		last().drop();
		hub.retryNow();
		expect(sockets).toHaveLength(2);
		expect(hub.state()).toMatchObject({
			status: "connecting",
			nextAttemptAt: null,
		});
	});
	it("a socket lost after the last subscription left is not reopened", () => {
		const { hub, last, sockets, clock } = setup();
		const leave = hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		const socket = last();
		const onclose = socket.onclose;
		leave();
		onclose?.({});
		clock.advance(120_000);
		expect(sockets).toHaveLength(1);
		expect(hub.state().status).toBe("idle");
	});
});

describe("refusals", () => {
	const quoted = (kind: string, sub: Record<string, unknown>) => ({
		channel: "error",
		data: `${kind}: ${JSON.stringify(sub)}`,
	});
	it("refuses the subscription an error quotes and leaves the others alone", () => {
		const { hub, last } = setup();
		const fills = ear();
		const spot = ear();
		const other = ear();
		hub.subscribe(ch("userFills"), { user: A }, fills.listener);
		hub.subscribe(ch("spotState"), { user: A }, spot.listener);
		hub.subscribe(ch("userFills"), { user: B }, other.listener);
		last().open();
		last().ack({ type: "spotState", user: A });
		last().say(
			quoted("Cannot track more than 10 total users", {
				type: "userFills",
				user: A.toUpperCase().replace("0X", "0x"),
			}),
		);
		expect(fills.states.at(-1)).toEqual({
			status: "refused",
			reason: `Cannot track more than 10 total users: {"type":"userFills","user":"${A.toUpperCase().replace("0X", "0x")}"}`,
		});
		expect(spot.status()).toBe("live");
		expect(other.status()).toBe(undefined);
		// nothing more is delivered to it, even if the server sends some
		last().say({ channel: "userFills", data: { user: A, fills: [] } });
		expect(fills.messages).toHaveLength(0);
	});
	it("takes an error that quotes nothing as an answer to whatever is waiting", () => {
		const { hub, last } = setup();
		const live = ear();
		const waiting1 = ear();
		const waiting2 = ear();
		hub.subscribe(ch("spotState"), { user: A }, live.listener);
		hub.subscribe(ch("userFills"), { user: A }, waiting1.listener);
		hub.subscribe(ch("openOrders"), { user: A }, waiting2.listener);
		last().open();
		last().ack({ type: "spotState", user: A });
		last().say({ channel: "error", data: "Too many users" });
		expect(live.status()).toBe("live");
		expect(waiting1.states.at(-1)).toEqual({
			status: "refused",
			reason: "Too many users",
		});
		expect(waiting2.status()).toBe("refused");
		// an error with no text still refuses, in our words
		const { hub: hub2, last: last2 } = setup();
		const e = ear();
		hub2.subscribe(ch("userFills"), { user: A }, e.listener);
		last2().open();
		last2().say({ channel: "error", data: { code: 1 } });
		expect(e.states.at(-1)?.reason).toBe(
			"Hyperliquid refused the subscription.",
		);
	});
	it("'Already subscribed' means it is live; 'Already unsubscribed' means nothing", () => {
		const { hub, last } = setup();
		const a = ear();
		const b = ear();
		hub.subscribe(ch("spotState"), { user: A }, a.listener);
		hub.subscribe(ch("userFills"), { user: A }, b.listener);
		last().open();
		last().say(quoted("Already unsubscribed", { type: "userFills", user: A }));
		expect(b.status()).toBe(undefined);
		last().say(
			quoted("Already subscribed", {
				type: "spotState",
				user: A,
				ignorePortfolioMargin: false,
			}),
		);
		expect(a.status()).toBe("live");
		expect(b.status()).toBe(undefined);
		// said again about a live one: still live
		last().say(quoted("Already subscribed", { type: "spotState", user: A }));
		expect(a.states).toEqual([{ status: "live", reason: null }]);
	});
	it("refuses what is never acknowledged, unless data shows it is alive", () => {
		const { hub, last, clock } = setup();
		const silent = ear();
		const talking = ear();
		hub.subscribe(ch("userFills"), { user: A }, silent.listener);
		hub.subscribe(ch("spotState"), { user: A }, talking.listener);
		last().open();
		clock.advance(4_000);
		last().say({ channel: "spotState", data: { user: A } });
		expect(talking.status()).toBe("live");
		clock.advance(HUB_DEFAULTS.ackMs - 4_001);
		expect(silent.status()).toBe(undefined);
		clock.advance(1);
		expect(silent.states).toEqual([
			{
				status: "refused",
				reason: "Hyperliquid did not acknowledge the subscription.",
			},
		]);
		expect(talking.status()).toBe("live");
	});
	it("asks again for what was refused: on retryNow, and on every reconnect", () => {
		const { hub, last, clock } = setup();
		const a = ear();
		const leave = hub.subscribe(ch("userFills"), { user: A }, a.listener);
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		last().open();
		last().ack({ type: "spotState", user: A });
		last().say(
			quoted("Cannot track more than 10 total users", {
				type: "userFills",
				user: A,
			}),
		);
		expect(a.status()).toBe("refused");
		hub.retryNow();
		expect(last().subscribes()).toEqual([
			{ type: "userFills", user: A },
			{ type: "spotState", user: A },
			{ type: "userFills", user: A },
		]);
		expect(a.status()).toBe("pending");
		last().ack({ type: "userFills", user: A });
		expect(a.status()).toBe("live");
		// refused again, then the socket drops: the new socket asks for it once more
		last().say(quoted("Nope", { type: "userFills", user: A }));
		last().drop();
		clock.advance(1_000);
		last().open();
		expect(last().subscribes()).toContainEqual({ type: "userFills", user: A });
		// a refused subscription is not withdrawn: the server never had it
		last().say(quoted("Nope", { type: "userFills", user: A }));
		leave();
		expect(last().methods()).not.toContain("unsubscribe");
	});
});

describe("suspend, resume, close", () => {
	it("suspend closes and keeps the subscriptions; resume sends them again", () => {
		const { hub, last, sockets, clock } = setup();
		const a = ear();
		hub.subscribe(ch("spotState"), { user: A }, a.listener);
		last().open();
		last().say({ channel: "spotState", data: { user: A } });
		hub.suspend();
		hub.suspend();
		expect(last().closed).toBe(true);
		expect(hub.state().status).toBe("suspended");
		clock.advance(300_000);
		expect(sockets).toHaveLength(1);
		expect(clock.waiting).toBe(0);
		// subscribing while suspended waits for resume
		hub.subscribe(ch("userFills"), { user: A }, ear().listener);
		expect(sockets).toHaveLength(1);
		hub.retryNow();
		expect(sockets).toHaveLength(1);
		hub.resume();
		hub.resume();
		expect(sockets).toHaveLength(2);
		last().open();
		expect(last().subscribes()).toEqual([
			{ type: "spotState", user: A },
			{ type: "userFills", user: A },
		]);
		last().say({ channel: "spotState", data: { user: A } });
		expect(a.messages.map((m) => m.first)).toEqual([true, true]);
	});
	it("suspend cancels a scheduled attempt; resume with nothing to listen to is idle", () => {
		const { hub, last, sockets, clock } = setup();
		const leave = hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		last().drop();
		expect(hub.state().status).toBe("waiting");
		hub.suspend();
		expect(hub.state()).toMatchObject({
			status: "suspended",
			failures: 0,
			nextAttemptAt: null,
		});
		clock.advance(60_000);
		expect(sockets).toHaveLength(1);
		leave();
		expect(hub.state().status).toBe("suspended");
		hub.resume();
		expect(hub.state().status).toBe("idle");
		expect(sockets).toHaveLength(1);
	});
	it("close drops everything and the hub can be used again", () => {
		const { hub, last, sockets, clock } = setup();
		const a = ear();
		const leave = hub.subscribe(ch("spotState"), { user: A }, a.listener);
		last().open();
		const first = last();
		hub.close();
		expect(first.closed).toBe(true);
		expect(hub.state().status).toBe("idle");
		expect(clock.waiting).toBe(0);
		expect(hub.subscriptionState(ch("spotState"), { user: A })).toBeNull();
		// leaving after close is harmless, also once the same subscription exists again
		const b = ear();
		hub.subscribe(ch("spotState"), { user: A }, b.listener);
		leave();
		expect(sockets).toHaveLength(2);
		expect(last().closed).toBe(false);
		last().open();
		last().say({ channel: "spotState", data: { user: A } });
		expect(a.messages).toHaveLength(0);
		expect(b.messages).toHaveLength(1);
	});
});

describe("defaults and rough edges", () => {
	it("runs on the real clock and timers when none are passed", () => {
		vi.useFakeTimers();
		try {
			const sockets: FakeSocket[] = [];
			const hub = new WsHub({
				url: "wss://example.invalid/ws",
				createSocket: () => {
					const s = new FakeSocket();
					sockets.push(s);
					return s;
				},
			});
			hub.subscribe(ch("userFills"), { user: A }, ear().listener);
			sockets[0]?.open();
			vi.advanceTimersByTime(HUB_DEFAULTS.quietMs);
			expect(sockets[0]?.methods()).toEqual(["subscribe", "ping"]);
			vi.advanceTimersByTime(HUB_DEFAULTS.pongMs);
			expect(hub.state().status).toBe("waiting");
			const wait = (hub.state().nextAttemptAt as number) - Date.now();
			expect(wait).toBeGreaterThanOrEqual(500);
			expect(wait).toBeLessThanOrEqual(1000);
			hub.close();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
	it("a socket that throws on close is let go all the same", () => {
		const { hub, last } = setup();
		const leave = hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		last().failClose = true;
		last().open();
		leave();
		expect(hub.state().status).toBe("idle");
	});
	it("a socket that dies while the last subscription is withdrawn ends idle, not retrying", () => {
		const { hub, last, sockets, clock } = setup();
		const leave = hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		last().open();
		last().ack({ type: "spotState", user: A });
		last().failSend = true;
		leave();
		expect(hub.state()).toMatchObject({ status: "idle", failures: 0 });
		clock.advance(60_000);
		expect(sockets).toHaveLength(1);
		expect(clock.waiting).toBe(0);
	});
});

describe("state", () => {
	it("is the same object until something changes, and watchers hear each change once", () => {
		const { hub, last } = setup();
		const seen: HubState[] = [];
		const unwatch = hub.watch((s) => void seen.push(s));
		const s0 = hub.state();
		expect(hub.state()).toBe(s0);
		hub.subscribe(ch("spotState"), { user: A }, ear().listener);
		last().open();
		last().say({ channel: "spotState", data: { user: A } });
		// same instant, nothing new to report
		last().say({ channel: "spotState", data: { user: A } });
		expect(seen.map((s) => s.status)).toEqual(["connecting", "open", "open"]);
		expect(seen.at(-1)).toBe(hub.state());
		unwatch();
		hub.close();
		expect(seen).toHaveLength(3);
	});
});
