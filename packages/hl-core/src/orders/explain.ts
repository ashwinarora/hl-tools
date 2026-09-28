/**
 * Explain exchange responses and errors field by field.
 *
 * Accepts a JSON response body (order/cancel/modify/twap/default), an
 * `orderStatus` info response, WebSocket `orderUpdates` items, a bare error
 * string, or text copied from an HTTP error (e.g. "422 Failed to
 * deserialize…"). Optionally takes the request action so statuses can be
 * paired with the orders that produced them (and partial fills detected).
 */

import { Decimal } from "../decimal.ts";
import {
	type ErrorEntry,
	HTTP_STATUS_NOTES,
	matchError,
} from "../rules/errors.ts";
import { ORDER_STATUSES } from "../rules/orders.ts";

export type Outcome =
	| "accepted"
	| "resting"
	| "filled"
	| "partially-filled"
	| "waiting"
	| "cancelled"
	| "rejected"
	| "error"
	| "unknown";

export interface ExplainedField {
	readonly path: string;
	readonly value: string;
	readonly meaning: string;
}

export interface ExplainedEntry {
	readonly index: number | null;
	readonly outcome: Outcome;
	readonly title: string;
	readonly fields: readonly ExplainedField[];
	readonly cause?: string;
	readonly fix?: string;
	readonly catalog?: ErrorEntry;
	/** The request order this status belongs to, if a request was given. */
	readonly order?: Record<string, unknown>;
}

export interface Explanation {
	readonly kind:
		| "exchange-response"
		| "top-level-error"
		| "order-status"
		| "order-updates"
		| "error-text"
		| "http-error"
		| "malformed-json"
		| "unrecognised";
	readonly summary: string;
	readonly entries: readonly ExplainedEntry[];
	/** Fields present in the input that the explainer doesn't know about. */
	readonly unknownFields: readonly string[];
	readonly notes: readonly string[];
	readonly httpStatus?: number;
}

function explainError(message: string, index: number | null): ExplainedEntry {
	const hit = matchError(message);
	const outcome: Outcome =
		hit?.status?.endsWith("Rejected") || hit?.status === "iocCancelRejected"
			? "rejected"
			: "error";
	return {
		index,
		outcome,
		title: message,
		fields: [
			{
				path: index === null ? "response" : `statuses[${index}].error`,
				value: message,
				meaning: hit
					? `${hit.documented ? "Documented" : "Known (undocumented)"} error${hit.status ? ` — historical status "${hit.status}"` : ""}.`
					: "Not in hl-core's error catalog.",
			},
		],
		cause:
			hit?.cause ??
			"This message isn't in the catalog. Search the docs for the exact text, and check the request against the Order Composer's linter.",
		fix: hit?.fix,
		catalog: hit,
	};
}

type OrderWire = {
	a?: number;
	b?: boolean;
	p?: string;
	s?: string;
	r?: boolean;
	t?: unknown;
	c?: string;
};

function statusEntry(
	st: unknown,
	index: number,
	order?: OrderWire,
): ExplainedEntry {
	const orderRec = order as Record<string, unknown> | undefined;
	if (typeof st === "string") {
		const known: Record<string, [Outcome, string]> = {
			success: [
				"cancelled",
				"Cancel succeeded: the order is no longer on the book.",
			],
			waitingForFill: [
				"waiting",
				"TP/SL child accepted; it activates only when its parent order fills (normalTpsl).",
			],
			waitingForTrigger: [
				"waiting",
				"Trigger order accepted; it will be placed when the mark price crosses the trigger.",
			],
		};
		const k = known[st];
		return {
			index,
			outcome: k?.[0] ?? "unknown",
			title: k ? st : `Unrecognised status "${st}"`,
			fields: [
				{
					path: `statuses[${index}]`,
					value: JSON.stringify(st),
					meaning: k?.[1] ?? "Not a status hl-core recognises.",
				},
			],
			order: orderRec,
		};
	}
	if (st && typeof st === "object") {
		const o = st as Record<string, unknown>;
		if (typeof o.error === "string")
			return { ...explainError(o.error, index), order: orderRec };
		if (o.resting && typeof o.resting === "object") {
			const r = o.resting as Record<string, unknown>;
			const fields: ExplainedField[] = [
				{
					path: `statuses[${index}].resting.oid`,
					value: String(r.oid),
					meaning:
						"Order ID assigned by HyperCore; use it to cancel or query orderStatus.",
				},
			];
			if (r.cloid)
				fields.push({
					path: `statuses[${index}].resting.cloid`,
					value: String(r.cloid),
					meaning: "Your client order ID, echoed back.",
				});
			return {
				index,
				outcome: "resting",
				title: `Resting on the book (oid ${String(r.oid)})`,
				fields,
				cause:
					"The order (or the part that didn't match immediately) is now a resting limit order. It may already be partially filled — query orderStatus or userFills to know.",
				order: orderRec,
			};
		}
		if (o.filled && typeof o.filled === "object") {
			const f = o.filled as Record<string, unknown>;
			const total = Decimal.tryParse(String(f.totalSz ?? ""));
			const requested = order?.s ? Decimal.tryParse(order.s) : null;
			const partial = !!(total && requested && total.lt(requested));
			const fields: ExplainedField[] = [
				{
					path: `statuses[${index}].filled.totalSz`,
					value: String(f.totalSz),
					meaning:
						partial && requested
							? `Filled size — ${requested.sub(total as Decimal).toString()} of the requested ${requested.toString()} did not fill.`
							: "Total size filled immediately.",
				},
				{
					path: `statuses[${index}].filled.avgPx`,
					value: String(f.avgPx),
					meaning: "Volume-weighted average fill price.",
				},
				{
					path: `statuses[${index}].filled.oid`,
					value: String(f.oid),
					meaning: "Order ID.",
				},
			];
			if (f.cloid)
				fields.push({
					path: `statuses[${index}].filled.cloid`,
					value: String(f.cloid),
					meaning: "Your client order ID, echoed back.",
				});
			const tif = (order?.t as { limit?: { tif?: string } } | undefined)?.limit
				?.tif;
			return {
				index,
				outcome: partial ? "partially-filled" : "filled",
				title: partial
					? `Partially filled: ${total?.toString()} of ${requested?.toString()}`
					: `Filled ${String(f.totalSz)} @ ${String(f.avgPx)}`,
				fields,
				cause: partial
					? tif === "Ioc"
						? "IOC: the unfilled remainder was canceled."
						: "The remainder is resting on the book (Gtc) — check openOrders."
					: undefined,
				order: orderRec,
			};
		}
		if (o.running && typeof o.running === "object") {
			const r = o.running as Record<string, unknown>;
			return {
				index,
				outcome: "accepted",
				title: `TWAP running (twapId ${String(r.twapId)})`,
				fields: [
					{
						path: `statuses[${index}].running.twapId`,
						value: String(r.twapId),
						meaning: "TWAP identifier; use it with twapCancel.",
					},
				],
				order: orderRec,
			};
		}
	}
	return {
		index,
		outcome: "unknown",
		title: "Unrecognised status shape",
		fields: [
			{
				path: `statuses[${index}]`,
				value: JSON.stringify(st),
				meaning: "hl-core doesn't recognise this status object.",
			},
		],
		order: orderRec,
	};
}

function explainOrderStatusValue(status: string): {
	outcome: Outcome;
	meaning: string;
} {
	const meaning = ORDER_STATUSES[status];
	const outcome: Outcome =
		status === "open"
			? "resting"
			: status === "filled"
				? "filled"
				: status === "triggered"
					? "accepted"
					: status === "rejected" || status.endsWith("Rejected")
						? "rejected"
						: status === "canceled" ||
								status.endsWith("Canceled") ||
								status === "scheduledCancel"
							? "cancelled"
							: "unknown";
	return { outcome, meaning: meaning ?? "Not a documented order status." };
}

function historicalOrderEntry(
	item: Record<string, unknown>,
	index: number,
	path: string,
): ExplainedEntry {
	const order = (item.order ?? {}) as Record<string, unknown>;
	const status = String(item.status ?? "");
	const { outcome, meaning } = explainOrderStatusValue(status);
	const errorLike = status.endsWith("Rejected")
		? matchError(status)
		: undefined;
	return {
		index,
		outcome,
		title: `${String(order.coin ?? "?")} ${order.side === "B" ? "buy" : order.side === "A" ? "sell" : ""} ${String(order.origSz ?? order.sz ?? "")} @ ${String(order.limitPx ?? "")} — ${status}`,
		fields: [
			{ path: `${path}.status`, value: status, meaning },
			{
				path: `${path}.statusTimestamp`,
				value: String(item.statusTimestamp ?? ""),
				meaning: item.statusTimestamp
					? new Date(Number(item.statusTimestamp)).toISOString()
					: "—",
			},
			{
				path: `${path}.order.oid`,
				value: String(order.oid ?? ""),
				meaning: "Order ID.",
			},
			{
				path: `${path}.order.sz`,
				value: String(order.sz ?? ""),
				meaning: "Remaining (unfilled) size.",
			},
			{
				path: `${path}.order.origSz`,
				value: String(order.origSz ?? ""),
				meaning: "Original size.",
			},
			...(order.tif
				? [
						{
							path: `${path}.order.tif`,
							value: String(order.tif),
							meaning:
								order.tif === "FrontendMarket"
									? "Market order from the frontend (IOC with slippage)."
									: "Time in force.",
						},
					]
				: []),
		],
		cause:
			status.endsWith("Rejected") || status.endsWith("Canceled")
				? meaning
				: undefined,
		catalog: errorLike,
	};
}

const KNOWN_TOP = new Set(["status", "response"]);

export function explainResponse(input: string, request?: unknown): Explanation {
	const text = input.trim();
	const notes: string[] = [];
	if (!text)
		return {
			kind: "unrecognised",
			summary: "Nothing to explain.",
			entries: [],
			unknownFields: [],
			notes,
		};

	// HTTP status prefix, e.g. "422 Failed to deserialize…" or "HTTP 429".
	const http = /^(?:HTTP\s*)?(\d{3})\b[\s:—-]*([\s\S]*)$/i.exec(text);
	if (http && !text.startsWith("{") && !text.startsWith("[")) {
		const code = Number(http[1]);
		const body = (http[2] ?? "").trim();
		const entry = body ? explainError(body, null) : null;
		return {
			kind: "http-error",
			summary: `HTTP ${code}: ${HTTP_STATUS_NOTES[code] ?? "Non-success HTTP status."}`,
			entries: entry ? [entry] : [],
			unknownFields: [],
			notes:
				code === 422
					? [
							"422 means the JSON parsed but doesn't match the action schema. Prices and sizes must be strings; asset IDs, oids and nonces numbers.",
						]
					: [],
			httpStatus: code,
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		if (text.startsWith("{") || text.startsWith("[")) {
			return {
				kind: "malformed-json",
				summary: "This looks like JSON but doesn't parse.",
				entries: [],
				unknownFields: [],
				notes: [
					`${(e as Error).message}. It may have been truncated when copied — paste the complete response body.`,
				],
			};
		}
		// A bare error string (possibly quoted).
		const entry = explainError(text.replace(/^"|"$/g, ""), null);
		return {
			kind: "error-text",
			summary: entry.catalog
				? "Recognised error message."
				: "Unrecognised error message.",
			entries: [entry],
			unknownFields: [],
			notes,
		};
	}

	const reqOrders: OrderWire[] =
		request &&
		typeof request === "object" &&
		Array.isArray((request as { orders?: unknown }).orders)
			? ((request as { orders: OrderWire[] }).orders ?? [])
			: request &&
					typeof request === "object" &&
					Array.isArray(
						(request as { action?: { orders?: unknown } }).action?.orders,
					)
				? ((request as { action: { orders: OrderWire[] } }).action.orders ?? [])
				: [];

	// WebSocket orderUpdates: an array of {order, status, statusTimestamp}.
	if (Array.isArray(parsed)) {
		const items = parsed.filter(
			(x) => x && typeof x === "object" && "order" in x && "status" in x,
		) as Record<string, unknown>[];
		if (items.length) {
			const entries = items.map((it, i) =>
				historicalOrderEntry(it, i, `[${i}]`),
			);
			return {
				kind: "order-updates",
				summary: `${entries.length} order update${entries.length === 1 ? "" : "s"} (orderUpdates / historicalOrders items).`,
				entries,
				unknownFields: [],
				notes,
			};
		}
		return {
			kind: "unrecognised",
			summary: "A JSON array that isn't a list of order updates.",
			entries: [],
			unknownFields: [],
			notes,
		};
	}

	if (!parsed || typeof parsed !== "object") {
		const entry = explainError(String(parsed), null);
		return {
			kind: "error-text",
			summary: "A JSON string.",
			entries: [entry],
			unknownFields: [],
			notes,
		};
	}
	const obj = parsed as Record<string, unknown>;

	// orderStatus info response.
	if (obj.status === "order" && obj.order && typeof obj.order === "object") {
		return {
			kind: "order-status",
			summary: "orderStatus response.",
			entries: [
				historicalOrderEntry(obj.order as Record<string, unknown>, 0, "order"),
			],
			unknownFields: [],
			notes,
		};
	}
	if (obj.status === "unknownOid") {
		return {
			kind: "order-status",
			summary: "orderStatus: unknownOid.",
			entries: [
				{
					index: null,
					outcome: "unknown",
					title: "unknownOid",
					fields: [
						{
							path: "status",
							value: "unknownOid",
							meaning:
								"No order with this oid/cloid exists for the queried user.",
						},
					],
					cause:
						"Wrong user (agent address instead of the master/sub-account), wrong network, wrong oid/cloid, or the order was never accepted.",
				},
			],
			unknownFields: [],
			notes,
		};
	}

	const unknownFields = Object.keys(obj).filter((k) => !KNOWN_TOP.has(k));
	if (obj.status === "err") {
		const msg =
			typeof obj.response === "string"
				? obj.response
				: JSON.stringify(obj.response);
		return {
			kind: "top-level-error",
			summary: 'The whole action was rejected (status "err").',
			entries: [explainError(msg, null)],
			unknownFields,
			notes: ["A top-level error means nothing in the action was executed."],
		};
	}
	if (obj.status === "ok") {
		const resp = obj.response as Record<string, unknown> | undefined;
		if (!resp || typeof resp !== "object") {
			return {
				kind: "exchange-response",
				summary: 'status "ok" with no response body.',
				entries: [],
				unknownFields,
				notes,
			};
		}
		const type = String(resp.type ?? "");
		if (type === "default") {
			return {
				kind: "exchange-response",
				summary: "Accepted.",
				entries: [
					{
						index: null,
						outcome: "accepted",
						title: "Action accepted",
						fields: [
							{
								path: "response.type",
								value: "default",
								meaning:
									"Non-order actions (transfers, approvals, leverage, …) return this on success.",
							},
						],
					},
				],
				unknownFields,
				notes,
			};
		}
		const data = resp.data as { statuses?: unknown[] } | undefined;
		const statuses = data?.statuses ?? [];
		if (!Array.isArray(statuses)) {
			return {
				kind: "exchange-response",
				summary: `Response type "${type}" without a statuses array.`,
				entries: [],
				unknownFields,
				notes,
			};
		}
		if (reqOrders.length && statuses.length === 1 && reqOrders.length > 1) {
			notes.push(
				"One status for a batch of several orders: the whole batch was rejected in pre-validation (the same error applies to every order).",
			);
		} else if (reqOrders.length && statuses.length !== reqOrders.length) {
			notes.push(
				`The request has ${reqOrders.length} orders but the response has ${statuses.length} statuses.`,
			);
		}
		const entries = statuses.map((st, i) => statusEntry(st, i, reqOrders[i]));
		const counts = entries.reduce<Record<string, number>>((m, e) => {
			m[e.outcome] = (m[e.outcome] ?? 0) + 1;
			return m;
		}, {});
		return {
			kind: "exchange-response",
			summary: `${type || "?"} response: ${
				Object.entries(counts)
					.map(([k, v]) => `${v} ${k}`)
					.join(", ") || "no statuses"
			}. status "ok" only means the API accepted the request — check each status.`,
			entries,
			unknownFields,
			notes,
		};
	}
	return {
		kind: "unrecognised",
		summary:
			"Not an exchange response, orderStatus result or error hl-core recognises.",
		entries: [],
		unknownFields,
		notes,
	};
}
