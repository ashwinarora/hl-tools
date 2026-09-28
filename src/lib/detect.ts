import { tryParseJson } from "@hl-tools/core";
import type { ToolId } from "./tools";

export interface Detection {
	readonly tool: ToolId;
	readonly reason: string;
}

/**
 * Guess which tool a pasted value belongs to. Pure and local: the value is
 * never sent anywhere by detection.
 */
export function detectInput(raw: string): Detection | null {
	const v = raw.trim();
	if (!v) return null;
	if (/^0x[0-9a-fA-F]{64}$/.test(v)) {
		return {
			tool: "trace",
			reason: "32-byte hash → HyperEVM transaction trace",
		};
	}
	if (
		/^(0x)?01[0-9a-fA-F]{6}/.test(v) &&
		/^(0x)?[0-9a-fA-F]+$/.test(v) &&
		v.replace(/^0x/, "").length >= 8
	) {
		return {
			tool: "corewriter",
			reason: "Starts with version byte 0x01 → CoreWriter action bytes",
		};
	}
	if (/^https?:\/\//i.test(v) || /^wss?:\/\//i.test(v)) {
		return { tool: "rpc", reason: "URL → RPC capability probe" };
	}
	if (v.startsWith("{") || v.startsWith("[")) {
		const parsed = tryParseJson(v);
		if (parsed.ok && parsed.node.kind === "object") {
			const keys = new Set(parsed.node.entries.map((e) => e.key));
			if (
				keys.has("status") &&
				(keys.has("response") || keys.has("statuses"))
			) {
				return {
					tool: "orders",
					reason: "Exchange response → failure explainer",
				};
			}
			if (keys.has("method") && keys.has("subscription")) {
				return {
					tool: "websocket",
					reason: "Subscription message → WebSocket workbench",
				};
			}
			if (keys.has("action") || keys.has("type")) {
				return {
					tool: "signing",
					reason: "Action payload → signing inspector",
				};
			}
		}
		return { tool: "orders", reason: "JSON → failure explainer" };
	}
	if (
		/^(L1 error|Order|Price|Insufficient|Reduce only|Post only|Must deposit|Invalid)/i.test(
			v,
		)
	) {
		return { tool: "orders", reason: "Error message → failure explainer" };
	}
	if (v.length <= 64 && !/\s{2,}/.test(v)) {
		return { tool: "assets", reason: "Symbol or ID → asset resolver" };
	}
	return null;
}
