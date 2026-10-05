/**
 * Normalise Hyperliquid metadata into typed, network-branded identities.
 *
 * Rules:
 * - Spot pairs and tokens are keyed by their explicit `index` field. On both
 *   networks the array position differs from `index`, so positional lookups
 *   silently return the wrong asset.
 * - Perp asset IDs *are* defined by position in a dex's `universe` (the
 *   protocol has no other identifier). We read the position exactly once,
 *   here, and store it as `perpIndex`; nothing downstream indexes arrays.
 * - A perp dex's index is its position in `perpDexs`; we cross-check it
 *   against the `dex:` prefix of the coins in `allPerpMetas` and drop dexes
 *   whose metadata does not line up.
 */

import {
	ActionAssetId,
	type Asset,
	OutcomeId,
	PerpDexIndex,
	PerpIndex,
	SpotPairIndex,
	TokenIndex,
	type TokenRef,
	type Venue,
} from "../identity.ts";
import type { Network } from "../network.ts";
import {
	hip3AssetId,
	outcomeAssetId,
	outcomeEncoding,
	spotAssetId,
} from "../rules/assetIds.ts";
import { maxPriceDecimals } from "../rules/precision.ts";

export interface RawPerpAsset {
	name: string;
	szDecimals: number;
	maxLeverage: number;
	marginTableId?: number;
	isDelisted?: boolean;
	onlyIsolated?: boolean;
	marginMode?: string;
	growthMode?: string;
	deployerFeeScale?: string;
	[key: string]: unknown;
}

export interface RawPerpMeta {
	universe: RawPerpAsset[];
	collateralToken?: number;
	marginTables?: unknown;
}

export interface RawPerpDex {
	name: string;
	fullName?: string | null;
	deployer?: string | null;
	oracleUpdater?: string | null;
	feeRecipient?: string | null;
	[key: string]: unknown;
}

export interface RawSpotPair {
	tokens: [number, number];
	name: string;
	index: number;
	isCanonical: boolean;
}

export interface RawToken {
	name: string;
	szDecimals: number;
	weiDecimals: number;
	index: number;
	tokenId: string;
	isCanonical: boolean;
	evmContract: { address: string; evm_extra_wei_decimals: number } | null;
	fullName: string | null;
	deployerTradingFeeShare?: string;
	[key: string]: unknown;
}

export interface RawSpotMeta {
	universe: RawSpotPair[];
	tokens: RawToken[];
}

export interface RawOutcome {
	outcome: number;
	name: string;
	description: string;
	sideSpecs: { name: string; token?: number }[];
	quoteToken?: string;
	venue?: string;
	[key: string]: unknown;
}

export interface RawQuestion {
	question: number;
	name: string;
	description: string;
	fallbackOutcome: number;
	namedOutcomes: number[];
	settledNamedOutcomes?: number[];
}

export interface RawOutcomeMeta {
	outcomes: RawOutcome[];
	questions?: RawQuestion[];
	[key: string]: unknown;
}

export interface RawMetadata {
	/** `perpDexs` response (index 0 is null = first dex). */
	perpDexs: (RawPerpDex | null)[];
	/** `allPerpMetas` response (parallel to perpDexs). */
	allPerpMetas: RawPerpMeta[];
	spotMeta: RawSpotMeta;
	outcomeMeta: RawOutcomeMeta | null;
}

export interface DexInfo<N extends Network = Network> {
	readonly network: N;
	readonly index: PerpDexIndex<N>;
	/** "" for the first dex. */
	readonly name: string;
	readonly fullName: string | null;
	readonly deployer: string | null;
	readonly collateralToken: TokenRef<N> | null;
	readonly assetCount: number;
}

export interface NormalizationWarning {
	readonly code: string;
	readonly message: string;
}

export interface AssetUniverse<N extends Network = Network> {
	readonly network: N;
	readonly observedAt: number;
	readonly assets: readonly Asset<N>[];
	readonly tokens: readonly TokenRef<N>[];
	readonly dexes: readonly DexInfo<N>[];
	readonly warnings: readonly NormalizationWarning[];
	readonly byCoin: ReadonlyMap<string, Asset<N>>;
	readonly byActionId: ReadonlyMap<number, Asset<N>>;
	readonly tokensByIndex: ReadonlyMap<number, TokenRef<N>>;
	readonly spotByIndex: ReadonlyMap<number, Asset<N>>;
}

function tokenRef<N extends Network>(network: N, t: RawToken): TokenRef<N> {
	return {
		network,
		index: TokenIndex(network, t.index),
		name: t.name,
		szDecimals: t.szDecimals,
		weiDecimals: t.weiDecimals,
		tokenId: t.tokenId,
		fullName: t.fullName ?? null,
		evmContract: t.evmContract
			? {
					address: t.evmContract.address,
					evmExtraWeiDecimals: t.evmContract.evm_extra_wei_decimals,
				}
			: null,
		isCanonical: t.isCanonical,
	};
}

/** "template:Yes" → "Yes". */
export function cleanTemplateName(name: string): string {
	return name.startsWith("template:") ? name.slice("template:".length) : name;
}

/** Parse "k:v|k:v" outcome descriptions used by recurring templates. */
export function parseOutcomeDescription(
	description: string,
): Record<string, string> | null {
	if (!description.includes("|") && !/^[A-Za-z]+:/.test(description))
		return null;
	const out: Record<string, string> = {};
	for (const part of description.split("|")) {
		const idx = part.indexOf(":");
		if (idx <= 0) return null;
		out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
	}
	return out;
}

export function buildUniverse<N extends Network>(
	network: N,
	raw: RawMetadata,
	observedAt = Date.now(),
): AssetUniverse<N> {
	const warnings: NormalizationWarning[] = [];
	const tokens = raw.spotMeta.tokens.map((t) => tokenRef(network, t));
	const tokensByIndex = new Map<number, TokenRef<N>>();
	for (const t of tokens) {
		if (tokensByIndex.has(t.index)) {
			warnings.push({
				code: "token.duplicate_index",
				message: `Duplicate token index ${t.index}`,
			});
		}
		tokensByIndex.set(t.index, t);
	}
	const assets: Asset<N>[] = [];
	const dexes: DexInfo<N>[] = [];

	// ── Perps (first dex + HIP-3) ──
	const dexCount = Math.max(raw.perpDexs.length, raw.allPerpMetas.length);
	for (let d = 0; d < dexCount; d++) {
		const meta = raw.allPerpMetas[d];
		const dex = raw.perpDexs[d] ?? null;
		if (!meta) {
			warnings.push({
				code: "dex.missing_meta",
				message: `No meta for perp dex ${d}`,
			});
			continue;
		}
		const dexName = d === 0 ? "" : (dex?.name ?? "");
		if (d > 0 && !dex) {
			warnings.push({
				code: "dex.missing_entry",
				message: `perpDexs[${d}] is null but meta exists`,
			});
			continue;
		}
		const firstCoin = meta.universe[0]?.name;
		if (d > 0 && firstCoin && !firstCoin.startsWith(`${dexName}:`)) {
			warnings.push({
				code: "dex.prefix_mismatch",
				message: `Dex ${d} is "${dexName}" but its first coin is "${firstCoin}"; skipped rather than guessing.`,
			});
			continue;
		}
		const dexIndex = PerpDexIndex(network, d);
		const collateral =
			meta.collateralToken !== undefined
				? (tokensByIndex.get(meta.collateralToken) ?? null)
				: null;
		dexes.push({
			network,
			index: dexIndex,
			name: dexName,
			fullName: d === 0 ? "Hyperliquid" : (dex?.fullName ?? null),
			deployer: d === 0 ? null : (dex?.deployer ?? null),
			collateralToken: collateral,
			assetCount: meta.universe.length,
		});
		const quote = collateral?.name ?? "USDC";
		meta.universe.forEach((p, position) => {
			const perpIndex = PerpIndex(network, position);
			const venue: Venue<N> =
				d === 0
					? { kind: "perp", network, dex: "" }
					: {
							kind: "hip3",
							network,
							dex: dexName,
							dexIndex,
							dexFullName: dex?.fullName ?? null,
							deployer: dex?.deployer ?? null,
						};
			const base = d === 0 ? p.name : p.name.slice(dexName.length + 1);
			const id = d === 0 ? position : hip3AssetId(d, position);
			assets.push({
				network,
				venue,
				origin: d === 0 ? "native" : "hip3",
				coin: p.name,
				displaySymbol: d === 0 ? `${p.name}-PERP` : p.name,
				base,
				quote,
				actionAssetId: ActionAssetId(network, id),
				szDecimals: p.szDecimals,
				pxDecimals: maxPriceDecimals(d === 0 ? "perp" : "hip3", p.szDecimals),
				perpIndex,
				maxLeverage: p.maxLeverage,
				onlyIsolated: p.onlyIsolated ?? false,
				isDelisted: p.isDelisted ?? false,
				marginTableId: p.marginTableId,
				raw: {
					perpDexIndex: d,
					positionInUniverse: position,
					meta: p,
					collateralToken: meta.collateralToken ?? null,
				},
			});
		});
	}

	// ── Spot pairs (by explicit index) ──
	const spotByIndex = new Map<number, Asset<N>>();
	for (const pair of raw.spotMeta.universe) {
		const [baseIdx, quoteIdx] = pair.tokens;
		const baseToken = tokensByIndex.get(baseIdx);
		const quoteToken = tokensByIndex.get(quoteIdx);
		if (!baseToken || !quoteToken) {
			warnings.push({
				code: "spot.missing_token",
				message: `Spot pair ${pair.name} (index ${pair.index}) references unknown token ${!baseToken ? baseIdx : quoteIdx}`,
			});
			continue;
		}
		const asset: Asset<N> = {
			network,
			venue: { kind: "spot", network },
			origin: "native",
			coin: pair.name,
			displaySymbol: `${baseToken.name}/${quoteToken.name}`,
			base: baseToken.name,
			quote: quoteToken.name,
			actionAssetId: ActionAssetId(network, spotAssetId(pair.index)),
			szDecimals: baseToken.szDecimals,
			pxDecimals: maxPriceDecimals("spot", baseToken.szDecimals),
			spotPairIndex: SpotPairIndex(network, pair.index),
			baseToken,
			quoteToken,
			isCanonical: pair.isCanonical,
			raw: {
				pair,
				baseToken: raw.spotMeta.tokens.find((t) => t.index === baseIdx),
				quoteToken: raw.spotMeta.tokens.find((t) => t.index === quoteIdx),
			},
		};
		if (spotByIndex.has(pair.index)) {
			warnings.push({
				code: "spot.duplicate_index",
				message: `Duplicate spot index ${pair.index}`,
			});
		}
		spotByIndex.set(pair.index, asset);
		assets.push(asset);
	}

	// ── Outcomes (HIP-4) ──
	if (raw.outcomeMeta) {
		const questionByOutcome = new Map<number, RawQuestion>();
		for (const q of raw.outcomeMeta.questions ?? []) {
			for (const o of [...q.namedOutcomes, q.fallbackOutcome])
				questionByOutcome.set(o, q);
		}
		for (const o of raw.outcomeMeta.outcomes) {
			o.sideSpecs.slice(0, 2).forEach((side, sideIdx) => {
				const s = sideIdx as 0 | 1;
				const encoding = outcomeEncoding(o.outcome, s);
				const q = questionByOutcome.get(o.outcome);
				const sideName = cleanTemplateName(side.name);
				const name = cleanTemplateName(o.name);
				assets.push({
					network,
					venue: { kind: "outcome", network },
					origin: "hip4",
					coin: `#${encoding}`,
					displaySymbol: `${name} · ${sideName}`,
					base: `+${encoding}`,
					quote: o.quoteToken ?? "USDC",
					actionAssetId: ActionAssetId(network, outcomeAssetId(o.outcome, s)),
					// outcomeMeta does not publish size decimals for outcome tokens.
					szDecimals: null,
					pxDecimals: null,
					outcome: {
						outcomeId: OutcomeId(network, o.outcome),
						side: s,
						sideName,
						encoding,
						tokenName: `+${encoding}`,
						name,
						description: o.description,
						questionId: q?.question ?? null,
						questionName: q ? cleanTemplateName(q.name) : null,
					},
					raw: { outcome: o, question: q ?? null },
				});
			});
		}
	}

	const byCoin = new Map<string, Asset<N>>();
	const byActionId = new Map<number, Asset<N>>();
	for (const a of assets) {
		if (byCoin.has(a.coin)) {
			warnings.push({
				code: "coin.duplicate",
				message: `Duplicate coin ${a.coin}`,
			});
		}
		byCoin.set(a.coin, a);
		byActionId.set(a.actionAssetId, a);
	}
	return {
		network,
		observedAt,
		assets,
		tokens,
		dexes,
		warnings,
		byCoin,
		byActionId,
		tokensByIndex,
		spotByIndex,
	};
}
