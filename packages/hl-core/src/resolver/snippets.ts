import { Decimal } from "../decimal.ts";
import type { Asset } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { networkConfig } from "../network.ts";
import { MIN_ORDER_NOTIONAL } from "../rules/orders.ts";
import { roundPrice } from "../rules/precision.ts";

export interface AssetSnippets {
	readonly restInfo: {
		readonly body: Record<string, unknown>;
		readonly curl: string;
	};
	readonly wsSubscribe: Record<string, unknown>;
	readonly order: {
		readonly action: Record<string, unknown> | null;
		readonly explanation: string;
		readonly issues: readonly Issue[];
	};
}

function venueKind(a: Asset) {
	return a.venue.kind;
}

/**
 * Build copyable snippets for an asset. `mid` (a decimal string from allMids)
 * is used to price the example order; without it, no order is produced.
 */
export function assetSnippets(asset: Asset, mid: string | null): AssetSnippets {
	const cfg = networkConfig(asset.network);
	const body = { type: "l2Book", coin: asset.coin };
	const curl = `curl -s -X POST ${cfg.apiUrl}/info \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(body)}'`;
	const wsSubscribe = {
		method: "subscribe",
		subscription: { type: "l2Book", coin: asset.coin },
	};
	const issues: Issue[] = [];
	let action: Record<string, unknown> | null = null;
	let explanation = "";
	const midDec = mid ? Decimal.tryParse(mid) : null;
	if (!midDec || !midDec.isPositive()) {
		issues.push(
			issue(
				"snippet.no_mid",
				"info",
				`No mid price for ${asset.coin} on ${asset.network}, so no example order is priced.`,
			),
		);
	} else {
		// A post-only buy 2% below mid: valid wire format, will not cross.
		const venue = venueKind(asset);
		const szDecimals = asset.szDecimals;
		const target = midDec.mul(Decimal.parse("0.98"));
		const px =
			szDecimals === null
				? target.roundToSignificantFigures(5, "down").roundToDecimals(8, "down")
				: roundPrice(target, venue, szDecimals, "down").value;
		if (px.isZero()) {
			issues.push(
				issue(
					"snippet.px_zero",
					"warning",
					"Mid is too small to price an example order.",
				),
			);
		} else {
			const effectiveSz = szDecimals ?? 0;
			if (szDecimals === null) {
				issues.push(
					issue(
						"snippet.sz_unknown",
						"warning",
						"outcomeMeta does not publish szDecimals for outcome tokens; the example size is a whole number. Check the book's size increments before relying on it.",
					),
				);
			}
			const sz = Decimal.parse(MIN_ORDER_NOTIONAL).div(px, effectiveSz, "ceil");
			action = {
				type: "order",
				orders: [
					{
						a: asset.actionAssetId,
						b: true,
						p: px.toString(),
						s: sz.toString(),
						r: false,
						t: { limit: { tif: "Alo" } },
					},
				],
				grouping: "na",
			};
			explanation = `Post-only buy ${sz.toString()} ${asset.base} at ${px.toString()} (mid ${midDec.toString()} − 2%, rounded down to a valid tick). Size is the smallest lot that reaches the ${MIN_ORDER_NOTIONAL} ${asset.quote} minimum notional (${px.mul(sz).toString()}).`;
		}
	}
	return {
		restInfo: { body, curl },
		wsSubscribe,
		order: { action, explanation, issues },
	};
}
