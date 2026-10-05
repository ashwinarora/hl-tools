/**
 * Typed identifiers.
 *
 * Every protocol identifier is branded with the `Network` it came from, so a
 * testnet asset ID cannot be passed where a mainnet one is expected:
 *
 * ```ts
 * declare const btc: Asset<"testnet">;
 * buildOrderAction(mainnetCtx, btc); // ✗ compile error
 * ```
 *
 * Brands are erased at runtime; `network` fields are kept on every record so
 * the same guarantee can be re-checked with `assertNetwork`.
 */

import type { Network } from "./network.ts";

declare const brand: unique symbol;
type Brand<T, B extends string, N extends Network> = T & {
	readonly [brand]: { readonly kind: B; readonly network: N };
};

/** Integer used in `order`/`cancel` actions (`a` field). */
export type ActionAssetId<N extends Network = Network> = Brand<
	number,
	"ActionAssetId",
	N
>;
/** Index into `spotMeta.tokens` (by the explicit `index` field). */
export type TokenIndex<N extends Network = Network> = Brand<
	number,
	"TokenIndex",
	N
>;
/** Index of a spot pair (explicit `index` field of `spotMeta.universe`). */
export type SpotPairIndex<N extends Network = Network> = Brand<
	number,
	"SpotPairIndex",
	N
>;
/** Index of a perp within its dex's `meta.universe`. */
export type PerpIndex<N extends Network = Network> = Brand<
	number,
	"PerpIndex",
	N
>;
/** Index of a perp dex in `perpDexs` (0 = the first/native dex). */
export type PerpDexIndex<N extends Network = Network> = Brand<
	number,
	"PerpDexIndex",
	N
>;
/** HIP-4 outcome id from `outcomeMeta.outcomes[].outcome`. */
export type OutcomeId<N extends Network = Network> = Brand<
	number,
	"OutcomeId",
	N
>;
/** Checksum-insensitive lowercase 0x address. */
export type Address = `0x${string}` & { readonly [brand]: "Address" };

export const ActionAssetId = <N extends Network>(_n: N, v: number) =>
	v as ActionAssetId<N>;
export const TokenIndex = <N extends Network>(_n: N, v: number) =>
	v as TokenIndex<N>;
export const SpotPairIndex = <N extends Network>(_n: N, v: number) =>
	v as SpotPairIndex<N>;
export const PerpIndex = <N extends Network>(_n: N, v: number) =>
	v as PerpIndex<N>;
export const PerpDexIndex = <N extends Network>(_n: N, v: number) =>
	v as PerpDexIndex<N>;
export const OutcomeId = <N extends Network>(_n: N, v: number) =>
	v as OutcomeId<N>;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: unknown): value is string {
	return typeof value === "string" && ADDRESS_RE.test(value);
}

/**
 * Normalise an address to lowercase. Hyperliquid recommends lowercasing every
 * address before signing (some fields are parsed as bytes and lowercased
 * network-wide, so mixed case changes the hash).
 */
export function toAddress(value: string): Address {
	if (!isAddress(value)) {
		throw new TypeError(`"${value}" is not a 20-byte hex address`);
	}
	return value.toLowerCase() as Address;
}

/** Where an asset trades. */
export type VenueKind = "perp" | "spot" | "hip3" | "outcome";

export type Venue<N extends Network = Network> =
	| { readonly kind: "perp"; readonly network: N; readonly dex: "" }
	| {
			readonly kind: "hip3";
			readonly network: N;
			readonly dex: string;
			readonly dexIndex: PerpDexIndex<N>;
			readonly dexFullName: string | null;
			readonly deployer: string | null;
	  }
	| { readonly kind: "spot"; readonly network: N }
	| { readonly kind: "outcome"; readonly network: N };

/**
 * How the market came to exist: the first perp dex and the spot order books
 * are native HyperCore venues; HIP-3 perps are builder-deployed dexes; HIP-4
 * outcomes are outcome markets.
 */
export type AssetOrigin = "native" | "hip3" | "hip4";

export interface TokenRef<N extends Network = Network> {
	readonly network: N;
	readonly index: TokenIndex<N>;
	readonly name: string;
	readonly szDecimals: number;
	readonly weiDecimals: number;
	readonly tokenId: string;
	readonly fullName: string | null;
	readonly evmContract: {
		readonly address: string;
		readonly evmExtraWeiDecimals: number;
	} | null;
	readonly isCanonical: boolean;
}

/**
 * A tradeable identity on one network. `actionAssetId` is what goes in the
 * `a` field of orders; `coin` is what info/WS requests expect.
 */
export interface Asset<N extends Network = Network> {
	readonly network: N;
	readonly venue: Venue<N>;
	readonly origin: AssetOrigin;
	/** Info / WebSocket `coin` string (e.g. "BTC", "@107", "xyz:TSLA", "#12090"). */
	readonly coin: string;
	/** Human-facing symbol (e.g. "HYPE/USDC", "BTC-PERP", "xyz:TSLA"). */
	readonly displaySymbol: string;
	readonly base: string;
	readonly quote: string;
	readonly actionAssetId: ActionAssetId<N>;
	/** Size decimals (lot size = 10^-szDecimals). `null` if the protocol doesn't publish it. */
	readonly szDecimals: number | null;
	/** Max price decimals = MAX_DECIMALS(venue) - szDecimals. */
	readonly pxDecimals: number | null;
	/** Perp-only: index within the dex's universe. */
	readonly perpIndex?: PerpIndex<N>;
	/** Spot-only: explicit spot pair index. */
	readonly spotPairIndex?: SpotPairIndex<N>;
	/** Spot-only: base and quote token references. */
	readonly baseToken?: TokenRef<N>;
	readonly quoteToken?: TokenRef<N>;
	/** Outcome-only. */
	readonly outcome?: {
		readonly outcomeId: OutcomeId<N>;
		readonly side: 0 | 1;
		readonly sideName: string;
		readonly encoding: number;
		readonly tokenName: string;
		readonly name: string;
		readonly description: string;
		readonly questionId: number | null;
		readonly questionName: string | null;
	};
	/** Perp-only extras. */
	readonly maxLeverage?: number;
	readonly onlyIsolated?: boolean;
	readonly isDelisted?: boolean;
	readonly marginTableId?: number;
	/** Spot-only: canonical pair flag from spotMeta. */
	readonly isCanonical?: boolean;
	/** The raw metadata object(s) this identity was normalised from. */
	readonly raw: Readonly<Record<string, unknown>>;
}

/** Who produced a signature. */
export type SignerKind = "user" | "agent" | "vault";

export interface Signer<N extends Network = Network> {
	readonly network: N;
	readonly kind: SignerKind;
	/** Address that produced the signature. */
	readonly address: Address;
	/**
	 * Account the action applies to. For agents this is the master account,
	 * for vault/sub-account actions it is the `vaultAddress`.
	 */
	readonly actsFor: Address | null;
}

export interface Account<N extends Network = Network> {
	readonly network: N;
	readonly address: Address;
	readonly role:
		| "user"
		| "agent"
		| "vault"
		| "subAccount"
		| "missing"
		| "unknown";
	/** For agents / sub-accounts: the master account. */
	readonly master?: Address;
}

/** A value observed from the network at a point in time. */
export interface Observed<T, N extends Network = Network> {
	readonly network: N;
	readonly observedAt: number;
	readonly source: string;
	readonly data: T;
}

export function observed<T, N extends Network>(
	network: N,
	source: string,
	data: T,
	observedAt = Date.now(),
): Observed<T, N> {
	return { network, source, data, observedAt };
}
