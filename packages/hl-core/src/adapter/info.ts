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
import { allApiWallets } from "../multisig/account.ts";
import {
	type Delegation,
	parseDelegations,
	parseDelegatorHistory,
	parseDelegatorSummary,
	parseValidators,
	type StakingEvent,
	type StakingSummary,
	type Validator,
} from "../multisig/staking.ts";
import type { Policy } from "../multisig/types.ts";
import {
	parseVaultDetails,
	parseVaultEquities,
	type VaultDeposit,
	type VaultLookup,
} from "../multisig/vault.ts";
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
	// Multi-sig policy and account state: short, so a rotation shows up quickly.
	userToMultiSigSigners: 10_000,
	userRole: 10_000,
	userAbstraction: 10_000,
	extraAgents: 10_000,
	webData3: 10_000,
	userVaultEquities: 10_000,
	// a vault's name, leader and terms change rarely; its figures by the hour
	vaultDetails: 60_000,
	clearinghouseState: 10_000,
	spotClearinghouseState: 10_000,
	openOrders: 10_000,
};

/** `userRole` info response. A multi-sig user still reports `user`. */
export type UserRole =
	| { readonly role: "user" }
	| { readonly role: "agent"; readonly data: { readonly user: string } }
	| { readonly role: "vault" }
	| { readonly role: "subAccount"; readonly data: { readonly master: string } }
	| { readonly role: "missing" };

/** `extraAgents` entry: an approved API wallet. */
export interface AgentInfo {
	readonly name: string;
	readonly address: string;
	/** Unix ms; agents expire and must be re-approved. */
	readonly validUntil: number;
}

/** The parts of `clearinghouseState` the hub reads. */
export interface PerpState {
	readonly marginSummary: {
		readonly accountValue: string;
		readonly totalNtlPos: string;
		readonly totalMarginUsed: string;
	};
	readonly withdrawable: string;
	readonly assetPositions: readonly {
		readonly position: {
			readonly coin: string;
			readonly szi: string;
			readonly entryPx: string | null;
			readonly unrealizedPnl: string;
		};
	}[];
	readonly time: number;
}

/** The parts of `spotClearinghouseState` the hub reads. */
export interface SpotState {
	readonly balances: readonly {
		readonly coin: string;
		readonly token: number;
		readonly total: string;
		readonly hold: string;
	}[];
}

/** One `openOrders` entry. */
export interface OpenOrder {
	readonly coin: string;
	readonly side: "A" | "B";
	readonly limitPx: string;
	readonly sz: string;
	readonly oid: number;
	readonly timestamp: number;
	readonly origSz: string;
}

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

	/**
	 * Send an info request. `ttlMs: 0` bypasses the cache; `fresh` asks the
	 * network whatever is cached and keeps the new answer for later callers.
	 */
	async info<T>(
		body: InfoBody,
		options: { ttlMs?: number; signal?: AbortSignal; fresh?: boolean } = {},
	): Promise<Observed<T, N>> {
		const ttl = options.ttlMs ?? DEFAULT_TTLS[body.type] ?? 0;
		const key = JSON.stringify(body);
		const now = this.now();
		if (ttl > 0 && !options.fresh) {
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
	async multiSigSigners(
		user: string,
		options: {
			/** Read before signing or submitting: not from the cache. */ fresh?: boolean;
			signal?: AbortSignal;
		} = {},
	): Promise<Observed<Policy | null, N>> {
		const r = await this.info<RawMultiSigSigners | null>(
			{ type: "userToMultiSigSigners", user: user.toLowerCase() },
			options,
		);
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

	userRole(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<UserRole, N>> {
		return this.info<UserRole>(
			{ type: "userRole", user: user.toLowerCase() },
			options,
		);
	}

	/**
	 * The account's mode: `default`, `disabled`, `unifiedAccount`,
	 * `portfolioMargin` or `dexAbstraction` (see rules/transfers.ts and the
	 * core's `accountMode`). An address never used answers `default`.
	 */
	userAbstraction(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<string, N>> {
		return this.info<string>(
			{ type: "userAbstraction", user: user.toLowerCase() },
			options,
		);
	}

	/** Approved API wallets of a user. Agents of a multi-sig user trade without an envelope. */
	extraAgents(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<readonly AgentInfo[], N>> {
		return this.info<readonly AgentInfo[]>(
			{ type: "extraAgents", user: user.toLowerCase() },
			options,
		);
	}

	/**
	 * Every API wallet of a user: the named ones (`extraAgents`) and the one
	 * approved without a name, which that list leaves out and `webData3`
	 * carries. Fails when either read fails or does not say: a list that may
	 * be short one wallet must not be shown as the list.
	 */
	async apiWallets(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<readonly AgentInfo[], N>> {
		const body = { type: "webData3", user: user.toLowerCase() };
		const [named, web] = await Promise.all([
			this.extraAgents(user, options),
			this.info<unknown>(body, options),
		]);
		const all = allApiWallets(named.data, web.data);
		if (!all)
			throw new InfoRequestError(
				this.network,
				body,
				"The answer does not say whether the account has an API wallet without a name.",
				200,
				null,
			);
		return observed(
			this.network,
			"extraAgents + webData3",
			all,
			Math.min(named.observedAt, web.observedAt),
		);
	}

	clearinghouseState(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<PerpState, N>> {
		return this.info<PerpState>(
			{ type: "clearinghouseState", user: user.toLowerCase() },
			options,
		);
	}

	spotClearinghouseState(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<SpotState, N>> {
		return this.info<SpotState>(
			{ type: "spotClearinghouseState", user: user.toLowerCase() },
			options,
		);
	}

	openOrders(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<readonly OpenOrder[], N>> {
		return this.info<readonly OpenOrder[]>(
			{ type: "openOrders", user: user.toLowerCase() },
			options,
		);
	}

	/**
	 * Hyperliquid's own clock, in milliseconds (`exchangeStatus`). A lockup
	 * ends by this clock, not by the reader's: a device that runs fast would
	 * otherwise send an unstake too early. Null when the answer carries no time.
	 */
	async exchangeTime(
		options: { signal?: AbortSignal } = {},
	): Promise<Observed<number | null, N>> {
		const r = await this.info<unknown>(
			{ type: "exchangeStatus" },
			{ ...options, fresh: true },
		);
		const time =
			r.data && typeof r.data === "object"
				? (r.data as { time?: unknown }).time
				: null;
		return {
			...r,
			data:
				typeof time === "number" && Number.isSafeInteger(time) && time > 0
					? time
					: null,
		};
	}

	/**
	 * An account's staking balance. Staking is on no WebSocket channel, so it
	 * is asked for. Null when the answer has a shape this version cannot read.
	 */
	async delegatorSummary(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<StakingSummary | null, N>> {
		const r = await this.info<unknown>(
			{ type: "delegatorSummary", user: user.toLowerCase() },
			options,
		);
		return { ...r, data: parseDelegatorSummary(r.data) };
	}

	/** Every vault an account has money in, each with what it is worth and the end of its lockup. */
	async vaultDeposits(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<VaultDeposit[] | null, N>> {
		const r = await this.info<unknown>(
			{ type: "userVaultEquities", user: user.toLowerCase() },
			options,
		);
		return { ...r, data: parseVaultEquities(r.data) };
	}

	/**
	 * What Hyperliquid reports about a vault; with `user`, also that account's
	 * deposit in it. An address that is no vault answers `none`.
	 */
	async vault(
		vaultAddress: string,
		user?: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<VaultLookup, N>> {
		const r = await this.info<unknown>(
			{
				type: "vaultDetails",
				vaultAddress: vaultAddress.toLowerCase(),
				...(user ? { user: user.toLowerCase() } : {}),
			},
			options,
		);
		return { ...r, data: parseVaultDetails(r.data) };
	}

	/** An account's stakes, one per validator, each with the end of its lockup. */
	async delegations(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<Delegation[] | null, N>> {
		const r = await this.info<unknown>(
			{ type: "delegations", user: user.toLowerCase() },
			options,
		);
		return { ...r, data: parseDelegations(r.data) };
	}

	/** Every staking step of an account, newest first. */
	async delegatorHistory(
		user: string,
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<StakingEvent[] | null, N>> {
		const r = await this.info<unknown>(
			{ type: "delegatorHistory", user: user.toLowerCase() },
			options,
		);
		return { ...r, data: parseDelegatorHistory(r.data) };
	}

	/**
	 * Every validator with its state. The request is not in Hyperliquid's API
	 * documentation (rules/staking.ts), so a caller has to cope with null.
	 */
	async validatorSummaries(
		options: { fresh?: boolean; signal?: AbortSignal } = {},
	): Promise<Observed<Validator[] | null, N>> {
		const r = await this.info<unknown>({ type: "validatorSummaries" }, options);
		return { ...r, data: parseValidators(r.data) };
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
