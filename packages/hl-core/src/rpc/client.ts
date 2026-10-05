/**
 * Minimal JSON-RPC client that keeps the raw request and response for
 * display and classifies failures precisely: a browser CORS block, an HTTP
 * error, a JSON-RPC error object, a malformed body and a timeout are
 * different findings, not one generic "request failed".
 */

export interface RpcRequest {
	readonly jsonrpc: "2.0";
	readonly id: number;
	readonly method: string;
	readonly params: readonly unknown[];
}

export type RpcFailure =
	| { readonly kind: "network"; readonly message: string }
	| { readonly kind: "timeout"; readonly ms: number }
	| { readonly kind: "http"; readonly status: number; readonly body: string }
	| {
			readonly kind: "rpc";
			readonly code: number;
			readonly message: string;
			readonly data?: unknown;
	  }
	| { readonly kind: "malformed"; readonly body: string };

export interface RpcExchange<T = unknown> {
	readonly request: RpcRequest;
	/** Parsed response body, if any. */
	readonly response: unknown;
	readonly result: T | undefined;
	readonly failure: RpcFailure | null;
	readonly durationMs: number;
	readonly startedAt: number;
}

export interface RpcCallOptions {
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof fetch;
}

let nextId = 1;

export async function rpcCall<T = unknown>(
	url: string,
	method: string,
	params: readonly unknown[] = [],
	options: RpcCallOptions = {},
): Promise<RpcExchange<T>> {
	const request: RpcRequest = { jsonrpc: "2.0", id: nextId++, method, params };
	const timeoutMs = options.timeoutMs ?? 15_000;
	const startedAt = Date.now();
	const t0 = typeof performance !== "undefined" ? performance.now() : startedAt;
	const elapsed = () =>
		Math.round(
			(typeof performance !== "undefined" ? performance.now() : Date.now()) -
				t0,
		);
	const f = options.fetch ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new DOMException("timeout", "TimeoutError")),
		timeoutMs,
	);
	const onAbort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		let res: Response;
		try {
			res = await f(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
				signal: controller.signal,
				// Never send cookies/credentials to arbitrary endpoints.
				credentials: "omit",
				referrerPolicy: "no-referrer",
			});
		} catch (e) {
			if (controller.signal.aborted && !options.signal?.aborted) {
				return {
					request,
					response: undefined,
					result: undefined,
					failure: { kind: "timeout", ms: timeoutMs },
					durationMs: elapsed(),
					startedAt,
				};
			}
			return {
				request,
				response: undefined,
				result: undefined,
				failure: {
					kind: "network",
					message: e instanceof Error ? e.message : String(e),
				},
				durationMs: elapsed(),
				startedAt,
			};
		}
		const text = await res.text();
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			return {
				request,
				response: text,
				result: undefined,
				failure: res.ok
					? { kind: "malformed", body: text.slice(0, 2000) }
					: { kind: "http", status: res.status, body: text.slice(0, 2000) },
				durationMs: elapsed(),
				startedAt,
			};
		}
		const obj = body as {
			result?: T;
			error?: { code: number; message: string; data?: unknown };
		};
		if (obj && typeof obj === "object" && obj.error) {
			return {
				request,
				response: body,
				result: undefined,
				failure: {
					kind: "rpc",
					code: obj.error.code,
					message: obj.error.message,
					data: obj.error.data,
				},
				durationMs: elapsed(),
				startedAt,
			};
		}
		if (!res.ok) {
			return {
				request,
				response: body,
				result: undefined,
				failure: {
					kind: "http",
					status: res.status,
					body: text.slice(0, 2000),
				},
				durationMs: elapsed(),
				startedAt,
			};
		}
		if (!obj || typeof obj !== "object" || !("result" in obj)) {
			return {
				request,
				response: body,
				result: undefined,
				failure: { kind: "malformed", body: text.slice(0, 2000) },
				durationMs: elapsed(),
				startedAt,
			};
		}
		return {
			request,
			response: body,
			result: obj.result,
			failure: null,
			durationMs: elapsed(),
			startedAt,
		};
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}

export function describeFailure(f: RpcFailure): string {
	switch (f.kind) {
		case "network":
			return `The request never completed (${f.message}). In a browser this usually means the endpoint does not allow cross-origin requests (CORS), the host is unreachable, or an extension blocked it.`;
		case "timeout":
			return `No response within ${f.ms / 1000}s.`;
		case "http":
			return `HTTP ${f.status}${f.status === 429 ? " (rate limited)" : ""}.`;
		case "rpc":
			return `JSON-RPC error ${f.code}: ${f.message}`;
		case "malformed":
			return "The response was not a JSON-RPC result.";
	}
}

/** Hex quantity → bigint. */
export function hexToBigInt(hex: unknown): bigint | null {
	if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex)) return null;
	return hex === "0x" ? 0n : BigInt(hex);
}

export function toHexQuantity(n: bigint | number): `0x${string}` {
	return `0x${BigInt(n).toString(16)}`;
}
