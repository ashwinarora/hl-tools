/**
 * Recorded WebSocket sessions: bounded in size, exportable as a sanitised
 * JSON file and importable for replay. Import is strict — a session file is
 * untrusted input.
 */

import type { Network } from "../network.ts";
import { isNetwork } from "../network.ts";

export const SESSION_FORMAT = "hl-tools.ws-session";
export const SESSION_VERSION = 1;
/** Hard bounds for recording and import. */
export const SESSION_LIMITS = {
	maxMessages: 5000,
	maxBytes: 8 * 1024 * 1024,
	maxDurationMs: 30 * 60 * 1000,
} as const;

export type RecordedDirection = "in" | "out" | "event";

export interface RecordedMessage {
	/** Milliseconds since the session started. */
	readonly t: number;
	readonly dir: RecordedDirection;
	/** For in/out: the raw JSON text. For events: a description (open, close, simulated disconnect…). */
	readonly text: string;
}

export interface WsSessionFile {
	readonly format: typeof SESSION_FORMAT;
	readonly version: typeof SESSION_VERSION;
	readonly network: Network;
	readonly url: string;
	readonly channel: string;
	readonly subscription: Record<string, unknown>;
	readonly startedAt: number;
	readonly endedAt: number;
	readonly sanitized: boolean;
	readonly truncated: boolean;
	readonly messages: readonly RecordedMessage[];
}

const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

/**
 * Replace every 20-byte address with a stable pseudonym (0xuser000…01, …)
 * so relationships inside the session survive but identities don't.
 */
export function sanitizeSession(file: WsSessionFile): WsSessionFile {
	const map = new Map<string, string>();
	const pseudo = (addr: string) => {
		const k = addr.toLowerCase();
		let v = map.get(k);
		if (!v) {
			const n = (map.size + 1).toString(16).padStart(8, "0");
			v = `0x${"0".repeat(32)}${n}`;
			map.set(k, v);
		}
		return v;
	};
	const scrub = (s: string) => s.replace(ADDRESS_RE, pseudo);
	return {
		...file,
		subscription: JSON.parse(
			scrub(JSON.stringify(file.subscription)),
		) as Record<string, unknown>,
		messages: file.messages.map((m) => ({ ...m, text: scrub(m.text) })),
		sanitized: true,
	};
}

export function serializeSession(file: WsSessionFile): string {
	return JSON.stringify(file, null, 1);
}

export type SessionParse =
	| { ok: true; file: WsSessionFile }
	| { ok: false; error: string };

export function parseSessionFile(text: string): SessionParse {
	if (text.length > SESSION_LIMITS.maxBytes * 2)
		return {
			ok: false,
			error: `File is larger than ${(SESSION_LIMITS.maxBytes * 2) / 1024 / 1024} MB.`,
		};
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { ok: false, error: `Not JSON: ${(e as Error).message}` };
	}
	const f = raw as Partial<WsSessionFile>;
	if (!f || typeof f !== "object")
		return { ok: false, error: "Not a session object." };
	if (f.format !== SESSION_FORMAT)
		return {
			ok: false,
			error: `Unknown format "${String(f.format)}" (expected ${SESSION_FORMAT}).`,
		};
	if (f.version !== SESSION_VERSION)
		return {
			ok: false,
			error: `Unsupported session version ${String(f.version)}.`,
		};
	if (!isNetwork(f.network))
		return { ok: false, error: "Missing or invalid network." };
	if (
		typeof f.channel !== "string" ||
		!f.subscription ||
		typeof f.subscription !== "object"
	)
		return { ok: false, error: "Missing channel or subscription." };
	if (!Array.isArray(f.messages))
		return { ok: false, error: "Missing messages array." };
	if (f.messages.length > SESSION_LIMITS.maxMessages)
		return {
			ok: false,
			error: `More than ${SESSION_LIMITS.maxMessages} messages.`,
		};
	let last = -1;
	for (const [i, m] of f.messages.entries()) {
		if (
			!m ||
			typeof m !== "object" ||
			typeof m.t !== "number" ||
			!Number.isFinite(m.t) ||
			m.t < 0
		)
			return { ok: false, error: `Message ${i} has an invalid timestamp.` };
		if (m.t < last)
			return { ok: false, error: `Message ${i} is out of order.` };
		if (m.dir !== "in" && m.dir !== "out" && m.dir !== "event")
			return { ok: false, error: `Message ${i} has an invalid direction.` };
		if (typeof m.text !== "string")
			return { ok: false, error: `Message ${i} has no text.` };
		last = m.t;
	}
	return {
		ok: true,
		file: {
			format: SESSION_FORMAT,
			version: SESSION_VERSION,
			network: f.network,
			url: typeof f.url === "string" ? f.url : "",
			channel: f.channel,
			subscription: f.subscription as Record<string, unknown>,
			startedAt: typeof f.startedAt === "number" ? f.startedAt : 0,
			endedAt: typeof f.endedAt === "number" ? f.endedAt : 0,
			sanitized: f.sanitized === true,
			truncated: f.truncated === true,
			messages: f.messages as RecordedMessage[],
		},
	};
}

/** Bounded recorder used by the workbench. */
export class SessionRecorder {
	readonly network: Network;
	readonly url: string;
	readonly channel: string;
	readonly subscription: Record<string, unknown>;
	readonly startedAt: number;
	private messages: RecordedMessage[] = [];
	private bytes = 0;
	truncated = false;
	constructor(
		network: Network,
		url: string,
		channel: string,
		subscription: Record<string, unknown>,
		now = Date.now(),
	) {
		this.network = network;
		this.url = url;
		this.channel = channel;
		this.subscription = subscription;
		this.startedAt = now;
	}
	/** Returns false once a bound is hit (recording stops). */
	push(dir: RecordedDirection, text: string, now = Date.now()): boolean {
		if (this.truncated) return false;
		const t = now - this.startedAt;
		if (
			this.messages.length >= SESSION_LIMITS.maxMessages ||
			this.bytes + text.length > SESSION_LIMITS.maxBytes ||
			t > SESSION_LIMITS.maxDurationMs
		) {
			this.truncated = true;
			return false;
		}
		this.messages.push({ t, dir, text });
		this.bytes += text.length;
		return true;
	}
	get size(): { messages: number; bytes: number } {
		return { messages: this.messages.length, bytes: this.bytes };
	}
	toFile(now = Date.now()): WsSessionFile {
		return {
			format: SESSION_FORMAT,
			version: SESSION_VERSION,
			network: this.network,
			url: this.url,
			channel: this.channel,
			subscription: this.subscription,
			startedAt: this.startedAt,
			endedAt: now,
			sanitized: false,
			truncated: this.truncated,
			messages: [...this.messages],
		};
	}
}
