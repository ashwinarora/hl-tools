/**
 * Pre-flight precision linter. It never rounds silently: it reports the
 * exact wire string for what was entered, whether that is valid, and — when
 * it isn't — the nearest valid values in each direction with the delta, so
 * the caller has to choose one explicitly.
 */

import { Decimal } from "../decimal.ts";
import type { Asset } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { MIN_ORDER_NOTIONAL } from "../rules/orders.ts";
import {
	checkPrice,
	checkSize,
	lotSize,
	maxPriceDecimals,
	roundPrice,
} from "../rules/precision.ts";

export interface RoundingOption {
	readonly direction: "down" | "up";
	readonly value: string;
	readonly delta: string;
}

export interface FieldLint {
	readonly input: string;
	/** Parsed value, or null if the input is not a decimal. */
	readonly parsed: Decimal | null;
	/** Canonical wire string of the input exactly as entered (trailing zeros removed). */
	readonly wire: string | null;
	readonly valid: boolean;
	readonly issues: readonly Issue[];
	/** Valid values bracketing the input, when the input itself is invalid. */
	readonly options: readonly RoundingOption[];
	/** Human description of the rule applied. */
	readonly rule: string;
}

function opt(
	input: Decimal,
	value: Decimal,
	direction: "down" | "up",
): RoundingOption {
	return {
		direction,
		value: value.toString(),
		delta: value.sub(input).toString(),
	};
}

export function lintPrice(input: string, asset: Asset, path = "p"): FieldLint {
	const venue = asset.venue.kind;
	const sz = asset.szDecimals;
	const rule =
		sz === null
			? "5 significant figures (size decimals unknown for this market)"
			: `≤ 5 significant figures (integers always allowed) and ≤ ${maxPriceDecimals(venue, sz)} decimals (${venue === "spot" || venue === "outcome" ? 8 : 6} − szDecimals ${sz})`;
	const parsed = Decimal.tryParse(input.trim());
	if (!input.trim()) {
		return {
			input,
			parsed: null,
			wire: null,
			valid: false,
			issues: [issue("px.empty", "error", "Enter a price.", { path })],
			options: [],
			rule,
		};
	}
	if (!parsed) {
		return {
			input,
			parsed: null,
			wire: null,
			valid: false,
			issues: [
				issue("px.nan", "error", `"${input}" is not a number.`, { path }),
			],
			options: [],
			rule,
		};
	}
	if (sz === null) {
		const sf = parsed.significantFigures();
		const valid =
			parsed.isPositive() &&
			(parsed.isInteger() || sf <= 5) &&
			parsed.decimalPlaces() <= 8;
		return {
			input,
			parsed,
			wire: parsed.toString(),
			valid,
			issues: valid
				? [
						issue(
							"px.sz_unknown",
							"warning",
							"Size decimals for this market are not published; only the significant-figure rule is checked.",
							{ path },
						),
					]
				: [
						issue(
							"px.invalid",
							"error",
							`${parsed.toString()} breaks the 5-significant-figure rule.`,
							{ path },
						),
					],
			options: valid
				? []
				: [
						opt(parsed, parsed.roundToSignificantFigures(5, "down"), "down"),
						opt(parsed, parsed.roundToSignificantFigures(5, "up"), "up"),
					],
			rule,
		};
	}
	const check = checkPrice(parsed, venue, sz, path);
	const options: RoundingOption[] = [];
	if (!check.valid && parsed.isPositive()) {
		const down = roundPrice(parsed, venue, sz, "down").value;
		const up = roundPrice(parsed, venue, sz, "up").value;
		if (!down.isZero()) options.push(opt(parsed, down, "down"));
		if (!up.eq(down)) options.push(opt(parsed, up, "up"));
	}
	return {
		input,
		parsed,
		wire: parsed.toString(),
		valid: check.valid,
		issues: check.issues,
		options,
		rule,
	};
}

export interface SizeLint extends FieldLint {
	/** True if a positive input would round down to zero lots. */
	readonly roundsToZero: boolean;
}

export function lintSize(input: string, asset: Asset, path = "s"): SizeLint {
	const sz = asset.szDecimals;
	const rule =
		sz === null
			? "size decimals unknown"
			: `multiple of ${lotSize(sz).toString()} (szDecimals ${sz})`;
	const parsed = Decimal.tryParse(input.trim());
	if (!input.trim()) {
		return {
			input,
			parsed: null,
			wire: null,
			valid: false,
			issues: [issue("sz.empty", "error", "Enter a size.", { path })],
			options: [],
			rule,
			roundsToZero: false,
		};
	}
	if (!parsed) {
		return {
			input,
			parsed: null,
			wire: null,
			valid: false,
			issues: [
				issue("sz.nan", "error", `"${input}" is not a number.`, { path }),
			],
			options: [],
			rule,
			roundsToZero: false,
		};
	}
	if (sz === null) {
		return {
			input,
			parsed,
			wire: parsed.toString(),
			valid: parsed.isPositive(),
			issues: [
				issue(
					"sz.decimals_unknown",
					"warning",
					"This market doesn't publish szDecimals; the lot size can't be checked.",
					{ path },
				),
			],
			options: [],
			rule,
			roundsToZero: false,
		};
	}
	const check = checkSize(parsed, sz, path);
	const issues: Issue[] = [...check.issues];
	if (parsed.isZero())
		issues.push(issue("sz.zero", "error", "Size must be positive.", { path }));
	const down = parsed.roundToDecimals(sz, "down");
	const up = parsed.roundToDecimals(sz, "up");
	const roundsToZero = parsed.isPositive() && down.isZero() && !check.valid;
	if (roundsToZero) {
		issues.unshift(
			issue(
				"sz.rounds_to_zero",
				"error",
				`${parsed.toString()} is smaller than one lot (${lotSize(sz).toString()}). Rounded to ${sz} decimals it becomes 0 — an order that trades nothing.`,
				{ path, fix: `The smallest valid size is ${lotSize(sz).toString()}.` },
			),
		);
	}
	const options: RoundingOption[] = [];
	if (!check.valid && parsed.isPositive()) {
		if (!down.isZero()) options.push(opt(parsed, down, "down"));
		options.push(opt(parsed, up, "up"));
	}
	return {
		input,
		parsed,
		wire: parsed.toString(),
		valid: check.valid && parsed.isPositive(),
		issues,
		options,
		rule,
		roundsToZero,
	};
}

export interface NotionalCheck {
	readonly notional: Decimal;
	readonly minimum: Decimal;
	readonly ok: boolean;
	readonly issue: Issue | null;
}

export function checkNotional(
	px: Decimal,
	sz: Decimal,
	asset: Asset,
	reduceOnly: boolean,
): NotionalCheck {
	const notional = px.mul(sz);
	const minimum = Decimal.parse(MIN_ORDER_NOTIONAL);
	const ok = notional.gte(minimum) || reduceOnly;
	return {
		notional,
		minimum,
		ok,
		issue: ok
			? null
			: issue(
					"notional.min",
					"error",
					`Notional ${notional.toString()} ${asset.quote} is below the ${MIN_ORDER_NOTIONAL} ${asset.quote} minimum; the order will be rejected ("Order must have minimum value of ${asset.venue.kind === "spot" ? `10 ${asset.quote}` : "$10"}.").`,
					{
						path: "s",
						fix: `Increase size to at least ${minimum.div(px, asset.szDecimals ?? 0, "ceil").toString()}.`,
					},
				),
	};
}
