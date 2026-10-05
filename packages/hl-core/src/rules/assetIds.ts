import { defineRuleSet, docs } from "./meta.ts";

export const ASSET_ID_RULES = defineRuleSet({
	id: "asset-ids",
	title: "Asset IDs & coin names",
	version: "1.0.0",
	verifiedAt: "2026-09-28",
	summary:
		"Perps: index in meta.universe. Spot: 10000 + spotMeta.universe[].index (the explicit index, which is not the array position on either network). HIP-3: 100000 + perpDexIndex × 10000 + index in that dex's universe. HIP-4 outcomes: encoding = 10 × outcome + side; coin '#<encoding>', token '+<encoding>', asset ID 100000000 + encoding. Spot coins are 'PURR/USDC' or '@<index>'. Token index, spot index and asset ID differ, and differ between mainnet and testnet.",
	sources: [
		docs("for-developers/api/asset-ids", "Asset IDs"),
		docs(
			"for-developers/api/info-endpoint",
			"Info endpoint (perpetuals vs spot)",
		),
		docs(
			"hyperliquid-improvement-proposals-hips/hip-4-outcome-markets",
			"HIP-4",
		),
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-09-28",
			note: "Perp, spot, HIP-3 and HIP-4 formulas. Spot universe normalised by explicit `index` after observing position ≠ index on both networks.",
		},
	],
});

export const SPOT_ASSET_OFFSET = 10_000;
export const HIP3_ASSET_OFFSET = 100_000;
export const HIP3_DEX_STRIDE = 10_000;
export const OUTCOME_ASSET_OFFSET = 100_000_000;

export function spotAssetId(spotPairIndex: number): number {
	return SPOT_ASSET_OFFSET + spotPairIndex;
}

export function hip3AssetId(perpDexIndex: number, indexInMeta: number): number {
	if (perpDexIndex < 1) throw new RangeError("HIP-3 dex index starts at 1");
	return HIP3_ASSET_OFFSET + perpDexIndex * HIP3_DEX_STRIDE + indexInMeta;
}

export function outcomeEncoding(outcome: number, side: 0 | 1): number {
	return 10 * outcome + side;
}

export function outcomeAssetId(outcome: number, side: 0 | 1): number {
	return OUTCOME_ASSET_OFFSET + outcomeEncoding(outcome, side);
}

export type DecodedAssetId =
	| { kind: "perp"; index: number }
	| { kind: "spot"; spotPairIndex: number }
	| { kind: "hip3"; perpDexIndex: number; index: number }
	| { kind: "outcome"; outcome: number; side: 0 | 1; encoding: number }
	| { kind: "invalid"; reason: string };

/** Decode an action asset ID into its structural parts (no metadata needed). */
export function decodeAssetId(id: number): DecodedAssetId {
	if (!Number.isSafeInteger(id) || id < 0) {
		return { kind: "invalid", reason: "Asset IDs are non-negative integers." };
	}
	if (id >= OUTCOME_ASSET_OFFSET) {
		const encoding = id - OUTCOME_ASSET_OFFSET;
		const side = encoding % 10;
		if (side > 1) {
			return {
				kind: "invalid",
				reason: `Outcome encoding ${encoding} has side ${side}; only 0 and 1 are valid.`,
			};
		}
		return {
			kind: "outcome",
			outcome: Math.floor(encoding / 10),
			side: side as 0 | 1,
			encoding,
		};
	}
	if (id >= HIP3_ASSET_OFFSET) {
		const rest = id - HIP3_ASSET_OFFSET;
		return {
			kind: "hip3",
			perpDexIndex: Math.floor(rest / HIP3_DEX_STRIDE),
			index: rest % HIP3_DEX_STRIDE,
		};
	}
	if (id >= SPOT_ASSET_OFFSET) {
		return { kind: "spot", spotPairIndex: id - SPOT_ASSET_OFFSET };
	}
	return { kind: "perp", index: id };
}
