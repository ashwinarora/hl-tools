import {
	getEntry,
	getString,
	type JsonNode,
	tryParseJson,
} from "@hl-tools/core";
import { documentFromFragment } from "#/components/multisig/model/transport";
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
	if (/^wss?:\/\//i.test(v)) {
		return { tool: "websocket", reason: "WebSocket URL → WebSocket workbench" };
	}
	if (/^https?:\/\//i.test(v)) {
		// A link made by the Multisig Signer carries a proposal in its fragment. It is decoded
		// here, locally; the URL itself is never fetched.
		const hashAt = v.indexOf("#share=");
		if (hashAt >= 0 && documentFromFragment(v.slice(hashAt)) !== null) {
			return {
				tool: "multisig-sign",
				reason:
					"Multi-sig proposal link → Multisig Signer (review, sign, submit)",
			};
		}
		return { tool: "rpc", reason: "URL → RPC capability probe" };
	}
	if (/^0x[0-9a-fA-F]{40}$/.test(v)) {
		return {
			tool: "multisig",
			reason: "Address → Multisig Inspector (signers, agents, balances)",
		};
	}
	if (/^0x[0-9a-fA-F]{32}$/.test(v)) {
		return { tool: "assets", reason: "Token ID → asset resolver" };
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
			if (isMultiSigBody(parsed.node)) {
				return {
					tool: "multisig",
					reason: "Multi-sig envelope → Multisig Inspector",
				};
			}
			// A document is something to act on (it names its signers and can take more
			// signatures); a request body is something to diagnose. Each page offers the other.
			if (isProposalDocument(parsed.node)) {
				return {
					tool: "multisig-sign",
					reason:
						"Multi-sig proposal document → Multisig Signer (review, sign, submit)",
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

/** `{ action: { type: "multiSig", … } }` or a bare `{ type: "multiSig", … }`. */
function isMultiSigBody(node: JsonNode): boolean {
	if (node.kind !== "object") return false;
	if (getString(node, "type") === "multiSig") return true;
	const action = getEntry(node, "action");
	return (
		!!action &&
		action.kind === "object" &&
		getString(action, "type") === "multiSig"
	);
}

/** A Phase 0 proposal document: `{ v: 1, payload: { multiSigUser, … } }`. */
function isProposalDocument(node: JsonNode): boolean {
	if (node.kind !== "object") return false;
	const v = getEntry(node, "v");
	const payload = getEntry(node, "payload");
	return (
		!!v &&
		v.kind === "number" &&
		v.raw === "1" &&
		!!payload &&
		payload.kind === "object" &&
		getEntry(payload, "multiSigUser") !== undefined
	);
}
