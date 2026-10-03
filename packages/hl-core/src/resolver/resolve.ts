/**
 * Resolve free-text queries ("HYPE", "@107", "BTC", "xyz:TSLA", "#12090",
 * "110000", a token ID or EVM address) to every matching identity. The
 * resolver never picks for the caller: ambiguous queries return all matches,
 * ranked, with the reason each one matched.
 */

import type { Asset, TokenRef } from "../identity.ts";
import type { Network } from "../network.ts";
import { decodeAssetId } from "../rules/assetIds.ts";
import type { AssetUniverse } from "./metadata.ts";

export type MatchReason =
	| "coin"
	| "action-asset-id"
	| "spot-pair-index"
	| "token-index"
	| "outcome-encoding"
	| "outcome-token"
	| "outcome-id"
	| "perp-name"
	| "hip3-base"
	| "spot-base"
	| "spot-pair-name"
	| "token-name"
	| "token-full-name"
	| "token-id"
	| "evm-contract"
	| "outcome-name"
	| "name-contains";

export const MATCH_REASON_LABEL: Readonly<Record<MatchReason, string>> = {
	coin: "exact coin name",
	"action-asset-id": "action asset ID",
	"spot-pair-index": "spot pair index",
	"token-index": "token index",
	"outcome-encoding": "outcome encoding (#)",
	"outcome-token": "outcome token (+)",
	"outcome-id": "outcome ID",
	"perp-name": "perp name",
	"hip3-base": "HIP-3 market base",
	"spot-base": "spot base token",
	"spot-pair-name": "spot pair symbol",
	"token-name": "token name",
	"token-full-name": "token full name",
	"token-id": "token ID",
	"evm-contract": "linked EVM contract",
	"outcome-name": "outcome name",
	"name-contains": "name contains the query",
};

export type ResolvedMatch<N extends Network = Network> =
	| {
			readonly kind: "asset";
			readonly asset: Asset<N>;
			readonly reason: MatchReason;
			readonly score: number;
	  }
	| {
			readonly kind: "token";
			readonly token: TokenRef<N>;
			readonly reason: MatchReason;
			readonly score: number;
	  };

export interface Resolution<N extends Network = Network> {
	readonly network: N;
	readonly query: string;
	readonly normalizedQuery: string;
	readonly matches: readonly ResolvedMatch<N>[];
	/** Number of matches dropped by `limit`. */
	readonly truncated: number;
	readonly ambiguous: boolean;
	/** Notes about how the query was interpreted. */
	readonly notes: readonly string[];
	readonly observedAt: number;
}

export interface ResolveOptions {
	readonly limit?: number;
	/** Include delisted perps (default true, ranked lower). */
	readonly includeDelisted?: boolean;
}

function key(m: ResolvedMatch): string {
	return m.kind === "asset" ? `a:${m.asset.coin}` : `t:${m.token.index}`;
}

export function resolveAsset<N extends Network>(
	universe: AssetUniverse<N>,
	query: string,
	options: ResolveOptions = {},
): Resolution<N> {
	const limit = options.limit ?? 50;
	const includeDelisted = options.includeDelisted ?? true;
	const notes: string[] = [];
	const raw = query.trim();
	let q = raw;
	const out = new Map<string, ResolvedMatch<N>>();
	const addAsset = (
		asset: Asset<N> | undefined,
		reason: MatchReason,
		score: number,
	) => {
		if (!asset) return;
		if (asset.isDelisted && !includeDelisted) return;
		const m: ResolvedMatch<N> = {
			kind: "asset",
			asset,
			reason,
			score: asset.isDelisted ? score - 30 : score,
		};
		const k = key(m);
		const prev = out.get(k);
		if (!prev || prev.score < m.score) out.set(k, m);
	};
	const addToken = (
		token: TokenRef<N> | undefined,
		reason: MatchReason,
		score: number,
	) => {
		if (!token) return;
		const m: ResolvedMatch<N> = { kind: "token", token, reason, score };
		const k = key(m);
		const prev = out.get(k);
		if (!prev || prev.score < m.score) out.set(k, m);
	};

	if (q.length === 0) {
		return {
			network: universe.network,
			query,
			normalizedQuery: "",
			matches: [],
			truncated: 0,
			ambiguous: false,
			notes: ["Empty query."],
			observedAt: universe.observedAt,
		};
	}

	// Strip a trailing -PERP / -USD(C) / -SPOT suffix that UIs commonly add.
	const suffix = /^(.+?)[-_ ](PERP|USD|USDC|SPOT)$/i.exec(q);
	if (suffix?.[1] && !q.includes("/")) {
		notes.push(
			`Interpreted "${q}" as "${suffix[1]}" (${suffix[2]?.toUpperCase()} suffix removed).`,
		);
		q = suffix[1];
	}
	const upper = q.toUpperCase();

	// Exact coin (case-sensitive first, then insensitive).
	addAsset(universe.byCoin.get(q), "coin", 100);

	const spotRef = /^@(\d+)$/.exec(q);
	const outcomeCoin = /^#(\d+)$/.exec(q);
	const outcomeToken = /^\+(\d+)$/.exec(q);
	const badPrefix = /^([@#+])(?!\d+$)/.exec(q);
	if (badPrefix) {
		const what =
			badPrefix[1] === "@"
				? 'a spot pair index, e.g. "@107"'
				: badPrefix[1] === "#"
					? 'an outcome encoding, e.g. "#12090"'
					: 'an outcome token encoding, e.g. "+12090"';
		notes.push(`"${badPrefix[1]}" must be followed only by digits: ${what}.`);
	} else if (spotRef) {
		const idx = Number(spotRef[1]);
		addAsset(universe.spotByIndex.get(idx), "spot-pair-index", 100);
		if (!universe.spotByIndex.has(idx))
			notes.push(`No spot pair with index ${idx} on ${universe.network}.`);
	} else if (outcomeCoin) {
		const enc = Number(outcomeCoin[1]);
		addAsset(universe.byCoin.get(`#${enc}`), "outcome-encoding", 100);
		if (enc % 10 > 1)
			notes.push(`#${enc} has side ${enc % 10}; only sides 0 and 1 exist.`);
		else if (!universe.byCoin.has(`#${enc}`))
			notes.push(`No outcome with encoding ${enc} on ${universe.network}.`);
	} else if (outcomeToken) {
		addAsset(universe.byCoin.get(`#${outcomeToken[1]}`), "outcome-token", 95);
	} else if (/^\d+$/.test(q)) {
		const n = Number(q);
		const decoded = decodeAssetId(n);
		addAsset(universe.byActionId.get(n), "action-asset-id", 90);
		if (decoded.kind === "spot")
			notes.push(`${n} = 10000 + spot index ${decoded.spotPairIndex}.`);
		if (decoded.kind === "hip3")
			notes.push(
				`${n} = 100000 + dex ${decoded.perpDexIndex} × 10000 + index ${decoded.index}.`,
			);
		if (decoded.kind === "outcome")
			notes.push(
				`${n} = 100000000 + encoding ${decoded.encoding} (outcome ${decoded.outcome}, side ${decoded.side}).`,
			);
		addAsset(universe.spotByIndex.get(n), "spot-pair-index", 70);
		addToken(universe.tokensByIndex.get(n), "token-index", 70);
		for (const a of universe.assets) {
			if (a.outcome && a.outcome.outcomeId === n) addAsset(a, "outcome-id", 65);
		}
		if (out.size > 1) {
			notes.push(
				`A bare number is ambiguous: it can be an action asset ID, a spot pair index, a token index or an outcome ID.`,
			);
		}
	} else if (/^0x[0-9a-fA-F]{32}$/.test(q)) {
		const lower = q.toLowerCase();
		for (const t of universe.tokens)
			if (t.tokenId.toLowerCase() === lower) addToken(t, "token-id", 100);
		for (const a of universe.assets) {
			if (a.baseToken?.tokenId.toLowerCase() === lower)
				addAsset(a, "token-id", 80);
		}
	} else if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
		const lower = q.toLowerCase();
		for (const t of universe.tokens) {
			if (t.evmContract?.address.toLowerCase() === lower)
				addToken(t, "evm-contract", 100);
		}
		for (const a of universe.assets) {
			if (a.baseToken?.evmContract?.address.toLowerCase() === lower)
				addAsset(a, "evm-contract", 80);
		}
	} else if (q.includes("/")) {
		const [b = "", qt = ""] = q.split("/").map((s) => s.trim().toUpperCase());
		for (const a of universe.assets) {
			if (a.venue.kind !== "spot") continue;
			if (a.coin.toUpperCase() === `${b}/${qt}`) addAsset(a, "coin", 100);
			else if (a.base.toUpperCase() === b && a.quote.toUpperCase() === qt) {
				addAsset(a, "spot-pair-name", a.isCanonical ? 92 : 88);
			}
		}
	} else {
		const hip3 = /^([^:]+):(.+)$/.exec(q);
		for (const a of universe.assets) {
			const coinUpper = a.coin.toUpperCase();
			if (coinUpper === upper && a.coin !== q) addAsset(a, "coin", 98);
			if (hip3) continue;
			if (a.venue.kind === "perp" && coinUpper === upper)
				addAsset(a, "perp-name", 97);
			if (a.venue.kind === "hip3" && a.base.toUpperCase() === upper)
				addAsset(a, "hip3-base", 80);
			if (a.venue.kind === "spot" && a.base.toUpperCase() === upper) {
				const quoteBonus = a.quote === "USDC" ? 6 : 0;
				addAsset(a, "spot-base", 82 + quoteBonus + (a.isCanonical ? 2 : 0));
			}
			if (a.outcome && a.outcome.name.toUpperCase() === upper)
				addAsset(a, "outcome-name", 60);
		}
		if (!hip3) {
			for (const t of universe.tokens) {
				if (t.name.toUpperCase() === upper) addToken(t, "token-name", 85);
				else if (t.fullName && t.fullName.toUpperCase() === upper)
					addToken(t, "token-full-name", 75);
			}
			// Wrapped and bridged assets carry a prefix (UBTC, UETH, USDT0): a
			// plain "BTC" should still surface them, ranked below exact matches.
			if (upper.length >= 3 && /^[A-Z0-9]+$/.test(upper)) {
				for (const a of universe.assets) {
					if (a.venue.kind !== "spot" && a.venue.kind !== "perp") continue;
					const base = a.base.toUpperCase();
					if (base !== upper && base.includes(upper))
						addAsset(a, "name-contains", a.venue.kind === "spot" ? 40 : 42);
				}
				for (const t of universe.tokens) {
					const name = t.name.toUpperCase();
					if (name !== upper && name.includes(upper))
						addToken(t, "name-contains", 38);
				}
			}
		} else if (!out.size) {
			const dex = hip3[1] ?? "";
			const known = universe.dexes.some(
				(d) => d.name.toLowerCase() === dex.toLowerCase(),
			);
			notes.push(
				known
					? `Dex "${dex}" exists on ${universe.network} but has no market "${hip3[2]}".`
					: `No perp dex named "${dex}" on ${universe.network}.`,
			);
		}
	}

	const all = [...out.values()].sort(
		(a, b) => b.score - a.score || label(a).localeCompare(label(b)),
	);
	const matches = all.slice(0, limit);
	// Never auto-select: more than one identity means the caller must choose.
	const ambiguous = all.length > 1;
	return {
		network: universe.network,
		query,
		normalizedQuery: q,
		matches,
		truncated: all.length - matches.length,
		ambiguous,
		notes,
		observedAt: universe.observedAt,
	};
}

function label(m: ResolvedMatch): string {
	return m.kind === "asset" ? m.asset.coin : m.token.name;
}

export interface CrossNetworkRow {
	readonly label: string;
	readonly mainnet: ResolvedMatch<"mainnet"> | null;
	readonly testnet: ResolvedMatch<"testnet"> | null;
	/** Fields whose values differ between networks. */
	readonly differences: readonly string[];
}

function identityKey(m: ResolvedMatch): string {
	if (m.kind === "token") return `token:${m.token.name}`;
	const a = m.asset;
	switch (a.venue.kind) {
		case "perp":
			return `perp:${a.coin}`;
		case "hip3":
			return `hip3:${a.coin.toLowerCase()}`;
		case "spot":
			return `spot:${a.base}/${a.quote}`;
		case "outcome":
			return `outcome:${a.displaySymbol}`;
	}
}

function fieldsOf(m: ResolvedMatch): Record<string, string> {
	if (m.kind === "token") {
		return {
			"token index": String(m.token.index),
			szDecimals: String(m.token.szDecimals),
			weiDecimals: String(m.token.weiDecimals),
			tokenId: m.token.tokenId,
			"EVM contract": m.token.evmContract?.address ?? "—",
		};
	}
	const a = m.asset;
	return {
		coin: a.coin,
		"action asset ID": String(a.actionAssetId),
		szDecimals: a.szDecimals === null ? "unknown" : String(a.szDecimals),
		"max px decimals": a.pxDecimals === null ? "unknown" : String(a.pxDecimals),
		...(a.spotPairIndex !== undefined
			? { "spot pair index": String(a.spotPairIndex) }
			: {}),
		...(a.baseToken ? { "base token index": String(a.baseToken.index) } : {}),
		...(a.maxLeverage !== undefined
			? { "max leverage": String(a.maxLeverage) }
			: {}),
	};
}

/**
 * Pair matches for the same identity across networks (by symbol, never by
 * ID — IDs are exactly what differs) and list the fields that differ.
 */
export function compareAcrossNetworks(
	mainnet: Resolution<"mainnet">,
	testnet: Resolution<"testnet">,
): CrossNetworkRow[] {
	const rows = new Map<
		string,
		{
			label: string;
			mainnet: ResolvedMatch<"mainnet"> | null;
			testnet: ResolvedMatch<"testnet"> | null;
		}
	>();
	for (const m of mainnet.matches) {
		const k = identityKey(m);
		if (!rows.has(k))
			rows.set(k, {
				label: m.kind === "asset" ? m.asset.displaySymbol : m.token.name,
				mainnet: m,
				testnet: null,
			});
	}
	for (const m of testnet.matches) {
		const k = identityKey(m);
		const row = rows.get(k);
		if (row) {
			if (!row.testnet) row.testnet = m;
		} else
			rows.set(k, {
				label: m.kind === "asset" ? m.asset.displaySymbol : m.token.name,
				mainnet: null,
				testnet: m,
			});
	}
	return [...rows.values()].map((r) => {
		const differences: string[] = [];
		if (r.mainnet && r.testnet) {
			const a = fieldsOf(r.mainnet);
			const b = fieldsOf(r.testnet);
			for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
				if (a[f] !== b[f]) differences.push(f);
			}
		}
		return { ...r, differences };
	});
}
