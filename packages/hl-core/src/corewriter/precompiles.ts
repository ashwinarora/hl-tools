/** HyperEVM read precompiles: encode inputs, decode outputs, query live. */

import {
	type AbiParameter,
	decodeAbiParameters,
	encodeAbiParameters,
	type Hex,
} from "viem";
import { Decimal } from "../decimal.ts";
import { type Issue, issue } from "../issues.ts";
import { type RpcExchange, rpcCall } from "../rpc/client.ts";
import type {
	PrecompileOutputField,
	PrecompileSpec,
} from "../rules/precompiles.ts";

function outputParam(f: PrecompileOutputField): AbiParameter {
	if (f.type === "(address,uint64)[]") {
		return {
			name: f.name,
			type: "tuple[]",
			components: [
				{ name: "user", type: "address" },
				{ name: "balance", type: "uint64" },
			],
		};
	}
	return { name: f.name, type: f.type };
}

export interface PrecompileInputResult {
	readonly data: Hex | null;
	readonly issues: readonly Issue[];
}

export function encodePrecompileInput(
	spec: PrecompileSpec,
	inputs: Readonly<Record<string, string>>,
): PrecompileInputResult {
	const issues: Issue[] = [];
	const values: unknown[] = [];
	for (const p of spec.params) {
		const t = (inputs[p.name] ?? "").trim();
		if (p.type === "address") {
			if (!/^0x[0-9a-fA-F]{40}$/.test(t))
				issues.push(
					issue(
						"precompile.input",
						"error",
						`${p.name}: enter a 0x-prefixed 20-byte address.`,
						{ path: p.name },
					),
				);
			else values.push(t);
		} else {
			const bits = Number(/^uint(\d+)$/.exec(p.type)?.[1] ?? 256);
			if (!/^\d+$/.test(t))
				issues.push(
					issue(
						"precompile.input",
						"error",
						`${p.name}: enter a non-negative integer.`,
						{ path: p.name },
					),
				);
			else if (BigInt(t) >= 1n << BigInt(bits))
				issues.push(
					issue(
						"precompile.input",
						"error",
						`${p.name}: does not fit in ${p.type}.`,
						{ path: p.name },
					),
				);
			else values.push(BigInt(t));
		}
	}
	if (issues.length) return { data: null, issues };
	const data =
		spec.params.length === 0
			? ("0x" as Hex)
			: encodeAbiParameters(
					spec.params.map((p) => ({ type: p.type, name: p.name })),
					values,
				);
	return { data, issues };
}

/** Decimals needed to convert raw integers to human units. */
export interface PrecompileUnits {
	/** szDecimals of the perp (for perpPx and szi). */
	readonly perpSzDecimals?: number;
	/** szDecimals of the spot pair's base token (for spotPx). */
	readonly spotBaseSzDecimals?: number;
	/** weiDecimals of the token (for tokenWei). */
	readonly tokenWeiDecimals?: number;
	/** Name to append to token amounts. */
	readonly tokenSymbol?: string;
}

export interface DecodedPrecompileValue {
	readonly name: string;
	readonly type: string;
	readonly raw: string;
	readonly human: string | null;
	readonly note: string | null;
}

export type PrecompileDecode =
	| {
			readonly kind: "tuple";
			readonly values: readonly DecodedPrecompileValue[];
	  }
	| {
			readonly kind: "array";
			readonly rows: readonly (readonly DecodedPrecompileValue[])[];
	  }
	| { readonly kind: "error"; readonly message: string };

function human(
	f: PrecompileOutputField,
	raw: unknown,
	units: PrecompileUnits,
): { human: string | null; note: string | null } {
	if (typeof raw !== "bigint") return { human: null, note: null };
	switch (f.unit) {
		case "perpPx":
			return units.perpSzDecimals === undefined
				? {
						human: null,
						note: "needs the perp's szDecimals: ÷ 10^(6 − szDecimals)",
					}
				: {
						human: Decimal.fromScaled(raw, 6 - units.perpSzDecimals).toString(),
						note: `÷ 10^(6 − ${units.perpSzDecimals})`,
					};
		case "spotPx":
			return units.spotBaseSzDecimals === undefined
				? {
						human: null,
						note: "needs the base token's szDecimals: ÷ 10^(8 − szDecimals)",
					}
				: {
						human: Decimal.fromScaled(
							raw,
							8 - units.spotBaseSzDecimals,
						).toString(),
						note: `÷ 10^(8 − ${units.spotBaseSzDecimals})`,
					};
		case "szi":
			return units.perpSzDecimals === undefined
				? { human: null, note: "needs szDecimals" }
				: {
						human: Decimal.fromScaled(raw, units.perpSzDecimals).toString(),
						note: `÷ 10^${units.perpSzDecimals}`,
					};
		case "usd6":
			return {
				human: `${Decimal.fromScaled(raw, 6).toString()} USDC`,
				note: "÷ 10^6",
			};
		case "hypeWei":
			return {
				human: `${Decimal.fromScaled(raw, 8).toString()} HYPE`,
				note: "÷ 10^8",
			};
		case "tokenWei":
			return units.tokenWeiDecimals === undefined
				? { human: null, note: "needs the token's weiDecimals" }
				: {
						human: `${Decimal.fromScaled(raw, units.tokenWeiDecimals).toString()}${units.tokenSymbol ? ` ${units.tokenSymbol}` : ""}`,
						note: `÷ 10^${units.tokenWeiDecimals}`,
					};
		case "timestampMs":
			return raw === 0n
				? { human: "—", note: null }
				: {
						human: new Date(Number(raw)).toISOString(),
						note: "ms since epoch",
					};
		default:
			return { human: null, note: null };
	}
}

function display(v: unknown): string {
	if (typeof v === "bigint") return v.toString();
	if (Array.isArray(v)) return `[${v.map(display).join(", ")}]`;
	if (v && typeof v === "object")
		return JSON.stringify(v, (_k, x) =>
			typeof x === "bigint" ? x.toString() : x,
		);
	return String(v);
}

function row(
	fields: readonly PrecompileOutputField[],
	obj: Record<string, unknown>,
	units: PrecompileUnits,
): DecodedPrecompileValue[] {
	return fields.map((f) => {
		const raw = obj[f.name];
		const h = human(f, raw, units);
		return { name: f.name, type: f.type, raw: display(raw), ...h };
	});
}

export function decodePrecompileOutput(
	spec: PrecompileSpec,
	data: Hex,
	units: PrecompileUnits = {},
): PrecompileDecode {
	const components = spec.output.fields.map(outputParam);
	try {
		if (spec.output.kind === "array") {
			const [arr] = decodeAbiParameters(
				[{ type: "tuple[]", components }],
				data,
			) as unknown as [Record<string, unknown>[]];
			return {
				kind: "array",
				rows: arr.map((o) => row(spec.output.fields, o, units)),
			};
		}
		// Precompiles return abi.encode(struct): a single tuple parameter. Single
		// scalars (e.g. markPx) encode identically as a one-field tuple.
		const [obj] = decodeAbiParameters(
			[{ type: "tuple", components }],
			data,
		) as unknown as [Record<string, unknown>];
		return { kind: "tuple", values: row(spec.output.fields, obj, units) };
	} catch (e) {
		return {
			kind: "error",
			message: `Output does not decode as ${spec.name}: ${(e as Error).message.split("\n")[0]}`,
		};
	}
}

export interface PrecompileQuery {
	readonly exchange: RpcExchange<Hex>;
	readonly decoded: PrecompileDecode | null;
}

export async function queryPrecompile(
	rpcUrl: string,
	spec: PrecompileSpec,
	data: Hex,
	units: PrecompileUnits = {},
	signal?: AbortSignal,
): Promise<PrecompileQuery> {
	const exchange = await rpcCall<Hex>(
		rpcUrl,
		"eth_call",
		[{ to: spec.address, data }, "latest"],
		{ signal },
	);
	if (exchange.failure || typeof exchange.result !== "string")
		return { exchange, decoded: null };
	return {
		exchange,
		decoded: decodePrecompileOutput(spec, exchange.result, units),
	};
}
