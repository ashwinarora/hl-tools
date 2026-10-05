import { Decimal, type RoundingMode } from "../decimal.ts";
import type { VenueKind } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { defineRuleSet, docs } from "./meta.ts";

export const PRECISION_RULES = defineRuleSet({
	id: "precision",
	title: "Tick & lot size",
	version: "1.1.0",
	verifiedAt: "2026-09-28",
	summary:
		"Prices: at most 5 significant figures and at most MAX_DECIMALS − szDecimals decimal places (MAX_DECIMALS = 6 for perps, 8 for spot and outcomes). Integer prices are always valid regardless of significant figures. Sizes: at most szDecimals decimal places. Signed numbers must have trailing zeros removed.",
	sources: [
		docs("for-developers/api/tick-and-lot-size", "Tick and lot size"),
		docs(
			"for-developers/api/asset-ids",
			"Asset IDs (outcomes share spot rules)",
		),
	],
	changelog: [
		{
			version: "1.0.0",
			date: "2026-09-28",
			note: "Initial encoding of perp/spot price and size rules.",
		},
		{
			version: "1.1.0",
			date: "2026-09-28",
			note: "HIP-3 dexes use perp MAX_DECIMALS; HIP-4 outcomes use spot MAX_DECIMALS.",
		},
	],
});

export const MAX_SIGNIFICANT_FIGURES = 5;

export const MAX_DECIMALS: Readonly<Record<VenueKind, number>> = {
	perp: 6,
	hip3: 6,
	spot: 8,
	outcome: 8,
};

export function maxPriceDecimals(venue: VenueKind, szDecimals: number): number {
	return Math.max(0, MAX_DECIMALS[venue] - szDecimals);
}

export interface PriceCheck {
	readonly value: Decimal;
	readonly valid: boolean;
	readonly sigFigs: number;
	readonly decimals: number;
	readonly maxDecimals: number;
	readonly isInteger: boolean;
	readonly issues: readonly Issue[];
}

export function checkPrice(
	px: Decimal,
	venue: VenueKind,
	szDecimals: number,
	path = "p",
): PriceCheck {
	const issues: Issue[] = [];
	const maxDecimals = maxPriceDecimals(venue, szDecimals);
	const sigFigs = px.significantFigures();
	const decimals = px.decimalPlaces();
	const isInteger = px.isInteger();
	if (px.isNegative()) {
		issues.push(
			issue("px.negative", "error", "Price must be positive.", { path }),
		);
	} else if (px.isZero()) {
		issues.push(issue("px.zero", "error", "Price must be positive.", { path }));
	}
	if (!isInteger && sigFigs > MAX_SIGNIFICANT_FIGURES) {
		issues.push(
			issue(
				"px.too_many_sig_figs",
				"error",
				`${px.toString()} has ${sigFigs} significant figures; non-integer prices allow at most ${MAX_SIGNIFICANT_FIGURES}.`,
				{
					path,
					fix: "Round to 5 significant figures, or use an integer price (always valid).",
				},
			),
		);
	}
	if (decimals > maxDecimals) {
		issues.push(
			issue(
				"px.too_many_decimals",
				"error",
				`${px.toString()} has ${decimals} decimal places; this market allows at most ${maxDecimals} (${MAX_DECIMALS[venue]} − szDecimals ${szDecimals}).`,
				{ path, fix: `Round the price to ${maxDecimals} decimal places.` },
			),
		);
	}
	return {
		value: px,
		valid: issues.every((i) => i.severity !== "error"),
		sigFigs,
		decimals,
		maxDecimals,
		isInteger,
		issues,
	};
}

export interface SizeCheck {
	readonly value: Decimal;
	readonly valid: boolean;
	readonly decimals: number;
	readonly maxDecimals: number;
	readonly issues: readonly Issue[];
}

export function checkSize(
	sz: Decimal,
	szDecimals: number,
	path = "s",
): SizeCheck {
	const issues: Issue[] = [];
	const decimals = sz.decimalPlaces();
	if (sz.isNegative()) {
		issues.push(
			issue(
				"sz.negative",
				"error",
				"Size must be positive; direction is set by `b` (isBuy).",
				{ path },
			),
		);
	}
	if (decimals > szDecimals) {
		issues.push(
			issue(
				"sz.too_many_decimals",
				"error",
				`${sz.toString()} has ${decimals} decimal places; szDecimals for this market is ${szDecimals}.`,
				{ path, fix: `Round the size to ${szDecimals} decimal places.` },
			),
		);
	}
	return {
		value: sz,
		valid: issues.every((i) => i.severity !== "error"),
		decimals,
		maxDecimals: szDecimals,
		issues,
	};
}

export type RoundDirection = "unchanged" | "up" | "down";

export interface Rounded {
	readonly input: Decimal;
	readonly value: Decimal;
	readonly direction: RoundDirection;
}

function direction(input: Decimal, value: Decimal): RoundDirection {
	const c = value.cmp(input);
	return c === 0 ? "unchanged" : c > 0 ? "up" : "down";
}

/**
 * Round a price to the nearest valid tick using `mode`.
 *
 * Prices with 5+ integer digits are rounded to an integer (integers are always
 * valid). Otherwise the price is rounded to 5 significant figures and then to
 * the market's maximum decimals — the same order the Python SDK uses.
 */
export function roundPrice(
	px: Decimal,
	venue: VenueKind,
	szDecimals: number,
	mode: RoundingMode = "half-even",
): Rounded {
	const maxDecimals = maxPriceDecimals(venue, szDecimals);
	let value: Decimal;
	if (px.integerDigits() >= MAX_SIGNIFICANT_FIGURES) {
		value = px.roundToDecimals(0, mode);
	} else {
		value = px
			.roundToSignificantFigures(MAX_SIGNIFICANT_FIGURES, mode)
			.roundToDecimals(maxDecimals, mode);
	}
	return { input: px, value, direction: direction(px, value) };
}

export function roundSize(
	sz: Decimal,
	szDecimals: number,
	mode: RoundingMode = "down",
): Rounded {
	const value = sz.roundToDecimals(szDecimals, mode);
	return { input: sz, value, direction: direction(sz, value) };
}

/** Smallest representable size increment (lot) for `szDecimals`. */
export function lotSize(szDecimals: number): Decimal {
	return Decimal.fromScaled(1n, szDecimals);
}
