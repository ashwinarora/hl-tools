/**
 * One WebSocket connection shared by every subscription of a page.
 *
 * - Connects when the first subscription is added and closes when the last
 *   one leaves. A subscription is sent once, however many listeners it has.
 * - Liveness: after `quietMs` without a message of any kind a ping is sent;
 *   no message within `pongMs` of it and the socket is treated as dead. (The
 *   server closes a connection it has not written to for 60 s, and a laptop
 *   that slept holds a socket that never reports its own death.)
 * - A lost socket is reopened on a slowing, jittered schedule. Every
 *   subscription is sent again; no channel has a resume cursor, so the next
 *   message of each is flagged `first` and state is rebuilt from it.
 * - A subscription the server answers with an error, or never acknowledges,
 *   becomes `refused`. The others carry on.
 *
 * Nothing here touches a browser API: the socket constructor, the clock, the
 * timers and the randomness are passed in.
 */
import type { WsChannelSpec } from "../rules/websocket.ts";
import { buildSubscription, isAckFor } from "./subscription.ts";

/** The part of a WebSocket the hub uses. */
export interface HubSocket {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: { readonly data: unknown }) => void) | null;
	onclose: ((event: unknown) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export interface HubTimers {
	set(fn: () => void, ms: number): unknown;
	clear(id: unknown): void;
}

export interface HubOptions {
	readonly url: string;
	readonly createSocket: (url: string) => HubSocket;
	readonly now?: () => number;
	readonly timers?: HubTimers;
	/** In [0, 1): spreads reconnects so tabs do not return in step. */
	readonly random?: () => number;
	/** How often liveness is looked at. */
	readonly tickMs?: number;
	/** Silence after which a ping is sent. */
	readonly quietMs?: number;
	/** How long a ping may stay unanswered. */
	readonly pongMs?: number;
	/** How long a subscription may stay unacknowledged. */
	readonly ackMs?: number;
}

export const HUB_DEFAULTS = {
	tickMs: 5_000,
	quietMs: 10_000,
	pongMs: 10_000,
	ackMs: 10_000,
	/** First wait after a lost socket; doubles up to `backoffMaxMs`. */
	backoffFirstMs: 1_000,
	backoffMaxMs: 30_000,
} as const;

/**
 * How long to wait before the `failures`-th attempt in a row (1 is the first
 * retry): 1 s, 2 s, 4 s… capped at 30 s, each shortened by up to half at random.
 */
export function hubBackoff(failures: number, random: number): number {
	const step = Math.max(1, Math.floor(failures)) - 1;
	const full = Math.min(
		HUB_DEFAULTS.backoffMaxMs,
		HUB_DEFAULTS.backoffFirstMs * 2 ** Math.min(step, 16),
	);
	const r = Math.min(Math.max(random, 0), 1);
	return Math.round(full * (0.5 + r / 2));
}

/**
 * idle        no subscriptions, no socket
 * connecting  a socket is being opened
 * open        the socket is open (subscriptions may still be pending)
 * waiting     the socket was lost; the next attempt is scheduled
 * suspended   closed on purpose (`suspend`); subscriptions are kept
 */
export type HubStatus =
	| "idle"
	| "connecting"
	| "open"
	| "waiting"
	| "suspended";

export interface HubState {
	readonly status: HubStatus;
	/** Attempts lost in a row; 0 again once a message arrives. */
	readonly failures: number;
	/** When the last message of any kind arrived (the injected clock); null before the first. */
	readonly lastMessageAt: number | null;
	/** While `waiting`: when the next attempt is due. */
	readonly nextAttemptAt: number | null;
}

/**
 * pending  sent (or waiting for the socket), not yet acknowledged
 * live     acknowledged, or already delivering
 * refused  the server answered with an error, did not acknowledge, or the parameters are invalid
 */
export type HubSubscriptionStatus = "pending" | "live" | "refused";

export interface HubSubscriptionState {
	readonly status: HubSubscriptionStatus;
	/** Why it was refused, in the server's words where it gave any. */
	readonly reason: string | null;
}

export interface HubMessage {
	/** The `data` field of the server's message. */
	readonly data: unknown;
	/** The first message since this subscription was sent or sent again: rebuild from it. */
	readonly first: boolean;
	/** When it arrived (the injected clock). */
	readonly at: number;
}

export interface HubListener {
	readonly onMessage: (message: HubMessage) => void;
	/** Called on every change after subscribing (and at once when the parameters are invalid). */
	readonly onStatus?: (state: HubSubscriptionState) => void;
}

interface Entry {
	readonly id: string;
	readonly subscription: Readonly<Record<string, unknown>>;
	readonly channel: string;
	readonly listeners: Set<HubListener>;
	status: HubSubscriptionStatus;
	reason: string | null;
	/** Sent on the current socket. */
	sent: boolean;
	first: boolean;
	ackTimer: unknown;
}

const NOT_ACKNOWLEDGED = "Hyperliquid did not acknowledge the subscription.";

function idOf(subscription: Readonly<Record<string, unknown>>): string {
	return JSON.stringify(
		Object.keys(subscription)
			.sort()
			.map((k) => [k, subscription[k]]),
	);
}

/** Whether a data message on the entry's channel is for this entry and not for a sibling. */
function isFor(entry: Entry, data: unknown): boolean {
	const head: unknown = Array.isArray(data) ? data[0] : data;
	if (!head || typeof head !== "object") return true;
	const d = head as Readonly<Record<string, unknown>>;
	const sub = entry.subscription;
	if (
		typeof d.user === "string" &&
		typeof sub.user === "string" &&
		d.user.toLowerCase() !== sub.user.toLowerCase()
	)
		return false;
	// an empty dex is left out of the subscription and comes back as ""
	if (!Array.isArray(data) && typeof d.dex === "string" && "user" in sub)
		if (d.dex !== (typeof sub.dex === "string" ? sub.dex : "")) return false;
	if (
		typeof d.coin === "string" &&
		typeof sub.coin === "string" &&
		d.coin !== sub.coin
	)
		return false;
	return true;
}

export class WsHub {
	private readonly url: string;
	private readonly createSocket: (url: string) => HubSocket;
	private readonly now: () => number;
	private readonly timers: HubTimers;
	private readonly random: () => number;
	private readonly tickMs: number;
	private readonly quietMs: number;
	private readonly pongMs: number;
	private readonly ackMs: number;

	private readonly entries = new Map<string, Entry>();
	private readonly watchers = new Set<(state: HubState) => void>();
	private socket: HubSocket | null = null;
	private isOpen = false;
	private status: HubStatus = "idle";
	private failures = 0;
	private lastMessageAt: number | null = null;
	private nextAttemptAt: number | null = null;
	private pingSentAt: number | null = null;
	/** When the current socket opened: silence is counted from here until a message arrives. */
	private openedAt = 0;
	private tickTimer: unknown = null;
	private retryTimer: unknown = null;
	private current: HubState;

	constructor(options: HubOptions) {
		this.url = options.url;
		this.createSocket = options.createSocket;
		this.now = options.now ?? Date.now;
		this.timers = options.timers ?? {
			set: (fn, ms) => setTimeout(fn, ms),
			clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
		};
		this.random = options.random ?? Math.random;
		this.tickMs = options.tickMs ?? HUB_DEFAULTS.tickMs;
		this.quietMs = options.quietMs ?? HUB_DEFAULTS.quietMs;
		this.pongMs = options.pongMs ?? HUB_DEFAULTS.pongMs;
		this.ackMs = options.ackMs ?? HUB_DEFAULTS.ackMs;
		this.current = this.read();
	}

	/** The same object until something changes (fit for useSyncExternalStore). */
	state(): HubState {
		return this.current;
	}

	/** Be told when `state()` changes. */
	watch(fn: (state: HubState) => void): () => void {
		this.watchers.add(fn);
		return () => {
			this.watchers.delete(fn);
		};
	}

	/** Where a subscription stands; null when nobody holds it. */
	subscriptionState(
		spec: WsChannelSpec,
		params: Readonly<Record<string, string>>,
	): HubSubscriptionState | null {
		const built = buildSubscription(spec, params);
		const e = built.subscription
			? this.entries.get(idOf(built.subscription))
			: undefined;
		return e ? { status: e.status, reason: e.reason } : null;
	}

	/**
	 * Listen to a channel. The subscription is sent when its first listener
	 * arrives and withdrawn when the last one leaves; a listener that joins a
	 * subscription already live hears messages from then on.
	 */
	subscribe(
		spec: WsChannelSpec,
		params: Readonly<Record<string, string>>,
		listener: HubListener,
	): () => void {
		const built = buildSubscription(spec, params);
		if (!built.subscription) {
			listener.onStatus?.({
				status: "refused",
				reason: built.issues[0]?.message ?? "Invalid subscription.",
			});
			return () => {};
		}
		const id = idOf(built.subscription);
		let entry = this.entries.get(id);
		if (!entry) {
			entry = {
				id,
				subscription: built.subscription,
				channel: spec.channel,
				listeners: new Set(),
				status: "pending",
				reason: null,
				sent: false,
				first: true,
				ackTimer: null,
			};
			this.entries.set(id, entry);
			if (this.isOpen) this.sendSubscribe(entry);
			else if (this.status === "idle") this.connect();
		}
		entry.listeners.add(listener);
		const held = entry;
		let left = false;
		return () => {
			if (left) return;
			left = true;
			held.listeners.delete(listener);
			if (held.listeners.size === 0 && this.entries.get(id) === held)
				this.drop(held);
		};
	}

	/** Close the socket and keep the subscriptions (a hidden tab). `resume` reopens it. */
	suspend(): void {
		if (this.status === "suspended") return;
		this.closeSocket();
		this.clearRetry();
		this.failures = 0;
		this.setStatus("suspended");
	}

	resume(): void {
		if (this.status !== "suspended") return;
		if (this.entries.size === 0) this.setStatus("idle");
		else this.connect();
	}

	/** Do not wait out the schedule (the network came back; someone pressed refresh). */
	retryNow(): void {
		if (this.status === "waiting") {
			this.clearRetry();
			this.connect();
			return;
		}
		// on an open socket: ask again for what was refused
		if (this.isOpen)
			for (const e of this.entries.values())
				if (e.status === "refused") this.sendSubscribe(e);
	}

	/** Drop every subscription and close. The hub can be used again afterwards. */
	close(): void {
		for (const e of this.entries.values()) this.clearAck(e);
		this.entries.clear();
		this.closeSocket();
		this.clearRetry();
		this.failures = 0;
		this.setStatus("idle");
	}

	// ───────────────────────────── socket ─────────────────────────────

	private connect(): void {
		this.clearRetry();
		this.closeSocket();
		this.setStatus("connecting");
		let socket: HubSocket;
		try {
			socket = this.createSocket(this.url);
		} catch {
			this.lost();
			return;
		}
		this.socket = socket;
		socket.onopen = () => {
			if (this.socket !== socket) return;
			this.isOpen = true;
			this.openedAt = this.now();
			this.pingSentAt = null;
			this.setStatus("open");
			for (const e of this.entries.values()) this.sendSubscribe(e);
			this.scheduleTick();
		};
		socket.onmessage = (event) => {
			if (this.socket !== socket) return;
			this.receive(event.data);
		};
		const gone = () => {
			if (this.socket !== socket) return;
			this.lost();
		};
		socket.onclose = gone;
		socket.onerror = gone;
	}

	/** Let go of the socket without reacting to its last events. */
	private closeSocket(): void {
		const socket = this.socket;
		this.socket = null;
		this.isOpen = false;
		this.pingSentAt = null;
		if (this.tickTimer !== null) this.timers.clear(this.tickTimer);
		this.tickTimer = null;
		for (const e of this.entries.values()) {
			this.clearAck(e);
			e.sent = false;
		}
		if (!socket) return;
		socket.onopen = null;
		socket.onmessage = null;
		socket.onclose = null;
		socket.onerror = null;
		try {
			socket.close(1000);
		} catch {
			// already closed, or never opened
		}
	}

	/** The socket closed, failed to open, or stopped answering. */
	private lost(): void {
		this.closeSocket();
		if (this.entries.size === 0) {
			this.setStatus("idle");
			return;
		}
		this.failures += 1;
		const wait = hubBackoff(this.failures, this.random());
		this.nextAttemptAt = this.now() + wait;
		this.retryTimer = this.timers.set(() => {
			this.retryTimer = null;
			this.connect();
		}, wait);
		this.setStatus("waiting");
	}

	private clearRetry(): void {
		if (this.retryTimer !== null) this.timers.clear(this.retryTimer);
		this.retryTimer = null;
		this.nextAttemptAt = null;
	}

	private send(message: unknown): void {
		if (!this.socket || !this.isOpen) return;
		try {
			this.socket.send(JSON.stringify(message));
		} catch {
			this.lost();
		}
	}

	// ───────────────────────────── liveness ─────────────────────────────

	private scheduleTick(): void {
		this.tickTimer = this.timers.set(() => {
			this.tickTimer = null;
			if (!this.isOpen) return;
			const now = this.now();
			const heard = Math.max(this.lastMessageAt ?? 0, this.openedAt);
			if (this.pingSentAt !== null && heard < this.pingSentAt) {
				if (now - this.pingSentAt >= this.pongMs) {
					this.lost();
					return;
				}
			} else if (now - heard >= this.quietMs) {
				this.pingSentAt = now;
				this.send({ method: "ping" });
				if (!this.isOpen) return;
			}
			this.scheduleTick();
		}, this.tickMs);
	}

	// ───────────────────────────── subscriptions ─────────────────────────────

	private sendSubscribe(entry: Entry): void {
		this.clearAck(entry);
		entry.sent = true;
		entry.first = true;
		this.setEntry(entry, "pending", null);
		entry.ackTimer = this.timers.set(() => {
			entry.ackTimer = null;
			if (entry.status === "pending")
				this.setEntry(entry, "refused", NOT_ACKNOWLEDGED);
		}, this.ackMs);
		this.send({ method: "subscribe", subscription: entry.subscription });
	}

	private drop(entry: Entry): void {
		this.clearAck(entry);
		this.entries.delete(entry.id);
		if (entry.sent && entry.status !== "refused")
			this.send({ method: "unsubscribe", subscription: entry.subscription });
		if (this.entries.size > 0) return;
		this.closeSocket();
		this.clearRetry();
		this.failures = 0;
		if (this.status !== "suspended") this.setStatus("idle");
	}

	private clearAck(entry: Entry): void {
		if (entry.ackTimer !== null) this.timers.clear(entry.ackTimer);
		entry.ackTimer = null;
	}

	private setEntry(
		entry: Entry,
		status: HubSubscriptionStatus,
		reason: string | null,
	): void {
		if (entry.status === status && entry.reason === reason) return;
		entry.status = status;
		entry.reason = reason;
		if (status !== "pending") this.clearAck(entry);
		for (const l of [...entry.listeners]) l.onStatus?.({ status, reason });
	}

	// ───────────────────────────── messages ─────────────────────────────

	private receive(raw: unknown): void {
		const at = this.now();
		this.lastMessageAt = at;
		this.failures = 0;
		this.publish();
		let msg: { channel?: unknown; data?: unknown };
		try {
			msg = JSON.parse(String(raw)) as typeof msg;
		} catch {
			return;
		}
		if (!msg || typeof msg !== "object" || typeof msg.channel !== "string")
			return;
		const channel = msg.channel;
		if (channel === "pong") return;
		if (channel === "subscriptionResponse") {
			for (const e of this.entries.values())
				if (e.sent && e.status === "pending" && isAckFor(msg, e.subscription))
					this.setEntry(e, "live", null);
			return;
		}
		if (channel === "error") {
			this.refuse(typeof msg.data === "string" ? msg.data : "");
			return;
		}
		for (const e of [...this.entries.values()]) {
			if (e.channel !== channel || !e.sent || e.status === "refused") continue;
			if (!isFor(e, msg.data)) continue;
			// data without an ack: the ack was lost, the subscription is plainly alive
			this.setEntry(e, "live", null);
			const first = e.first;
			e.first = false;
			for (const l of [...e.listeners])
				l.onMessage({ data: msg.data, first, at });
		}
	}

	/**
	 * An error names no request id. The server usually quotes the subscription
	 * it is about; when it does not, the error is about whatever is waiting for
	 * an answer.
	 */
	private refuse(text: string): void {
		if (text.startsWith("Already unsubscribed")) return;
		const sent = [...this.entries.values()].filter((e) => e.sent);
		const quoted = sent.filter((e) => {
			if (!text.includes(`"type":"${String(e.subscription.type)}"`))
				return false;
			return ["user", "coin", "dex", "interval"].every((k) => {
				const v = e.subscription[k];
				return (
					typeof v !== "string" ||
					v === "" ||
					text.toLowerCase().includes(`"${k}":"${v.toLowerCase()}"`)
				);
			});
		});
		if (text.startsWith("Already subscribed")) {
			for (const e of quoted)
				if (e.status === "pending") this.setEntry(e, "live", null);
			return;
		}
		const targets =
			quoted.length > 0 ? quoted : sent.filter((e) => e.status === "pending");
		for (const e of targets)
			this.setEntry(
				e,
				"refused",
				text || "Hyperliquid refused the subscription.",
			);
	}

	// ───────────────────────────── state ─────────────────────────────

	private read(): HubState {
		return {
			status: this.status,
			failures: this.failures,
			lastMessageAt: this.lastMessageAt,
			nextAttemptAt: this.nextAttemptAt,
		};
	}

	private setStatus(status: HubStatus): void {
		this.status = status;
		if (status !== "waiting") this.nextAttemptAt = null;
		this.publish();
	}

	private publish(): void {
		const next = this.read();
		const prev = this.current;
		if (
			prev.status === next.status &&
			prev.failures === next.failures &&
			prev.lastMessageAt === next.lastMessageAt &&
			prev.nextAttemptAt === next.nextAttemptAt
		)
			return;
		this.current = next;
		for (const w of [...this.watchers]) w(next);
	}
}
