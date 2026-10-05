/**
 * Fold channel messages into comparable state, following each channel's
 * semantics (snapshot replaces, events accumulate by identity). Used to diff
 * what a client knows before a disconnect with what it knows after
 * reconnecting.
 */

import type { WsChannelSpec } from "../rules/websocket.ts";

export type ChannelState = Record<string, unknown>;

const MAX_EVENT_KEYS = 500;

function trim(obj: Record<string, unknown>): Record<string, unknown> {
	const keys = Object.keys(obj);
	if (keys.length <= MAX_EVENT_KEYS) return obj;
	const out: Record<string, unknown> = {};
	for (const k of keys.slice(keys.length - MAX_EVENT_KEYS)) out[k] = obj[k];
	return out;
}

function arrayOf(data: unknown, key?: string): Record<string, unknown>[] {
	if (Array.isArray(data)) return data as Record<string, unknown>[];
	if (
		key &&
		data &&
		typeof data === "object" &&
		Array.isArray((data as Record<string, unknown>)[key])
	) {
		return (data as Record<string, unknown[]>)[key] as Record<
			string,
			unknown
		>[];
	}
	return [];
}

/** Apply one data message (the `data` field) to the channel state. */
export function reduceChannel(
	spec: WsChannelSpec,
	state: ChannelState,
	data: unknown,
): ChannelState {
	switch (spec.type) {
		case "l2Book": {
			const d = data as {
				coin?: string;
				time?: number;
				levels?: [unknown[], unknown[]];
			};
			const lv = d.levels ?? [[], []];
			const side = (arr: unknown[]) =>
				Object.fromEntries(
					(arr as { px: string; sz: string; n: number }[])
						.slice(0, 10)
						.map((l) => [l.px, `${l.sz} (${l.n})`]),
				);
			return {
				coin: d.coin,
				time: d.time,
				bids: side(lv[0] ?? []),
				asks: side(lv[1] ?? []),
			};
		}
		case "allMids":
			return { ...((data as { mids?: Record<string, string> })?.mids ?? {}) };
		case "bbo":
			return { ...(data as Record<string, unknown>) };
		case "trades": {
			const next = { ...state };
			for (const t of arrayOf(data))
				next[`${String(t.time)}:${String(t.tid)}`] = {
					side: t.side,
					px: t.px,
					sz: t.sz,
				};
			return trim(next);
		}
		case "candle": {
			const c = data as Record<string, unknown>;
			return trim({
				...state,
				[String(c.t)]: { o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, n: c.n },
			});
		}
		case "userFills": {
			const next = { ...state };
			for (const f of arrayOf(data, "fills"))
				next[`${String(f.hash)}:${String(f.tid)}`] = {
					coin: f.coin,
					side: f.side,
					px: f.px,
					sz: f.sz,
					oid: f.oid,
				};
			return trim(next);
		}
		case "orderUpdates": {
			const next = { ...state };
			for (const u of arrayOf(data)) {
				const o = (u.order ?? {}) as Record<string, unknown>;
				next[String(o.oid)] = {
					coin: o.coin,
					side: o.side,
					limitPx: o.limitPx,
					sz: o.sz,
					status: u.status,
				};
			}
			return trim(next);
		}
		case "userFundings": {
			const next = { ...state };
			for (const f of arrayOf(data, "fundings"))
				next[`${String(f.time)}:${String(f.coin)}`] = {
					usdc: f.usdc,
					fundingRate: f.fundingRate,
				};
			return trim(next);
		}
		case "userNonFundingLedgerUpdates": {
			const next = { ...state };
			for (const u of arrayOf(data, "nonFundingLedgerUpdates"))
				next[String(u.hash)] = (u as Record<string, unknown>).delta;
			return trim(next);
		}
		default:
			if (spec.semantics === "snapshot")
				return data && typeof data === "object"
					? { ...(data as Record<string, unknown>) }
					: { value: data };
			return trim({ ...state, [String(Object.keys(state).length)]: data });
	}
}

export interface StateDiff {
	readonly added: string[];
	readonly removed: string[];
	readonly changed: string[];
	readonly unchanged: number;
}

export function diffChannelState(
	before: ChannelState,
	after: ChannelState,
): StateDiff {
	const added: string[] = [];
	const removed: string[] = [];
	const changed: string[] = [];
	let unchanged = 0;
	for (const k of Object.keys(after)) {
		if (!(k in before)) added.push(k);
		else if (JSON.stringify(before[k]) !== JSON.stringify(after[k]))
			changed.push(k);
		else unchanged++;
	}
	for (const k of Object.keys(before)) if (!(k in after)) removed.push(k);
	return { added, removed, changed, unchanged };
}

/** One-line summary of a data message for the live stream list. */
export function summarizeMessage(channel: string, data: unknown): string {
	if (channel === "subscriptionResponse") return "ack";
	if (channel === "pong") return "pong";
	if (channel === "error") return `error: ${String(data)}`;
	const d = data as Record<string, unknown> | unknown[];
	if (Array.isArray(d)) return `${d.length} item${d.length === 1 ? "" : "s"}`;
	if (d && typeof d === "object") {
		if ("levels" in d) {
			const lv = d.levels as [{ px: string }[], { px: string }[]];
			return `bid ${lv[0]?.[0]?.px ?? "—"} / ask ${lv[1]?.[0]?.px ?? "—"} · ${lv[0]?.length ?? 0}+${lv[1]?.length ?? 0} levels`;
		}
		if ("mids" in d) return `${Object.keys(d.mids as object).length} mids`;
		if ("fills" in d)
			return `${(d.fills as unknown[]).length} fill(s)${d.isSnapshot ? " · snapshot" : ""}`;
		if ("bbo" in d) {
			const b = d.bbo as [{ px: string } | null, { px: string } | null];
			return `bbo ${b[0]?.px ?? "—"} / ${b[1]?.px ?? "—"}`;
		}
		if ("t" in d && "c" in d)
			return `candle ${String(d.i ?? "")} c=${String(d.c)}`;
		if ("ctx" in d) return `ctx ${String(d.coin ?? "")}`;
		if ("isSnapshot" in d) return d.isSnapshot ? "snapshot" : "update";
		return `${Object.keys(d).length} field(s)`;
	}
	return String(data);
}

/** Whether a data message is the channel's initial snapshot. */
export function isSnapshotMessage(
	spec: WsChannelSpec,
	data: unknown,
	firstData: boolean,
): boolean {
	if (data && typeof data === "object" && "isSnapshot" in (data as object))
		return Boolean((data as { isSnapshot?: boolean }).isSnapshot);
	// Channels like trades replay history in their first message without a flag.
	return (
		(spec.semantics === "snapshot" ||
			spec.semantics === "snapshot-then-deltas") &&
		firstData
	);
}
