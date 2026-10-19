/** A socket and a clock a test controls, for code built on the core's WsHub. */
import { type HubSocket, WsHub } from "@hl-tools/core";

export class FakeClock {
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

export class FakeSocket implements HubSocket {
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { readonly data: unknown }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly sent: Record<string, unknown>[] = [];
	closed = false;
	send(data: string) {
		this.sent.push(JSON.parse(data) as Record<string, unknown>);
	}
	close() {
		this.closed = true;
	}
	/** The server side. */
	open() {
		this.onopen?.({});
	}
	say(channel: string, data: unknown) {
		this.onmessage?.({ data: JSON.stringify({ channel, data }) });
	}
	/** Acknowledge everything asked for and not yet acknowledged. */
	ackAll() {
		for (const m of this.sent.splice(0))
			if (m.method === "subscribe")
				this.say("subscriptionResponse", {
					method: "subscribe",
					subscription: m.subscription,
				});
			else this.log.push(m);
	}
	/** Messages other than subscribes, kept when `ackAll` clears the queue. */
	readonly log: Record<string, unknown>[] = [];
	drop() {
		this.onclose?.({});
	}
	types(method: string) {
		return [...this.log, ...this.sent]
			.filter((m) => m.method === method)
			.map((m) => (m.subscription as { type: string }).type);
	}
}

/** A hub on a fake socket and clock. `last()` is the socket currently in use. */
export function fakeHub() {
	const clock = new FakeClock();
	const sockets: FakeSocket[] = [];
	let made = 0;
	const hub = new WsHub({
		url: "wss://example.invalid/ws",
		createSocket: () => {
			const s = new FakeSocket();
			sockets.push(s);
			return s;
		},
		now: clock.now,
		timers: clock.timers,
		random: () => 1,
	});
	return {
		clock,
		sockets,
		hub,
		last: () => sockets.at(-1) as FakeSocket,
		/** Hand the hub out the way the browser registry does, counting how often. */
		make: () => {
			made++;
			return hub;
		},
		made: () => made,
	};
}
