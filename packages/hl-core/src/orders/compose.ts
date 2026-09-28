/**
 * Compose exchange order actions from intent. Every price and size goes
 * through the linter; invalid values produce blocking errors with explicit
 * rounding options instead of being rounded behind the user's back. Prices
 * the composer *derives* (market prices from mid ± slippage) are rounded in
 * the conservative direction and reported as such.
 */

import { Decimal } from "../decimal.ts";
import type { Asset } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { CLOID_RE } from "../rules/orders.ts";
import { roundPrice } from "../rules/precision.ts";
import {
	checkNotional,
	type FieldLint,
	lintPrice,
	lintSize,
	type NotionalCheck,
	type SizeLint,
} from "./lint.ts";

export type Intent =
	| "long-tpsl"
	| "short-tpsl"
	| "reduce-only-close"
	| "post-only"
	| "ioc"
	| "market";

export const INTENTS: readonly {
	id: Intent;
	label: string;
	description: string;
}[] = [
	{
		id: "long-tpsl",
		label: "Open long with TP/SL",
		description:
			"Buy entry plus reduce-only take-profit and stop-loss children (grouping normalTpsl).",
	},
	{
		id: "short-tpsl",
		label: "Open short with TP/SL",
		description:
			"Sell entry plus reduce-only take-profit and stop-loss children (grouping normalTpsl).",
	},
	{
		id: "reduce-only-close",
		label: "Reduce-only close",
		description:
			"Close (part of) a position with an aggressive reduce-only IOC — how frontends implement market close.",
	},
	{
		id: "post-only",
		label: "Post-only limit",
		description:
			"Add-liquidity-only (Alo) limit order: rests on the book or is rejected, never takes.",
	},
	{
		id: "ioc",
		label: "IOC limit",
		description:
			"Immediate-or-cancel at your limit price: fills what it can now, cancels the rest.",
	},
	{
		id: "market",
		label: "Market (IOC with slippage)",
		description:
			"IOC priced at mid ± slippage — there is no native market order type.",
	},
];

export interface ComposeInput {
	readonly asset: Asset;
	readonly intent: Intent;
	/** Order side for post-only / ioc / market / reduce-only close (sell closes a long); ignored for the TP/SL intents. */
	readonly side: "buy" | "sell";
	readonly size: string;
	/** Limit price (entry for TP/SL intents when entryType is limit). */
	readonly price: string;
	readonly entryType: "limit" | "market";
	/** Current mid (decimal string) — required for market pricing. */
	readonly mid: string | null;
	/** Slippage as a fraction, e.g. "0.05". */
	readonly slippage: string;
	readonly tp: string;
	readonly sl: string;
	readonly tpslMarket: boolean;
	readonly cloid: string;
	readonly builderAddress: string;
	readonly builderFee: string;
}

export type OrderRole =
	| "entry"
	| "take-profit"
	| "stop-loss"
	| "close"
	| "order";

export interface OrderPlan {
	readonly role: OrderRole;
	readonly isBuy: boolean;
	readonly reduceOnly: boolean;
	readonly kind:
		| { limit: { tif: "Gtc" | "Ioc" | "Alo" } }
		| { trigger: { isMarket: boolean; triggerPx: string; tpsl: "tp" | "sl" } };
	readonly price: FieldLint;
	readonly size: SizeLint;
	readonly trigger?: FieldLint;
	/** How the price was obtained when the composer derived it. */
	readonly derived?: string;
}

export interface SequenceStep {
	readonly from: string;
	readonly to: string;
	readonly label: string;
	readonly note?: string;
}

export interface ComposeResult {
	readonly action: Record<string, unknown> | null;
	readonly orders: readonly OrderPlan[];
	readonly issues: readonly Issue[];
	readonly notional: NotionalCheck | null;
	readonly participants: readonly string[];
	readonly sequence: readonly SequenceStep[];
}

function derivedMarketPrice(
	asset: Asset,
	mid: Decimal,
	slippage: Decimal,
	isBuy: boolean,
): { lint: FieldLint; derived: string } {
	const raw = isBuy
		? mid.mul(Decimal.ONE.add(slippage))
		: mid.mul(Decimal.ONE.sub(slippage));
	// Round toward the mid so the price never exceeds the slippage bound.
	const mode = isBuy ? "down" : "up";
	const value =
		asset.szDecimals === null
			? raw.roundToSignificantFigures(5, mode).roundToDecimals(8, mode)
			: roundPrice(raw, asset.venue.kind, asset.szDecimals, mode).value;
	return {
		lint: lintPrice(value.toString(), asset),
		derived: `mid ${mid.toString()} ${isBuy ? "+" : "−"} ${slippage.mul(Decimal.parse("100")).toString()}% = ${raw.toString()}, rounded ${mode} to a valid tick → ${value.toString()}`,
	};
}

function wireOf(
	plan: OrderPlan,
	assetId: number,
	cloid?: string,
): Record<string, unknown> {
	const o: Record<string, unknown> = {
		a: assetId,
		b: plan.isBuy,
		p: plan.price.wire,
		s: plan.size.wire,
		r: plan.reduceOnly,
		t:
			"limit" in plan.kind
				? { limit: { tif: plan.kind.limit.tif } }
				: {
						trigger: {
							isMarket: plan.kind.trigger.isMarket,
							triggerPx: plan.kind.trigger.triggerPx,
							tpsl: plan.kind.trigger.tpsl,
						},
					},
	};
	if (cloid) o.c = cloid.toLowerCase();
	return o;
}

export function composeOrder(input: ComposeInput): ComposeResult {
	const { asset, intent } = input;
	const issues: Issue[] = [];
	const orders: OrderPlan[] = [];
	const mid = input.mid ? Decimal.tryParse(input.mid) : null;
	const slippage = Decimal.tryParse(input.slippage) ?? Decimal.parse("0.05");
	if (slippage.isNegative() || slippage.gte(Decimal.ONE)) {
		issues.push(
			issue(
				"slippage.range",
				"error",
				"Slippage must be between 0 and 1 (e.g. 0.05 for 5%).",
				{ path: "slippage" },
			),
		);
	}
	const size = lintSize(input.size, asset);
	const tpsl = intent === "long-tpsl" || intent === "short-tpsl";
	const entryIsBuy =
		intent === "long-tpsl"
			? true
			: intent === "short-tpsl"
				? false
				: input.side === "buy";

	// Entry / main order price.
	let price: FieldLint;
	let derived: string | undefined;
	const needsMarket =
		intent === "market" ||
		intent === "reduce-only-close" ||
		(tpsl && input.entryType === "market");
	if (needsMarket) {
		if (!mid) {
			price = {
				input: "",
				parsed: null,
				wire: null,
				valid: false,
				issues: [
					issue(
						"px.no_mid",
						"error",
						`No mid price for ${asset.coin}; a market-style order needs one to derive its limit price.`,
					),
				],
				options: [],
				rule: "mid ± slippage",
			};
		} else {
			const d = derivedMarketPrice(asset, mid, slippage, entryIsBuy);
			price = d.lint;
			derived = d.derived;
		}
	} else {
		price = lintPrice(input.price, asset);
	}
	const tif: "Gtc" | "Ioc" | "Alo" =
		intent === "post-only"
			? "Alo"
			: needsMarket || intent === "ioc"
				? "Ioc"
				: "Gtc";
	const role: OrderRole = tpsl
		? "entry"
		: intent === "reduce-only-close"
			? "close"
			: "order";
	orders.push({
		role,
		isBuy: entryIsBuy,
		reduceOnly: intent === "reduce-only-close",
		kind: { limit: { tif } },
		price,
		size,
		derived,
	});

	// Heuristics against the mid (warnings only — the book decides).
	if (mid && price.parsed && !needsMarket) {
		if (
			intent === "post-only" &&
			((entryIsBuy && price.parsed.gte(mid)) ||
				(!entryIsBuy && price.parsed.lte(mid)))
		) {
			issues.push(
				issue(
					"alo.crosses",
					"warning",
					`A post-only ${entryIsBuy ? "buy" : "sell"} at ${price.parsed.toString()} is at or through the mid ${mid.toString()}: it will likely be rejected ("Post only order would have immediately matched").`,
					{ path: "orders[0].p" },
				),
			);
		}
		if (
			intent === "ioc" &&
			((entryIsBuy && price.parsed.lt(mid)) ||
				(!entryIsBuy && price.parsed.gt(mid)))
		) {
			issues.push(
				issue(
					"ioc.no_cross",
					"warning",
					`An IOC ${entryIsBuy ? "buy" : "sell"} at ${price.parsed.toString()} doesn't reach the mid ${mid.toString()}: it will likely cancel unfilled ("Order could not immediately match…").`,
					{ path: "orders[0].p" },
				),
			);
		}
		const far = price.parsed.sub(mid).abs().div(mid, 4, "half-up");
		if (far.gt(Decimal.parse("0.8"))) {
			issues.push(
				issue(
					"px.far",
					"warning",
					`Price is ${far.mul(Decimal.parse("100")).toString()}% from mid; orders far from the reference price are rejected in pre-validation.`,
					{ path: "orders[0].p" },
				),
			);
		}
	}

	// TP/SL children: reduce-only, opposite side, same size.
	if (tpsl) {
		const childBuy = !entryIsBuy;
		const entryRef = price.parsed ?? mid;
		for (const [kind, text] of [
			["tp", input.tp],
			["sl", input.sl],
		] as const) {
			if (!text.trim()) continue;
			const trig = lintPrice(
				text,
				asset,
				`orders[${orders.length}].t.trigger.triggerPx`,
			);
			if (trig.parsed && entryRef) {
				const wrongSide = entryIsBuy
					? kind === "tp"
						? trig.parsed.lte(entryRef)
						: trig.parsed.gte(entryRef)
					: kind === "tp"
						? trig.parsed.gte(entryRef)
						: trig.parsed.lte(entryRef);
				if (wrongSide) {
					issues.push(
						issue(
							"tpsl.side",
							"warning",
							`${kind === "tp" ? "Take-profit" : "Stop-loss"} trigger ${trig.parsed.toString()} is on the wrong side of the entry ${entryRef.toString()} for a ${entryIsBuy ? "long" : "short"}: it would trigger immediately or be rejected ("Invalid TP/SL price.").`,
							{ path: `orders[${orders.length}].t.trigger.triggerPx` },
						),
					);
				}
			}
			orders.push({
				role: kind === "tp" ? "take-profit" : "stop-loss",
				isBuy: childBuy,
				reduceOnly: true,
				kind: {
					trigger: {
						isMarket: input.tpslMarket,
						triggerPx: trig.wire ?? "",
						tpsl: kind,
					},
				},
				// Market triggers use the trigger price as the limit (10% slippage is applied on trigger).
				price: trig,
				size,
				trigger: trig,
				derived: input.tpslMarket
					? "limit = trigger price; on trigger it executes as a market order with 10% slippage tolerance"
					: undefined,
			});
		}
		if (orders.length === 1) {
			issues.push(
				issue(
					"tpsl.none",
					"info",
					"No TP or SL price entered; the action will contain only the entry.",
					{ path: "tp" },
				),
			);
		}
	}

	// Cloid and builder.
	const cloid = input.cloid.trim();
	if (cloid && !CLOID_RE.test(cloid))
		issues.push(
			issue(
				"cloid.invalid",
				"error",
				"A cloid is 0x followed by 32 hex digits (16 bytes).",
				{ path: "cloid" },
			),
		);
	let builder: { b: string; f: number } | undefined;
	const bAddr = input.builderAddress.trim();
	if (bAddr) {
		if (!/^0x[0-9a-fA-F]{40}$/.test(bAddr))
			issues.push(
				issue(
					"builder.address",
					"error",
					"Builder must be a 20-byte address.",
					{ path: "builder.b" },
				),
			);
		const f = Number(input.builderFee);
		const max = asset.venue.kind === "spot" ? 1000 : 100;
		if (!Number.isInteger(f) || f < 0)
			issues.push(
				issue(
					"builder.fee",
					"error",
					"Builder fee is an integer number of tenths of a basis point (10 = 1 bp).",
					{ path: "builder.f" },
				),
			);
		else if (f > max)
			issues.push(
				issue(
					"builder.fee_max",
					"error",
					`Builder fees are capped at ${max / 10} bps (${max / 1000}%) on ${asset.venue.kind === "spot" ? "spot" : "perps"}.`,
					{ path: "builder.f" },
				),
			);
		builder = { b: bAddr.toLowerCase(), f };
	}

	for (const o of orders)
		issues.push(
			...o.price.issues,
			...o.size.issues.filter(
				(i) => o === orders[0] || i.code !== "sz.rounds_to_zero",
			),
		);
	const notional =
		price.parsed && size.parsed && size.valid
			? checkNotional(
					price.parsed,
					size.parsed,
					asset,
					intent === "reduce-only-close",
				)
			: null;
	if (notional?.issue) issues.push(notional.issue);

	const blocking =
		issues.some((i) => i.severity === "error") ||
		orders.some((o) => !o.price.valid || !o.size.valid);
	const action = blocking
		? null
		: {
				type: "order",
				orders: orders.map((o, i) =>
					wireOf(
						o,
						asset.actionAssetId,
						i === 0 ? cloid || undefined : undefined,
					),
				),
				grouping: tpsl && orders.length > 1 ? "normalTpsl" : "na",
				...(builder ? { builder } : {}),
			};

	const participants = tpsl
		? ["You", "Exchange API", "Order book", "Trigger engine"]
		: ["You", "Exchange API", "Order book"];
	const sequence = sequenceFor(intent, tif, orders, input.entryType);
	return {
		action,
		orders,
		issues: dedupe(issues),
		notional,
		participants,
		sequence,
	};
}

function dedupe(issues: Issue[]): Issue[] {
	const seen = new Set<string>();
	return issues.filter((i) => {
		const k = `${i.code}|${i.path ?? ""}|${i.message}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

function sequenceFor(
	intent: Intent,
	tif: string,
	orders: OrderPlan[],
	entryType: string,
): SequenceStep[] {
	const s: SequenceStep[] = [
		{
			from: "You",
			to: "Exchange API",
			label: `POST /exchange {type:"order", ${orders.length} order${orders.length > 1 ? "s" : ""}}`,
			note: "Signed L1 action; nonce + signature",
		},
		{
			from: "Exchange API",
			to: "Exchange API",
			label: "Pre-validation",
			note: "Signature, tick/lot size, reduce-only TP/SL, price band. Failures return one error for the whole batch.",
		},
	];
	const entry = orders[0];
	const dir = entry?.isBuy ? "buy" : "sell";
	if (tif === "Alo") {
		s.push({
			from: "Exchange API",
			to: "Order book",
			label: `Alo ${dir} — rests if it doesn't cross`,
			note: "Would cross → rejected (badAloPxRejected)",
		});
		s.push({
			from: "Exchange API",
			to: "You",
			label:
				'statuses: [{"resting":{"oid"}}] or [{"error":"Post only order would have immediately matched…"}]',
		});
	} else if (tif === "Ioc") {
		s.push({
			from: "Exchange API",
			to: "Order book",
			label: `Ioc ${dir}${intent === "reduce-only-close" ? " (reduce-only)" : ""} — match now`,
			note: "Unfilled remainder is canceled, never rests",
		});
		s.push({
			from: "Exchange API",
			to: "You",
			label:
				'statuses: [{"filled":{"totalSz","avgPx","oid"}}] or [{"error":"…could not immediately match…"}]',
		});
	} else {
		s.push({
			from: "Exchange API",
			to: "Order book",
			label: `Gtc ${dir} — match, then rest the remainder`,
		});
		s.push({
			from: "Exchange API",
			to: "You",
			label:
				'statuses: [{"resting":{"oid"}} | {"filled":{…}}' +
				(orders.length > 1 ? ', "waitingForFill", …]' : "]"),
		});
	}
	if (orders.length > 1) {
		s.push({
			from: "Order book",
			to: "Trigger engine",
			label: "Entry fills → TP/SL children activate",
			note: "normalTpsl: children are sized to the entry and only live once it fills",
		});
		s.push({
			from: "Trigger engine",
			to: "Trigger engine",
			label: "Mark price crosses a trigger",
		});
		s.push({
			from: "Trigger engine",
			to: "Order book",
			label: `Triggered child → reduce-only ${entry?.isBuy ? "sell" : "buy"}${orders[1]?.kind && "trigger" in orders[1].kind && orders[1].kind.trigger.isMarket ? " at market (10% slippage)" : " limit"}`,
		});
		s.push({
			from: "Order book",
			to: "Trigger engine",
			label: "Sibling canceled",
			note: "siblingFilledCanceled",
		});
	}
	if (entryType === "market" && orders.length > 1) {
		s.splice(2, 0, {
			from: "Exchange API",
			to: "Exchange API",
			label: "Entry priced at mid ± slippage",
			note: "IOC, so it fills now or not at all",
		});
	}
	return s;
}
