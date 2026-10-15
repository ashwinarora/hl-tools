/**
 * What one account holds and what happened to it, kept current from the
 * socket hub: the store behind the live tables. No React and no browser API
 * here; the hub is handed in, so the same code runs against a fake socket.
 *
 * Three groups of subscriptions, each held only while a screen wants it:
 *   holdings  perps (first dex), spot balances, open orders, and one look at
 *             every perp dex to learn whether another one holds anything
 *   ledger    deposits, withdrawals and transfers: what a pending proposal
 *             is checked against
 *   trades    fills, order history, funding: only where they are shown
 * A screen that shows everything asks for "history", the ledger and the
 * trades together. A group that nobody wants any more is kept for a short grace period, so
 * moving between two pages of the same treasury does not resubscribe. That
 * holds for the same account only: the moment a screen starts following
 * another account, everything kept for the previous one is let go
 * (`LiveAccounts`), so a page never follows two treasuries.
 */
import {
	FILL_MERGE,
	type FillRow,
	FUNDING_MERGE,
	type FundingRow,
	type HubMessage,
	type HubState,
	type HubSubscriptionState,
	type HubTimers,
	LEDGER_MERGE,
	type LedgerRow,
	leavesGap,
	type MergeOptions,
	mergeRows,
	ORDER_HISTORY_MERGE,
	type OrderHistoryRow,
	type OrderRow,
	type PerpAccount,
	parseAllDexs,
	parseFills,
	parseFundings,
	parseLedger,
	parseOpenOrders,
	parseOrderHistory,
	parsePerpAccount,
	parseSpotState,
	perpAccountInUse,
	type RowBatch,
	type SpotBalanceRow,
	shareStructure,
	type WsChannelSpec,
	type WsHub,
	wsChannel,
} from "@hl-tools/core";

export type LiveGroup = "holdings" | "ledger" | "trades";

/** What a screen asks for: one group, or "history" for the ledger and the trades together. */
export type LiveWant = LiveGroup | "history";

export type LivePart =
	| "perp"
	| "spot"
	| "openOrders"
	| "allDexs"
	| "ledger"
	| "fills"
	| "orderHistory"
	| "fundings";

export type HistoryPart = "ledger" | "fills" | "orderHistory" | "fundings";

const CHANNEL: Record<LivePart, string> = {
	perp: "clearinghouseState",
	spot: "spotState",
	openOrders: "openOrders",
	allDexs: "allDexsClearinghouseState",
	ledger: "userNonFundingLedgerUpdates",
	fills: "userFills",
	orderHistory: "userHistoricalOrders",
	fundings: "userFundings",
};

export const LIVE_GROUPS: Record<LiveGroup, readonly LivePart[]> = {
	holdings: ["perp", "spot", "openOrders", "allDexs"],
	ledger: ["ledger"],
	trades: ["fills", "orderHistory", "fundings"],
};

/**
 * connecting    first connection, nothing shown yet
 * live          every holdings subscription is acknowledged and current
 * reconnecting  the connection was lost (or the tab was away); what is shown may be behind
 * down          several attempts in a row failed; still trying
 * refused       Hyperliquid will not send live holdings to this connection (a limit was reached)
 */
export type LiveStatus =
	| "connecting"
	| "live"
	| "reconnecting"
	| "down"
	| "refused";

/** Attempts lost in a row before "reconnecting" becomes "down". */
export const DOWN_AFTER = 3;

export interface LiveAccount {
	readonly status: LiveStatus;
	/**
	 * While the status is not "live": the last moment Hyperliquid was heard
	 * from while it was, which is how old the figures shown may be. Null while
	 * live (they are current), and while they have never been live.
	 */
	readonly asOf: number | null;
	/** Parts Hyperliquid refused, with its words; the others carry on. */
	readonly refused: readonly {
		readonly part: LivePart;
		readonly reason: string;
	}[];
	/** Perps on the first dex. Null until the first message. */
	readonly perp: PerpAccount | null;
	readonly spot: readonly SpotBalanceRow[] | null;
	readonly openOrders: readonly OrderRow[] | null;
	/** Perp dexes other than the first that hold value or a position; null until known. */
	readonly otherDexes: readonly string[] | null;
	/** Newest first. Null until the snapshot arrives; then empty means none. */
	readonly ledger: readonly LedgerRow[] | null;
	readonly fills: readonly FillRow[] | null;
	readonly orderHistory: readonly OrderHistoryRow[] | null;
	readonly fundings: readonly FundingRow[] | null;
	/** Tables that may be missing rows: a reconnect's snapshot did not reach back to what was known. */
	readonly gaps: readonly HistoryPart[];
}

export const LIVE_INITIAL: LiveAccount = {
	status: "connecting",
	asOf: null,
	refused: [],
	perp: null,
	spot: null,
	openOrders: null,
	otherDexes: null,
	ledger: null,
	fills: null,
	orderHistory: null,
	fundings: null,
	gaps: [],
};

/** The one status a screen shows, from the hub and the holdings subscriptions. */
export function liveStatus(i: {
	readonly hub: HubState;
	/** The holdings subscriptions that are held. */
	readonly holdings: readonly HubSubscriptionState[];
	/** Live at some point since the screen opened. */
	readonly everLive: boolean;
}): LiveStatus {
	if (i.hub.status === "open") {
		if (i.holdings.some((s) => s.status === "refused")) return "refused";
		if (i.holdings.length > 0 && i.holdings.every((s) => s.status === "live"))
			return "live";
	}
	if (i.hub.failures >= DOWN_AFTER) return "down";
	if (i.everLive || i.hub.failures > 0 || i.hub.status === "suspended")
		return "reconnecting";
	return "connecting";
}

export interface LiveAccountStoreOptions {
	/** Asked for when the first group is acquired, never before. */
	readonly hub: () => WsHub;
	readonly account: string;
	readonly timers?: HubTimers;
	/** How long a group nobody wants is kept. */
	readonly graceMs?: number;
	/** Called after a group was acquired and its subscriptions were asked for. */
	readonly onAcquire?: () => void;
}

export const LIVE_GRACE_MS = 3_000;

const spec = (part: LivePart): WsChannelSpec => {
	const s = wsChannel(CHANNEL[part]);
	if (!s) throw new Error(`no channel spec for ${part}`);
	return s;
};

export class LiveAccountStore {
	private readonly makeHub: () => WsHub;
	private readonly account: string;
	private readonly timers: HubTimers;
	private readonly graceMs: number;
	private readonly onAcquire: (() => void) | undefined;

	private hub: WsHub | null = null;
	private unwatch: (() => void) | null = null;
	private readonly wanted = new Map<LiveGroup, number>();
	private readonly graceTimers = new Map<LiveGroup, unknown>();
	private readonly leave = new Map<LivePart, () => void>();
	private readonly subs = new Map<LivePart, HubSubscriptionState>();
	private readonly listeners = new Set<() => void>();
	private everLive = false;
	/** The last message heard while the holdings were live. */
	private liveAt: number | null = null;
	private snapshot: LiveAccount = LIVE_INITIAL;

	constructor(options: LiveAccountStoreOptions) {
		this.makeHub = options.hub;
		this.account = options.account.toLowerCase();
		this.timers = options.timers ?? {
			set: (fn, ms) => setTimeout(fn, ms),
			clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
		};
		this.graceMs = options.graceMs ?? LIVE_GRACE_MS;
		this.onAcquire = options.onAcquire;
	}

	/** For useSyncExternalStore. */
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** The same object until something changes. */
	readonly getSnapshot = (): LiveAccount => this.snapshot;

	/** Want a group for as long as the returned function has not been called. */
	acquire(want: LiveWant): () => void {
		if (want === "history") {
			const leave = [this.acquire("ledger"), this.acquire("trades")];
			return () => {
				for (const l of leave) l();
			};
		}
		const group = want;
		const pending = this.graceTimers.get(group);
		if (pending !== undefined) {
			this.timers.clear(pending);
			this.graceTimers.delete(group);
		}
		this.wanted.set(group, (this.wanted.get(group) ?? 0) + 1);
		this.start(group);
		// after the subscriptions were asked for: whoever lets another account go
		// now does it on a socket that is still in use, so it is not closed and reopened
		this.onAcquire?.();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const n = (this.wanted.get(group) ?? 1) - 1;
			this.wanted.set(group, n);
			if (n > 0) return;
			this.graceTimers.set(
				group,
				this.timers.set(() => {
					this.graceTimers.delete(group);
					this.stop(group);
				}, this.graceMs),
			);
		};
	}

	/**
	 * Let go at once of every group nobody wants any more, without waiting out
	 * the grace period. Groups a screen still holds are not touched.
	 */
	letGo(): void {
		for (const [group, timer] of [...this.graceTimers]) {
			this.timers.clear(timer);
			this.graceTimers.delete(group);
			this.stop(group);
		}
	}

	/** Whether anything is still subscribed for this account (wanted, or kept for the grace period). */
	get following(): boolean {
		return this.leave.size > 0;
	}

	/** Ask again now: after "refused", or without waiting out a reconnect. */
	retry(): void {
		this.hub?.retryNow();
	}

	// ───────────────────────────── subscriptions ─────────────────────────────

	private start(group: LiveGroup): void {
		if (!this.hub) {
			this.hub = this.makeHub();
			this.unwatch = this.hub.watch(() => this.restate());
		}
		for (const part of LIVE_GROUPS[group]) {
			if (this.leave.has(part)) continue;
			// one look at every dex is enough for as long as the page is open
			if (part === "allDexs" && this.snapshot.otherDexes !== null) continue;
			this.subs.set(part, { status: "pending", reason: null });
			this.leave.set(
				part,
				this.hub.subscribe(
					spec(part),
					{ user: this.account },
					{
						onMessage: (m) => this.receive(part, m),
						onStatus: (s) => {
							this.subs.set(part, s);
							this.restate();
						},
					},
				),
			);
		}
		this.restate();
	}

	private stop(group: LiveGroup): void {
		for (const part of LIVE_GROUPS[group]) this.drop(part);
		const idle = [...this.wanted.values()].every((n) => n <= 0);
		if (idle && this.leave.size === 0) {
			this.unwatch?.();
			this.unwatch = null;
			this.hub = null;
			this.everLive = false;
			this.liveAt = null;
			// nothing is listening any more: what was shown must not come back as if it were current
			this.set(LIVE_INITIAL);
			return;
		}
		this.restate();
	}

	private drop(part: LivePart): void {
		const leave = this.leave.get(part);
		this.leave.delete(part);
		this.subs.delete(part);
		leave?.();
	}

	// ───────────────────────────── messages ─────────────────────────────

	private receive(part: LivePart, m: HubMessage): void {
		const s = this.snapshot;
		switch (part) {
			case "perp": {
				const p = parsePerpAccount(m.data);
				// the server's clock moves on every push; the figures are what a screen compares
				if (p)
					this.patch({ perp: shareStructure(s.perp, { ...p, time: null }) });
				return;
			}
			case "spot": {
				const b = parseSpotState(m.data);
				if (b) this.patch({ spot: shareStructure(s.spot, b) });
				return;
			}
			case "openOrders": {
				const o = parseOpenOrders(m.data);
				if (o)
					this.patch({ openOrders: shareStructure(s.openOrders, o.orders) });
				return;
			}
			case "allDexs": {
				const all = parseAllDexs(m.data);
				if (!all) return;
				this.drop("allDexs");
				this.patch({
					otherDexes: all
						.filter((d) => d.dex !== "" && perpAccountInUse(d))
						.map((d) => d.dex),
				});
				return;
			}
			case "ledger":
				this.rows(
					"ledger",
					m,
					parseLedger(m.data, this.account),
					LEDGER_MERGE,
					(r) => r.time,
				);
				return;
			case "fills":
				this.rows("fills", m, parseFills(m.data), FILL_MERGE, (r) => r.time);
				return;
			case "orderHistory":
				this.rows(
					"orderHistory",
					m,
					parseOrderHistory(m.data),
					ORDER_HISTORY_MERGE,
					(r) => r.statusTimestamp,
				);
				return;
			case "fundings":
				this.rows(
					"fundings",
					m,
					parseFundings(m.data),
					FUNDING_MERGE,
					(r) => r.time,
				);
				return;
		}
	}

	private rows<K extends HistoryPart, T extends { readonly key: string }>(
		part: K,
		m: HubMessage,
		batch: RowBatch<T> | null,
		merge: MergeOptions<T>,
		timeOf: (row: T) => number,
	): void {
		if (!batch) return;
		const prev = this.snapshot[part] as readonly T[] | null;
		const next = mergeRows(prev ?? [], batch.rows, merge);
		const gap = m.first && prev !== null && leavesGap(prev, batch.rows, timeOf);
		const gaps =
			gap && !this.snapshot.gaps.includes(part)
				? [...this.snapshot.gaps, part]
				: this.snapshot.gaps;
		if (next === prev && gaps === this.snapshot.gaps) return;
		this.patch({ [part]: next, gaps } as Partial<LiveAccount>);
	}

	// ───────────────────────────── state ─────────────────────────────

	private restate(): void {
		const hub = this.hub?.state();
		if (!hub) return;
		const holdings = LIVE_GROUPS.holdings
			// the one look at every dex is not what "live" is about
			.filter((p) => p !== "allDexs")
			.map((p) => this.subs.get(p))
			.filter((s): s is HubSubscriptionState => s !== undefined);
		const status = liveStatus({ hub, holdings, everLive: this.everLive });
		if (status === "live") {
			this.everLive = true;
			// kept here, not in what a screen reads: it moves with every message
			this.liveAt = hub.lastMessageAt ?? this.liveAt;
		}
		const refused = [...this.subs.entries()]
			.filter(([, s]) => s.status === "refused")
			.map(([part, s]) => ({
				part,
				reason: s.reason ?? "Hyperliquid refused the subscription.",
			}));
		this.patch({
			status,
			asOf: status === "live" ? null : this.liveAt,
			refused: shareStructure(this.snapshot.refused, refused),
		});
	}

	private patch(change: Partial<LiveAccount>): void {
		const keys = Object.keys(change) as (keyof LiveAccount)[];
		if (keys.every((k) => this.snapshot[k] === change[k])) return;
		this.set({ ...this.snapshot, ...change });
	}

	private set(next: LiveAccount): void {
		if (next === this.snapshot) return;
		this.snapshot = next;
		for (const l of [...this.listeners]) l();
	}
}

/**
 * The stores of a page, one per account, with one rule on top: a page follows
 * one account at a time. When a screen acquires anything for an account, what
 * was only being kept for any other account (on any network) is let go in the
 * same moment. Hyperliquid limits how many accounts a network address may
 * follow and how many messages it may send; a treasury left behind must not
 * count against either.
 */
export class LiveAccounts<N extends string = string> {
	private readonly stores = new Map<string, LiveAccountStore>();

	constructor(
		private readonly hubFor: (network: N) => WsHub,
		private readonly options: {
			readonly timers?: HubTimers;
			readonly graceMs?: number;
		} = {},
	) {}

	/** The store of one account. Creating it connects nothing. */
	store(network: N, address: string): LiveAccountStore {
		const account = address.toLowerCase();
		const key = `${network}:${account}`;
		let store = this.stores.get(key);
		if (!store) {
			store = new LiveAccountStore({
				hub: () => this.hubFor(network),
				account,
				timers: this.options.timers,
				graceMs: this.options.graceMs,
				onAcquire: () => this.only(key),
			});
			this.stores.set(key, store);
		}
		return store;
	}

	/** The accounts something is subscribed for right now, as `network:address`. */
	following(): string[] {
		return [...this.stores].filter(([, s]) => s.following).map(([k]) => k);
	}

	private only(key: string): void {
		for (const [k, store] of this.stores) if (k !== key) store.letGo();
	}
}
