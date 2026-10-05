import { type Issue, issue } from "../issues.ts";
import { CANDLE_INTERVALS, type WsChannelSpec } from "../rules/websocket.ts";

export interface BuiltSubscription {
	readonly subscription: Record<string, unknown> | null;
	readonly message: Record<string, unknown> | null;
	readonly issues: readonly Issue[];
}

/** Build and validate a subscription object for a channel. */
export function buildSubscription(
	spec: WsChannelSpec,
	params: Readonly<Record<string, string>>,
): BuiltSubscription {
	const issues: Issue[] = [];
	const sub: Record<string, unknown> = { type: spec.type };
	for (const p of spec.params) {
		const raw = (params[p.name] ?? "").trim();
		if (!raw) {
			if (p.required)
				issues.push(
					issue(
						"ws.param.missing",
						"error",
						`${p.name} is required for ${spec.type}.`,
						{ path: p.name },
					),
				);
			continue;
		}
		switch (p.kind) {
			case "user":
				if (!/^0x[0-9a-fA-F]{40}$/.test(raw))
					issues.push(
						issue(
							"ws.param.user",
							"error",
							`${p.name} must be a 20-byte address.`,
							{ path: p.name },
						),
					);
				else sub[p.name] = raw.toLowerCase();
				break;
			case "interval":
				if (!(CANDLE_INTERVALS as readonly string[]).includes(raw)) {
					issues.push(
						issue(
							"ws.param.interval",
							"error",
							`interval must be one of ${CANDLE_INTERVALS.join(", ")}.`,
							{ path: p.name },
						),
					);
				} else sub[p.name] = raw;
				break;
			case "int":
				if (!/^\d+$/.test(raw))
					issues.push(
						issue("ws.param.int", "error", `${p.name} must be an integer.`, {
							path: p.name,
						}),
					);
				else sub[p.name] = Number(raw);
				break;
			case "bool":
				sub[p.name] = raw === "true";
				break;
			default:
				sub[p.name] = raw;
		}
	}
	if (
		spec.type === "l2Book" &&
		sub.mantissa !== undefined &&
		sub.nSigFigs !== 5
	) {
		issues.push(
			issue(
				"ws.param.mantissa",
				"error",
				"mantissa is only allowed with nSigFigs 5.",
				{ path: "mantissa" },
			),
		);
	}
	if (
		spec.type === "l2Book" &&
		sub.nSigFigs !== undefined &&
		![2, 3, 4, 5].includes(sub.nSigFigs as number)
	) {
		issues.push(
			issue("ws.param.nsigfigs", "error", "nSigFigs must be 2, 3, 4 or 5.", {
				path: "nSigFigs",
			}),
		);
	}
	if (
		spec.type === "l2Book" &&
		sub.mantissa !== undefined &&
		![1, 2, 5].includes(sub.mantissa as number)
	) {
		issues.push(
			issue("ws.param.mantissa", "error", "mantissa must be 1, 2 or 5.", {
				path: "mantissa",
			}),
		);
	}
	if (issues.some((i) => i.severity === "error"))
		return { subscription: null, message: null, issues };
	return {
		subscription: sub,
		message: { method: "subscribe", subscription: sub },
		issues,
	};
}

/** True if a server message is the ack for `subscription` (field-by-field). */
export function isAckFor(
	msg: unknown,
	subscription: Record<string, unknown>,
): boolean {
	if (!msg || typeof msg !== "object") return false;
	const m = msg as {
		channel?: unknown;
		data?: { method?: unknown; subscription?: Record<string, unknown> };
	};
	if (m.channel !== "subscriptionResponse") return false;
	const s = m.data?.subscription;
	if (!s || m.data?.method !== "subscribe") return false;
	return Object.entries(subscription).every(
		([k, v]) => String(s[k]).toLowerCase() === String(v).toLowerCase(),
	);
}
