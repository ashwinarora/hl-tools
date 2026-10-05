/**
 * The vocabulary of Hyperliquid identifiers, made explicit.
 *
 * Every tradeable thing has several spellings and each spelling is used in
 * exactly one place: the coin string (info/WS), the action asset ID (the `a`
 * field), the token (balances and transfers), the display symbol (frontend)
 * and, for outcomes, the encoding behind `#`, `+` and the asset ID. This
 * module classifies what a user typed, lists every spelling of a resolved
 * identity with where it is used, finds the other identities of the same
 * underlying asset, and normalises settled (no longer live) outcomes.
 */

import type { Asset, TokenRef } from "../identity.ts";
import type { Network } from "../network.ts";
import {
	decodeAssetId,
	HIP3_ASSET_OFFSET,
	HIP3_DEX_STRIDE,
	OUTCOME_ASSET_OFFSET,
	outcomeAssetId,
	outcomeEncoding,
	SPOT_ASSET_OFFSET,
} from "../rules/assetIds.ts";
import {
	type AssetUniverse,
	cleanTemplateName,
	parseOutcomeDescription,
	type RawOutcome,
} from "./metadata.ts";
import type { ResolvedMatch } from "./resolve.ts";

// ── Where a spelling is used ──

export type UsedIn =
	| "info"
	| "ws"
	| "exchange"
	| "corewriter"
	| "balances"
	| "transfers"
	| "evm"
	| "frontend";

export const USED_IN_LABEL: Readonly<
	Record<UsedIn, { readonly api: string; readonly plain: string }>
> = {
	info: { api: "info", plain: "info requests (l2Book, candleSnapshot…)" },
	ws: { api: "WebSocket", plain: "subscription coin" },
	exchange: { api: "exchange a", plain: "the a field of orders and cancels" },
	corewriter: {
		api: "CoreWriter",
		plain: "asset / token fields of raw actions",
	},
	balances: { api: "spotClearinghouseState", plain: "balance entries" },
	transfers: { api: "spotSend / sendAsset", plain: "token transfers" },
	evm: { api: "HyperEVM", plain: "ERC-20 contract and precompiles" },
	frontend: { api: "app only", plain: "what the app shows; never sent" },
};

// ── Identifier families (the legend) ──

export type IdentifierFamily =
	| "coin"
	| "asset-id"
	| "display"
	| "token"
	| "outcome-encoding";

export interface FamilySpec {
	readonly family: IdentifierFamily;
	readonly title: string;
	readonly summary: string;
	readonly examples: readonly string[];
	readonly usedIn: readonly UsedIn[];
	readonly derivation: string;
}

export const IDENTIFIER_FAMILIES: readonly FamilySpec[] = [
	{
		family: "coin",
		title: "Coin string",
		summary:
			"The name info requests and WebSocket subscriptions take. Each prefix is a different venue.",
		examples: ["BTC", "xyz:TSLA", "@107", "PURR/USDC", "#83061"],
		usedIn: ["info", "ws"],
		derivation:
			"Perp: its name. HIP-3 perp: dex:name. Spot: @<spot pair index>, or BASE/QUOTE for canonical pairs only. Outcome: #<encoding>.",
	},
	{
		family: "asset-id",
		title: "Action asset ID",
		summary:
			"The integer in the a field of order and cancel actions, and the asset field of CoreWriter actions.",
		examples: ["0", "110001", "10107", "100083061"],
		usedIn: ["exchange", "corewriter"],
		derivation:
			"Perp: index in meta.universe. HIP-3: 100000 + dex × 10000 + index. Spot: 10000 + spot pair index. Outcome: 100000000 + encoding.",
	},
	{
		family: "display",
		title: "Display symbol",
		summary:
			"What the app shows. The API never accepts it, which is why UBTC/USDC fails as a coin.",
		examples: ["BTC-PERP", "HYPE/USDC", "UBTC/USDC"],
		usedIn: ["frontend"],
		derivation:
			"Perp name + -PERP; spot base/quote token names; outcome name · side.",
	},
	{
		family: "token",
		title: "Token",
		summary:
			"A balance, not a market. It has a name, an index (a third index space, separate from spot and perp indexes), a 16-byte ID and, when linked, an EVM contract.",
		examples: [
			"HYPE",
			"150",
			"0x0d01dc56dcaaca66ad901c959b4011ec",
			"HYPE:0x0d01…",
			"+83061",
		],
		usedIn: ["balances", "transfers", "corewriter", "evm"],
		derivation:
			"spotMeta.tokens[].index and tokenId. Transfers take name:tokenId. Outcome tokens are +<encoding>.",
	},
	{
		family: "outcome-encoding",
		title: "Outcome encoding",
		summary:
			"HIP-4 outcomes have two sides (Yes = 0, No = 1). One number encodes both and sits inside the coin, the token and the asset ID.",
		examples: ["83061 = outcome 8306, side 1 (No)"],
		usedIn: ["info", "exchange", "balances"],
		derivation:
			"encoding = 10 × outcome + side. Coin #<encoding>, token +<encoding>, asset ID 100000000 + encoding.",
	},
];

// ── What did the user type? ──

export type QueryShape =
	| "empty"
	| "symbol"
	| "symbol-suffix"
	| "hip3-coin"
	| "pair-name"
	| "spot-index"
	| "outcome-coin"
	| "outcome-token"
	| "number"
	| "token-id"
	| "evm-address"
	| "malformed-prefix";

export interface Derived {
	readonly label: string;
	readonly value: string;
}

export interface QueryClass {
	readonly shape: QueryShape;
	readonly family: IdentifierFamily | null;
	/** Short name of the shape, e.g. "spot pair index". */
	readonly title: string;
	/** One or two sentences explaining what that shape means. */
	readonly explanation: string;
	/** Spellings that follow from the input alone (no metadata needed). */
	readonly derived: readonly Derived[];
	/** For outcome shapes: the decoded parts. */
	readonly outcome: {
		readonly outcome: number;
		readonly side: 0 | 1;
		readonly encoding: number;
	} | null;
}

function outcomeParts(encoding: number) {
	const side = encoding % 10;
	if (side > 1) return null;
	return { outcome: Math.floor(encoding / 10), side: side as 0 | 1, encoding };
}

function outcomeDerived(p: {
	outcome: number;
	side: 0 | 1;
	encoding: number;
}): Derived[] {
	return [
		{ label: "outcome", value: String(p.outcome) },
		{ label: "side", value: `${p.side} (${p.side === 0 ? "Yes" : "No"})` },
		{ label: "coin", value: `#${p.encoding}` },
		{ label: "token", value: `+${p.encoding}` },
		{
			label: "asset ID",
			value: String(outcomeAssetId(p.outcome, p.side)),
		},
	];
}

/** Classify a query by its shape alone. Pure; no metadata involved. */
export function classifyQuery(query: string): QueryClass {
	const q = query.trim();
	const none: QueryClass = {
		shape: "empty",
		family: null,
		title: "",
		explanation: "",
		derived: [],
		outcome: null,
	};
	if (!q) return none;

	let m = /^@(\d+)$/.exec(q);
	if (m) {
		const n = Number(m[1]);
		return {
			shape: "spot-index",
			family: "coin",
			title: "spot pair index",
			explanation:
				"@N is the coin string of spot pair N. Non-canonical pairs have no name, so this is their only coin string.",
			derived: [
				{ label: "spot pair index", value: String(n) },
				{ label: "asset ID", value: String(SPOT_ASSET_OFFSET + n) },
			],
			outcome: null,
		};
	}
	m = /^#(\d+)$/.exec(q);
	if (m) {
		const p = outcomeParts(Number(m[1]));
		return {
			shape: "outcome-coin",
			family: "coin",
			title: "outcome coin",
			explanation: p
				? "#<encoding> is the coin string of one side of a HIP-4 outcome; the encoding is 10 × outcome + side."
				: "#<encoding> is an outcome coin, but the last digit is the side and only 0 (Yes) and 1 (No) exist.",
			derived: p ? outcomeDerived(p) : [],
			outcome: p,
		};
	}
	m = /^\+(\d+)$/.exec(q);
	if (m) {
		const p = outcomeParts(Number(m[1]));
		return {
			shape: "outcome-token",
			family: "token",
			title: "outcome token",
			explanation: p
				? "+<encoding> is the token name of one side of a HIP-4 outcome, as it appears in balances; the encoding is 10 × outcome + side."
				: "+<encoding> is an outcome token, but the last digit is the side and only 0 (Yes) and 1 (No) exist.",
			derived: p ? outcomeDerived(p) : [],
			outcome: p,
		};
	}
	if (/^[@#+]/.test(q)) {
		const c = q[0] as "@" | "#" | "+";
		return {
			shape: "malformed-prefix",
			family: c === "+" ? "token" : "coin",
			title: `${c} prefix`,
			explanation: `"${c}" must be followed only by digits: ${
				c === "@"
					? "@<spot pair index>, e.g. @107"
					: c === "#"
						? "#<outcome encoding>, e.g. #83061"
						: "+<outcome encoding>, e.g. +83061"
			}.`,
			derived: [],
			outcome: null,
		};
	}
	if (/^\d+$/.test(q)) {
		const n = Number(q);
		const d = decodeAssetId(n);
		const derived: Derived[] = [];
		let explanation: string;
		let outcome: QueryClass["outcome"] = null;
		if (d.kind === "outcome") {
			outcome = { outcome: d.outcome, side: d.side, encoding: d.encoding };
			derived.push(
				{
					label: "as asset ID",
					value: `100000000 + ${d.encoding} → outcome ${d.outcome}, side ${d.side} (${d.side === 0 ? "Yes" : "No"})`,
				},
				{ label: "coin", value: `#${d.encoding}` },
				{ label: "token", value: `+${d.encoding}` },
			);
			explanation =
				"A number this large can only be an outcome asset ID: 100000000 + encoding, where encoding = 10 × outcome + side.";
		} else if (d.kind === "hip3") {
			derived.push({
				label: "as asset ID",
				value: `${HIP3_ASSET_OFFSET} + dex ${d.perpDexIndex} × ${HIP3_DEX_STRIDE} + index ${d.index} → HIP-3 perp`,
			});
			explanation =
				"A number between 100000 and 99999999 is a HIP-3 perp asset ID: the dex index and the perp's index inside that dex are packed into it.";
		} else if (d.kind === "spot") {
			derived.push(
				{
					label: "as asset ID",
					value: `${SPOT_ASSET_OFFSET} + spot pair index ${d.spotPairIndex} → coin @${d.spotPairIndex}`,
				},
				{ label: "as token index", value: `token ${n}` },
				{ label: "as spot pair index", value: `coin @${n}` },
			);
			explanation =
				"A bare number is ambiguous. Between 10000 and 99999 it is most likely a spot asset ID, but it could also be a token index, a spot pair index or an outcome ID.";
		} else if (d.kind === "perp") {
			derived.push(
				{ label: "as asset ID", value: `perp index ${n} (first dex)` },
				{
					label: "as spot pair index",
					value: `coin @${n}, asset ID ${SPOT_ASSET_OFFSET + n}`,
				},
				{ label: "as token index", value: `token ${n}` },
				{
					label: "as outcome ID",
					value: `coins #${outcomeEncoding(n, 0)} / #${outcomeEncoding(n, 1)}`,
				},
			);
			explanation =
				"A bare number is ambiguous: it can be a perp asset ID, a spot pair index, a token index or an outcome ID. These are four separate index spaces.";
		} else {
			explanation = d.reason;
		}
		return {
			shape: "number",
			family: "asset-id",
			title: "number",
			explanation,
			derived,
			outcome,
		};
	}
	if (/^0x[0-9a-fA-F]{32}$/.test(q)) {
		return {
			shape: "token-id",
			family: "token",
			title: "token ID",
			explanation:
				"A 16-byte token ID from spotMeta.tokens. Transfers take name:tokenId; it is not a coin and not an asset ID.",
			derived: [],
			outcome: null,
		};
	}
	if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
		return {
			shape: "evm-address",
			family: "token",
			title: "EVM address",
			explanation:
				"A 20-byte HyperEVM address. It resolves only if a HyperCore token's deployer linked this ERC-20 contract.",
			derived: [],
			outcome: null,
		};
	}
	if (q.includes("/")) {
		return {
			shape: "pair-name",
			family: "coin",
			title: "spot pair name",
			explanation:
				"BASE/QUOTE names a spot pair by its tokens. Only canonical pairs accept this as a coin string; the others must be sent as @<index>.",
			derived: [],
			outcome: null,
		};
	}
	m = /^([^:]+):(.+)$/.exec(q);
	if (m) {
		return {
			shape: "hip3-coin",
			family: "coin",
			title: "HIP-3 coin",
			explanation:
				"dex:NAME is the coin string of a perp on a builder-deployed (HIP-3) dex. Its asset ID is 100000 + dex index × 10000 + index.",
			derived: [{ label: "dex", value: m[1] ?? "" }],
			outcome: null,
		};
	}
	m = /^(.+?)[-_ ](PERP|USD|USDC|SPOT)$/i.exec(q);
	if (m) {
		return {
			shape: "symbol-suffix",
			family: "display",
			title: "display symbol",
			explanation: `"${m[2]?.toUpperCase()}" suffixes are app spellings; the API never accepts them. Resolving "${m[1]}" instead.`,
			derived: [{ label: "symbol", value: m[1] ?? "" }],
			outcome: null,
		};
	}
	return {
		shape: "symbol",
		family: "coin",
		title: "symbol",
		explanation:
			"A plain symbol can be a perp coin, a spot base token, a token name or a HIP-3 market base. Every identity it names is listed.",
		derived: [],
		outcome: null,
	};
}

// ── Every spelling of one identity ──

export interface Spelling {
	readonly label: string;
	readonly value: string;
	readonly usedIn: readonly UsedIn[];
	readonly note?: string;
}

function tokenSpellings(t: TokenRef, prefix = ""): Spelling[] {
	const p = prefix ? `${prefix} ` : "";
	const out: Spelling[] = [
		{
			label: `${p}token name`,
			value: t.name,
			usedIn: ["balances"],
			note: "the coin field of a balance entry",
		},
		{
			label: `${p}token index`,
			value: String(t.index),
			usedIn: ["corewriter", "transfers"],
			note: "a third index space, separate from spot pair and perp indexes",
		},
		{ label: `${p}token ID`, value: t.tokenId, usedIn: ["transfers"] },
		{
			label: `${p}token string`,
			value: `${t.name}:${t.tokenId}`,
			usedIn: ["transfers"],
			note: "the token field of spotSend / sendAsset",
		},
	];
	if (t.evmContract)
		out.push({
			label: `${p}EVM contract`,
			value: t.evmContract.address,
			usedIn: ["evm"],
			note: `evmExtraWeiDecimals ${t.evmContract.evmExtraWeiDecimals}`,
		});
	return out;
}

/** Every spelling of a resolved identity, with where each one is used. */
export function identitySpellings(m: ResolvedMatch): Spelling[] {
	if (m.kind === "token") return tokenSpellings(m.token);
	const a = m.asset;
	const out: Spelling[] = [];
	switch (a.venue.kind) {
		case "perp":
			out.push(
				{ label: "coin", value: a.coin, usedIn: ["info", "ws"] },
				{
					label: "display symbol",
					value: a.displaySymbol,
					usedIn: ["frontend"],
				},
				{
					label: "asset ID",
					value: String(a.actionAssetId),
					usedIn: ["exchange", "corewriter"],
					note: `= index ${a.perpIndex} in meta.universe`,
				},
				{
					label: "perp index",
					value: String(a.perpIndex),
					usedIn: ["info"],
					note: "position in meta.universe of the first dex",
				},
			);
			break;
		case "hip3":
			out.push(
				{ label: "coin", value: a.coin, usedIn: ["info", "ws"] },
				{
					label: "display symbol",
					value: a.displaySymbol,
					usedIn: ["frontend"],
				},
				{
					label: "asset ID",
					value: String(a.actionAssetId),
					usedIn: ["exchange", "corewriter"],
					note: `= ${HIP3_ASSET_OFFSET} + dex ${a.venue.dexIndex} × ${HIP3_DEX_STRIDE} + index ${a.perpIndex}`,
				},
				{
					label: "dex",
					value: `${a.venue.dex} (index ${a.venue.dexIndex})`,
					usedIn: ["info"],
					note: "the dex field of meta / allMids requests",
				},
				{
					label: "perp index",
					value: String(a.perpIndex),
					usedIn: ["info"],
					note: "position in this dex's universe",
				},
			);
			break;
		case "spot":
			out.push({
				label: "coin",
				value: `@${a.spotPairIndex}`,
				usedIn: ["info", "ws"],
				note: a.isCanonical
					? `canonical pair: "${a.coin === `@${a.spotPairIndex}` ? a.displaySymbol : a.coin}" is also accepted`
					: "non-canonical pairs have no name; only @<index> works",
			});
			out.push(
				{
					label: "display symbol",
					value: a.displaySymbol,
					usedIn: ["frontend"],
					note: "token names joined with /; the API rejects it",
				},
				{
					label: "asset ID",
					value: String(a.actionAssetId),
					usedIn: ["exchange", "corewriter"],
					note: `= ${SPOT_ASSET_OFFSET} + spot pair index ${a.spotPairIndex}`,
				},
				{
					label: "spot pair index",
					value: String(a.spotPairIndex),
					usedIn: ["info"],
					note: "spotMeta.universe[].index (not the array position)",
				},
			);
			if (a.baseToken) out.push(...tokenSpellings(a.baseToken, "base"));
			if (a.quoteToken)
				out.push({
					label: "quote token",
					value: a.quoteToken.name,
					usedIn: ["balances"],
					note: `token ${a.quoteToken.index}; prices and notional are in this token`,
				});
			break;
		case "outcome": {
			const o = a.outcome;
			out.push(
				{
					label: "coin",
					value: a.coin,
					usedIn: ["info", "ws"],
					note: "#<encoding>",
				},
				{
					label: "token",
					value: a.base,
					usedIn: ["balances"],
					note: "+<encoding>; what you hold after buying this side",
				},
				{
					label: "asset ID",
					value: String(a.actionAssetId),
					usedIn: ["exchange", "corewriter"],
					note: `= ${OUTCOME_ASSET_OFFSET} + encoding ${o?.encoding}`,
				},
			);
			if (o)
				out.push(
					{
						label: "encoding",
						value: String(o.encoding),
						usedIn: ["info"],
						note: `= 10 × outcome ${o.outcomeId} + side ${o.side}`,
					},
					{
						label: "outcome",
						value: String(o.outcomeId),
						usedIn: ["corewriter"],
						note: "the outcome field of outcome operations and settledOutcome",
					},
					{
						label: "side",
						value: `${o.side} (${o.sideName})`,
						usedIn: ["info"],
					},
				);
			out.push({
				label: "display symbol",
				value: a.displaySymbol,
				usedIn: ["frontend"],
			});
			break;
		}
	}
	return out;
}

// ── Same asset, other venues ──

export type Relation =
	| "perp"
	| "hip3"
	| "spot"
	| "token"
	| "other-side"
	| "same-question";

export interface RelatedIdentity<N extends Network = Network> {
	readonly relation: Relation;
	readonly match: ResolvedMatch<N>;
}

function baseSymbolOf(m: ResolvedMatch): string | null {
	if (m.kind === "token") return m.token.name.toUpperCase();
	const a = m.asset;
	if (a.venue.kind === "outcome") return null;
	return a.base.toUpperCase();
}

/**
 * Other identities of the same underlying asset: the perp, the HIP-3
 * markets, the spot pairs and the token that share a base symbol. For an
 * outcome: the other side and the other outcomes of its question.
 */
export function relatedIdentities<N extends Network>(
	universe: AssetUniverse<N>,
	m: ResolvedMatch<N>,
): RelatedIdentity<N>[] {
	const out: RelatedIdentity<N>[] = [];
	const self = m.kind === "asset" ? `a:${m.asset.coin}` : `t:${m.token.index}`;
	const push = (relation: Relation, match: ResolvedMatch<N>) => {
		const k =
			match.kind === "asset"
				? `a:${match.asset.coin}`
				: `t:${match.token.index}`;
		if (
			k !== self &&
			!out.some(
				(r) =>
					(r.match.kind === "asset"
						? `a:${r.match.asset.coin}`
						: `t:${r.match.token.index}`) === k,
			)
		)
			out.push({ relation, match });
	};
	const asset = (a: Asset<N>): ResolvedMatch<N> => ({
		kind: "asset",
		asset: a,
		reason: "coin",
		score: 0,
	});
	if (
		m.kind === "asset" &&
		m.asset.venue.kind === "outcome" &&
		m.asset.outcome
	) {
		const o = m.asset.outcome;
		for (const a of universe.assets) {
			if (!a.outcome) continue;
			if (a.outcome.outcomeId === o.outcomeId) push("other-side", asset(a));
			else if (o.questionId !== null && a.outcome.questionId === o.questionId)
				push("same-question", asset(a));
		}
		return out;
	}
	const base = baseSymbolOf(m);
	if (!base) return out;
	for (const a of universe.assets) {
		if (a.isDelisted) continue;
		if (a.venue.kind === "perp" && a.coin.toUpperCase() === base)
			push("perp", asset(a));
		else if (a.venue.kind === "hip3" && a.base.toUpperCase() === base)
			push("hip3", asset(a));
		else if (
			a.venue.kind === "spot" &&
			a.baseToken?.name.toUpperCase() === base
		)
			push("spot", asset(a));
	}
	for (const t of universe.tokens) {
		if (t.name.toUpperCase() === base)
			push("token", {
				kind: "token",
				token: t,
				reason: "token-name",
				score: 0,
			});
	}
	return out;
}

// ── Settled outcomes ──

export interface RawSettledOutcome {
	spec: RawOutcome;
	settleFraction: string;
	details: string;
}

export interface SettledOutcome<N extends Network = Network> {
	readonly network: N;
	readonly outcomeId: number;
	readonly name: string;
	readonly description: string;
	readonly parsedDescription: Record<string, string> | null;
	readonly sides: readonly {
		readonly side: 0 | 1;
		readonly name: string;
		readonly coin: string;
		readonly token: string;
		readonly actionAssetId: number;
		/** Quote tokens paid per share at settlement. */
		readonly payout: string;
	}[];
	readonly settleFraction: string;
	readonly details: string;
	readonly quoteToken: string;
	readonly venue: string | null;
	readonly raw: RawSettledOutcome;
}

/** "0.0" → "0", "1.0" → "1", "0.25" → "0.25" (settleFraction is a decimal string). */
function trimDecimal(s: string): string {
	if (!/^\d+(\.\d+)?$/.test(s)) return s;
	return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

function oneMinus(s: string): string {
	if (!/^\d+(\.\d+)?$/.test(s)) return "?";
	const [int = "0", frac = ""] = s.split(".");
	const scale = frac.length;
	const n = BigInt(int + frac);
	const one = BigInt(`1${"0".repeat(scale)}`);
	const diff = one - n;
	if (diff < 0n) return "?";
	const str = diff.toString().padStart(scale + 1, "0");
	const out = scale ? `${str.slice(0, -scale)}.${str.slice(-scale)}` : str;
	return trimDecimal(out);
}

/** Normalise a `settledOutcome` response. Returns null when the API returned null (not settled, or unknown). */
export function normalizeSettledOutcome<N extends Network>(
	network: N,
	raw: RawSettledOutcome | null,
): SettledOutcome<N> | null {
	if (!raw || !raw.spec) return null;
	const o = raw.spec;
	const fraction = trimDecimal(raw.settleFraction);
	const sides = o.sideSpecs.slice(0, 2).map((s, i) => {
		const side = i as 0 | 1;
		const encoding = outcomeEncoding(o.outcome, side);
		return {
			side,
			name: cleanTemplateName(s.name),
			coin: `#${encoding}`,
			token: `+${encoding}`,
			actionAssetId: outcomeAssetId(o.outcome, side),
			payout: side === 0 ? fraction : oneMinus(raw.settleFraction),
		};
	});
	return {
		network,
		outcomeId: o.outcome,
		name: cleanTemplateName(o.name),
		description: o.description,
		parsedDescription: parseOutcomeDescription(o.description),
		sides,
		settleFraction: fraction,
		details: raw.details,
		quoteToken: o.quoteToken ?? "USDC",
		venue: o.venue ?? null,
		raw,
	};
}

/** The outcome ID a query refers to, if its shape is an outcome spelling. */
export function outcomeIdOfQuery(query: string): number | null {
	return classifyQuery(query).outcome?.outcome ?? null;
}
