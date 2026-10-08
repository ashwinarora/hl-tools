/**
 * Thin, cached adapter over @nktkas/hyperliquid for read-only info requests.
 *
 * - The network is always explicit: there is no default client.
 * - Every response comes back as `Observed<T>` with network + timestamp.
 * - Responses are cached per (network, request body) with a TTL chosen per
 *   request type; concurrent identical requests share one in-flight promise.
 */

import { HttpTransport } from "@nktkas/hyperliquid";
import { type Observed, observed, toAddress } from "../identity.ts";
import type { Policy } from "../multisig/types.ts";
import { type Network, networkConfig } from "../network.ts";
import {
	normalizeSettledOutcome,
	type RawSettledOutcome,
	type SettledOutcome,
} from "../resolver/identifiers.ts";
import {
	type AssetUniverse,
	buildUniverse,
	type RawMetadata,
} from "../resolver/metadata.ts";

export type InfoBody = { readonly type: string } & Record<string, unknown>;

/** Default cache TTLs (ms) by request type. */
export const DEFAULT_TTLS: Readonly<Record<string, number>> = {
	perpDexs: 5 * 60_000,
	allPerpMetas: 5 * 60_000,
	meta: 5 * 60_000,
	spotMeta: 5 * 60_000,
	outcomeMeta: 60_000,
	allMids: 3_000,
	l2Book: 1_000,
	// A settled outcome never changes again.
	settledOutcome: 24 * 60 * 60_000,
	// Multi-sig policy and account role: short, so a rotation shows up quickly.
	userToMultiSigSigners: 10_000,
	userRole: 10_000,
};

/** `userRole` info response. A multi-sig user still reports `user`. */
export type UserRole =
	| { readonly role: "user" }
	| { readonly role: "agent"; readonly data: { readonly user: string } }
	| { readonly role: "vault" }
	| { readonly role: "subAccount"; readonly data: { readonly master: string } }
	| { readonly role: "missing" };

interface RawMultiSigSigners {
	readonly authorizedUsers: readonly string[];
	readonly threshold: number;
}

export class InfoRequestError extends Error {
	readonly network: Network;
	readonly body: InfoBody;
	readonly status: number | null;
	constructor(
		network: Network,
		body: InfoBody,
		message: string,
		status: number | null,
		cause?: unknown,
	) {
		super(message, { cause });
		this.name = "InfoRequestError";
		this.network = network;
		this.body = body;
		this.status = status;
	}
}

interface CacheEntry {
	readonly expires: number;
	readonly value: Promise<Observed<unknown>>;
}

export interface InfoClientOptions {
	readonly timeoutMs?: number;
	readonly now?: () => number;
	readonly transport?: {
		request<T>(
			endpoint: "info",
			payload: unknown,
			signal?: AbortSignal,
		): Promise<T>;
	};
}

export class InfoClient<N extends Network> {
	readonly network: N;
	private readonly transport: NonNullable<InfoClientOptions["transport"]>;
	private readonly cache = new Map<string, CacheEntry>();
	private readonly now: () => number;
	private universeCache: {
		expires: number;
		value: Promise<AssetUniverse<N>>;
	} | null = null;

	constructor(network: N, options: InfoClientOptions = {}) {
		this.network = network;
		this.now = options.now ?? Date.now;
		this.transport =
			options.transport ??
			new HttpTransport({
				isTestnet: network === "testnet",
				apiUrl: networkConfig(network).apiUrl,
				timeout: options.timeoutMs ?? 30_000,
			});
	}

	/** Send an info request. `ttlMs: 0` bypasses the cache. */
	async info<T>(
		body: InfoBody,
		options: { ttlMs?: number; signal?: AbortSignal } = {},
	): Promise<Observed<T, N>> {
		const ttl = options.ttlMs ?? DEFAULT_TTLS[body.type] ?? 0;
		const key = JSON.stringify(body);
		const now = this.now();
		if (ttl > 0) {
			const hit = this.cache.get(key);
			if (hit && hit.expires > now) return hit.value as Promise<Observed<T, N>>;
		}
		const value = this.transport
			.request<T>("info", body, options.signal)
			.then((data) =>
				observed(
					this.network,
					`POST ${networkConfig(this.network).apiUrl}/info ${body.type}`,
					data,
					this.now(),
				),
			)
			.catch((error: unknown) => {
				this.cache.delete(key);
				const response = (error as { response?: Response })?.response;
				const message =
					(error as Error)?.message && (error as Error).message !== "undefined"
						? (error as Error).message
						: "Request failed";
				throw new InfoRequestError(
					this.network,
					body,
					message,
					response?.status ?? null,
					error,
				);
			});
		if (ttl > 0) this.cache.set(key, { expires: now + ttl, value });
		return value as Promise<Observed<T, N>>;
	}

	/** Fetch all metadata needed to build an asset universe. */
	async metadata(): Promise<Observed<RawMetadata, N>> {
		const [perpDexs, allPerpMetas, spotMeta, outcomeMeta] = await Promise.all([
			this.info<RawMetadata["perpDexs"]>({ type: "perpDexs" }),
			this.info<RawMetadata["allPerpMetas"]>({ type: "allPerpMetas" }),
			this.info<RawMetadata["spotMeta"]>({ type: "spotMeta" }),
			// outcomeMeta is newer; a failure must not take the resolver down.
			this.info<NonNullable<RawMetadata["outcomeMeta"]>>({
				type: "outcomeMeta",
			}).catch(() => null),
		]);
		const observedAt = Math.min(
			perpDexs.observedAt,
			allPerpMetas.observedAt,
			spotMeta.observedAt,
		);
		return observed(
			this.network,
			"perpDexs + allPerpMetas + spotMeta + outcomeMeta",
			{
				perpDexs: perpDexs.data,
				allPerpMetas: allPerpMetas.data,
				spotMeta: spotMeta.data,
				outcomeMeta: outcomeMeta?.data ?? null,
			},
			observedAt,
		);
	}

	/** Normalised asset universe, cached with the metadata TTL. */
	universe(options: { force?: boolean } = {}): Promise<AssetUniverse<N>> {
		const now = this.now();
		if (
			!options.force &&
			this.universeCache &&
			this.universeCache.expires > now
		) {
			return this.universeCache.value;
		}
		if (options.force) this.clear();
		const value = this.metadata().then((m) =>
			buildUniverse(this.network, m.data, m.observedAt),
		);
		value.catch(() => {
			this.universeCache = null;
		});
		this.universeCache = {
			expires: now + (DEFAULT_TTLS.spotMeta ?? 60_000),
			value,
		};
		return value;
	}

	/**
	 * A settled (no longer live) HIP-4 outcome. The API answers null for an
	 * outcome that is still open or never existed, so `data` is null then.
	 */
	async settledOutcome(
		outcome: number,
	): Promise<Observed<SettledOutcome<N> | null, N>> {
		const r = await this.info<RawSettledOutcome | null>({
			type: "settledOutcome",
			outcome,
		});
		return { ...r, data: normalizeSettledOutcome(this.network, r.data) };
	}

	/**
	 * The multi-sig signer set of a user, or null when the user is not a
	 * multi-sig user. This is the only info request that reveals multi-sig
	 * status (`userRole` keeps answering `user`).
	 */
	async multiSigSigners(user: string): Promise<Observed<Policy | null, N>> {
		const r = await this.info<RawMultiSigSigners | null>({
			type: "userToMultiSigSigners",
			user: user.toLowerCase(),
		});
		const data: Policy | null = r.data
			? {
					authorizedUsers: [...r.data.authorizedUsers]
						.map((a) => toAddress(a))
						.sort(),
					threshold: r.data.threshold,
					observedAt: r.observedAt,
				}
			: null;
		return { ...r, data };
	}

	userRole(user: string): Promise<Observed<UserRole, N>> {
		return this.info<UserRole>({ type: "userRole", user: user.toLowerCase() });
	}

	allMids(dex?: string): Promise<Observed<Record<string, string>, N>> {
		return this.info<Record<string, string>>(
			dex ? { type: "allMids", dex } : { type: "allMids" },
		);
	}

	clear(): void {
		this.cache.clear();
		this.universeCache = null;
	}
}

const clients: Partial<Record<Network, InfoClient<Network>>> = {};

/** Shared per-network client (explicit network, never a default). */
export function infoClient<N extends Network>(network: N): InfoClient<N> {
	const existing = clients[network];
	if (existing) return existing as InfoClient<N>;
	const created = new InfoClient(network);
	clients[network] = created;
	return created;
}

/** Raw POST for request bodies the user typed (shown verbatim in the UI). */
export async function rawInfoRequest<N extends Network>(
	network: N,
	body: unknown,
	signal?: AbortSignal,
): Promise<Observed<{ status: number; body: unknown }, N>> {
	const res = await fetch(`${networkConfig(network).apiUrl}/info`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	const text = await res.text();
	let parsed: unknown = text;
	try {
		parsed = JSON.parse(text);
	} catch {
		// keep text
	}
	return observed(network, `POST ${networkConfig(network).apiUrl}/info`, {
		status: res.status,
		body: parsed,
	});
}
