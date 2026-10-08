/**
 * Explain an /exchange response. The chain's multi-sig errors are single
 * strings with no field information; this maps each to the catalogue entry,
 * pulls out the numbers and addresses it mentions, and adds the multi-sig
 * specific fix where the generic one would mislead.
 */
import {
	ERROR_CATALOG,
	HTTP_STATUS_NOTES,
	matchError,
} from "../rules/errors.ts";
import type { ErrorExplanation } from "./types.ts";

const DETAIL_GROUPS: Readonly<Record<string, readonly string[]>> = {
	"nonce-low": ["nonce", "minimum"],
	"nonce-high": ["nonce", "maximum"],
	"nonce-duplicate": ["nonce"],
	"vault-unregistered": ["vault"],
};
const ADDRESS_IN_MESSAGE = /(0x[0-9a-fA-F]{40})/;

const MULTISIG_FIX_OVERRIDES: Readonly<Record<string, string>> = {
	"must-deposit":
		"If the address is an API wallet: agents cannot perform user-signed actions (send, approve, convert) at all, and an agent can only lead a multi-sig envelope once the agent address itself holds a deposit. Otherwise deposit to the address first.",
	expired:
		"expiresAfter is bound into every inner signature and the envelope; re-propose with a later expiry and collect fresh signatures.",
	"signer-missing":
		"For a multi-sig envelope this means the envelope's own signature recovers to an unknown address: the leader signed different bytes (key order, untrimmed inner signatures, wrong signatureChainId).",
	deserialize:
		"For a multi-sig envelope: the payload action must be a complete action object with its type, the signatures array must hold {r, s, v} objects, and user-signed inner actions need signatureChainId and hyperliquidChain.",
};

function explainMessage(
	message: string,
	source: ErrorExplanation["source"],
	httpStatus: number,
): ErrorExplanation {
	const entry = matchError(message);
	const details: Record<string, string> = {};
	if (entry) {
		const groups = DETAIL_GROUPS[entry.id];
		const m = entry.pattern.exec(message);
		if (groups && m) {
			groups.forEach((name, i) => {
				const v = m[i + 1];
				if (v !== undefined) details[name] = v;
			});
		}
		const addr = ADDRESS_IN_MESSAGE.exec(message);
		if (addr?.[1] && !("vault" in details))
			details.address = addr[1].toLowerCase();
		const note = HTTP_STATUS_NOTES[httpStatus];
		return {
			id: entry.id,
			message,
			cause:
				httpStatus !== 200 && note
					? `${entry.cause} (HTTP ${httpStatus}: ${note})`
					: entry.cause,
			fix: MULTISIG_FIX_OVERRIDES[entry.id]
				? `${entry.fix} ${MULTISIG_FIX_OVERRIDES[entry.id]}`
				: entry.fix,
			details,
			source,
		};
	}
	const note = HTTP_STATUS_NOTES[httpStatus];
	return {
		id: "unknown",
		message,
		cause:
			httpStatus !== 200 && note
				? `Not in the error catalogue. HTTP ${httpStatus}: ${note}`
				: "Not in the error catalogue.",
		fix: "Check the message against the Hyperliquid docs; if it is a multi-sig error, compare the envelope with buildEnvelope's output field by field.",
		details,
		source,
	};
}

/** Explain any /exchange result. Never throws, whatever the body is. */
export function explainExchangeError(
	body: unknown,
	httpStatus: number,
): ErrorExplanation {
	if (httpStatus !== 200) {
		const text = typeof body === "string" ? body : safeStringify(body);
		return explainMessage(text, "http", httpStatus);
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return explainMessage(
			typeof body === "string" ? body : safeStringify(body),
			"http",
			httpStatus,
		);
	}
	const b = body as { status?: unknown; response?: unknown };
	if (b.status === "err") {
		const message =
			typeof b.response === "string" ? b.response : safeStringify(b.response);
		return explainMessage(message, "status", httpStatus);
	}
	if (b.status === "ok") {
		const statuses = (
			b.response as { data?: { statuses?: unknown } } | undefined
		)?.data?.statuses;
		if (Array.isArray(statuses)) {
			const errors = statuses
				.map((s, i) => [i, s] as const)
				.filter(
					(x): x is readonly [number, { error: string }] =>
						!!x[1] &&
						typeof x[1] === "object" &&
						typeof (x[1] as { error?: unknown }).error === "string",
				);
			if (errors.length) {
				const [index, first] = errors[0] as readonly [
					number,
					{ error: string },
				];
				const e = explainMessage(first.error, "order-status", httpStatus);
				return {
					...e,
					details: {
						...e.details,
						index: String(index),
						failed: String(errors.length),
						total: String(statuses.length),
					},
				};
			}
		}
		return {
			id: "ok",
			message: "",
			cause: "The action was accepted.",
			fix: "",
			details: {},
			source: "none",
		};
	}
	return explainMessage(safeStringify(body), "http", httpStatus);
}

function safeStringify(v: unknown): string {
	try {
		const s = JSON.stringify(v, (_k, x) =>
			typeof x === "bigint" ? `${x}n` : x,
		);
		return s === undefined ? String(v) : s;
	} catch {
		return String(v);
	}
}

/** Every catalogue entry that describes a multi-sig or nonce condition, for UIs that list them. */
export const MULTISIG_ERROR_IDS: readonly string[] = ERROR_CATALOG.filter((e) =>
	/^multisig-|^nonce|^network-signature$|^revert-shape$|^vault-unregistered$/.test(
		e.id,
	),
).map((e) => e.id);
