/**
 * CoreWriter action codec: bytes ⇄ typed fields with human units.
 *
 * Layout: [version u8][action id u24 BE][abi.encode(fields…)].
 * Decoding is strict: unknown versions and unknown action IDs produce an
 * explicit result rather than a best guess, and the ABI body must re-encode
 * to exactly the input bytes (no trailing or non-canonical data).
 */

import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { Decimal, InexactError } from "../decimal.ts";
import type { Asset, TokenRef } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { bytesToHex, hexToBytes } from "../msgpack.ts";
import type { Network } from "../network.ts";
import type { AssetUniverse } from "../resolver/metadata.ts";
import {
	COREWRITER_ACTIONS,
	COREWRITER_ADDRESS,
	type CoreWriterActionSpec,
	type CoreWriterField,
	coreWriterActionById,
	coreWriterActionByKey,
	SEND_RAW_ACTION_SELECTOR,
	SUPPORTED_ENCODING_VERSIONS,
	UINT32_MAX,
} from "../rules/corewriter.ts";
import { checkPrice, checkSize } from "../rules/precision.ts";

export interface DecodedField {
	readonly field: CoreWriterField;
	/** Raw ABI value: bigint for integers, boolean, or string for address/string. */
	readonly raw: bigint | boolean | string;
	/** Raw value as shown to users (integers in decimal). */
	readonly rawDisplay: string;
	/** Human-readable value, or null when no conversion applies. */
	readonly human: string | null;
	/** Extra context, e.g. the resolved asset name or token. */
	readonly note: string | null;
}

export type CoreWriterDecode =
	| {
			readonly kind: "decoded";
			readonly version: number;
			readonly actionId: number;
			readonly spec: CoreWriterActionSpec;
			readonly fields: readonly DecodedField[];
			readonly bodyHex: Hex;
			readonly bytes: Uint8Array;
			readonly issues: readonly Issue[];
	  }
	| {
			readonly kind: "unknown-version";
			readonly version: number;
			readonly actionId: number | null;
			readonly bytes: Uint8Array;
			readonly issues: readonly Issue[];
	  }
	| {
			readonly kind: "unknown-action";
			readonly version: number;
			readonly actionId: number;
			readonly bytes: Uint8Array;
			readonly issues: readonly Issue[];
	  }
	| {
			readonly kind: "malformed";
			readonly bytes: Uint8Array | null;
			readonly issues: readonly Issue[];
	  };

export interface CoreWriterContext {
	/** Universe for the network the action runs on (labels assets/tokens). */
	readonly universe?: AssetUniverse<Network>;
}

function tokenOf(ctx: CoreWriterContext, index: bigint): TokenRef | undefined {
	return ctx.universe?.tokensByIndex.get(Number(index));
}

function assetOf(ctx: CoreWriterContext, id: bigint): Asset | undefined {
	return ctx.universe?.byActionId.get(Number(id));
}

function cloidHex(v: bigint): string {
	return `0x${v.toString(16).padStart(32, "0")}`;
}

function humanize(
	field: CoreWriterField,
	raw: bigint | boolean | string,
	all: Record<string, bigint | boolean | string>,
	ctx: CoreWriterContext,
): { human: string | null; note: string | null } {
	const u = field.unit;
	switch (u.kind) {
		case "bool":
			return { human: raw ? "true" : "false", note: null };
		case "address":
		case "string":
			return { human: null, note: null };
		case "fixed":
			return {
				human: `${Decimal.fromScaled(raw as bigint, u.decimals).toString()}${u.symbol ? ` ${u.symbol}` : ""}`,
				note: `raw ÷ 10^${u.decimals}`,
			};
		case "asset": {
			const a = assetOf(ctx, raw as bigint);
			return {
				human: a ? a.coin : null,
				note: a
					? `${a.displaySymbol} (${a.venue.kind})`
					: ctx.universe
						? `not an asset on ${ctx.universe.network}`
						: null,
			};
		}
		case "token": {
			const t = tokenOf(ctx, raw as bigint);
			return {
				human: t ? t.name : null,
				note: t
					? `weiDecimals ${t.weiDecimals}`
					: ctx.universe
						? `no token ${raw} on ${ctx.universe.network}`
						: null,
			};
		}
		case "tokenWei": {
			let decimals: number | undefined;
			let symbol = "";
			if (u.fixedToken === "HYPE") {
				decimals = 8;
				symbol = "HYPE";
			} else if (u.tokenField) {
				const t = tokenOf(ctx, all[u.tokenField] as bigint);
				decimals = t?.weiDecimals;
				symbol = t?.name ?? "";
			}
			if (decimals === undefined) {
				return {
					human: null,
					note: "token weiDecimals unknown without metadata",
				};
			}
			return {
				human: `${Decimal.fromScaled(raw as bigint, decimals).toString()}${symbol ? ` ${symbol}` : ""}`,
				note: `raw ÷ 10^${decimals} (weiDecimals)`,
			};
		}
		case "enum": {
			const label = u.values[String(raw)];
			return {
				human: label ?? null,
				note: label ? null : "not a defined value",
			};
		}
		case "cloid":
			return (raw as bigint) === 0n
				? { human: "none", note: "0 = no cloid" }
				: { human: cloidHex(raw as bigint), note: "as 16-byte hex" };
		case "dex": {
			const n = raw as bigint;
			if (n === BigInt(UINT32_MAX))
				return { human: "spot", note: "uint32 max = spot" };
			const dex = ctx.universe?.dexes.find((d) => d.index === Number(n));
			return {
				human:
					n === 0n
						? "first perp dex"
						: dex
							? `perp dex "${dex.name}"`
							: `perp dex ${n}`,
				note: null,
			};
		}
		case "decibps": {
			const bps = Decimal.fromScaled(raw as bigint, 1);
			return {
				human: `${bps.toString()} bps (${Decimal.fromScaled(raw as bigint, 3).toString()}%)`,
				note: "tenths of a basis point",
			};
		}
		case "raw":
			return { human: null, note: null };
	}
}

function semanticIssues(
	spec: CoreWriterActionSpec,
	values: Record<string, bigint | boolean | string>,
	ctx: CoreWriterContext,
): Issue[] {
	const out: Issue[] = [];
	for (const f of spec.fields) {
		if (
			f.unit.kind === "enum" &&
			f.unit.values[String(values[f.name])] === undefined
		) {
			out.push(
				issue(
					"corewriter.enum",
					"error",
					`${f.name} = ${String(values[f.name])} is not a defined value (${Object.entries(
						f.unit.values,
					)
						.map(([k, v]) => `${k}=${v}`)
						.join(", ")}). HyperCore rejects the action.`,
					{ path: f.name },
				),
			);
		}
	}
	if (spec.key === "limitOrder") {
		const asset = assetOf(ctx, values.asset as bigint);
		const px = Decimal.fromScaled(values.limitPx as bigint, 8);
		const sz = Decimal.fromScaled(values.sz as bigint, 8);
		if ((values.sz as bigint) === 0n)
			out.push(
				issue("corewriter.zero_size", "error", "Size is 0.", { path: "sz" }),
			);
		if ((values.limitPx as bigint) === 0n)
			out.push(
				issue("corewriter.zero_price", "error", "Limit price is 0.", {
					path: "limitPx",
				}),
			);
		if (ctx.universe && !asset) {
			out.push(
				issue(
					"corewriter.unknown_asset",
					"error",
					`Asset ${String(values.asset)} does not exist on ${ctx.universe.network}.`,
					{ path: "asset" },
				),
			);
		}
		if (asset && asset.szDecimals !== null) {
			const venue = asset.venue.kind;
			for (const i of checkPrice(px, venue, asset.szDecimals, "limitPx")
				.issues) {
				out.push({
					...i,
					message: `${i.message} (after ÷10^8 scaling; HyperCore applies ${asset.coin}'s tick rules)`,
				});
			}
			for (const i of checkSize(sz, asset.szDecimals, "sz").issues) {
				out.push({ ...i, message: `${i.message} (after ÷10^8 scaling)` });
			}
			const notional = px.mul(sz);
			if (
				!sz.isZero() &&
				notional.lt(Decimal.parse("10")) &&
				!values.reduceOnly
			) {
				out.push(
					issue(
						"corewriter.min_notional",
						"warning",
						`Notional ${notional.toString()} ${asset.quote} is below the 10 ${asset.quote} minimum.`,
						{ path: "sz" },
					),
				);
			}
		}
	}
	if (spec.key === "outcomeOperation") {
		const op = String(values.encodedOperation);
		if ((op === "0" || op === "1") && (values.question as bigint) !== 0n) {
			out.push(
				issue(
					"corewriter.unused_nonzero",
					"error",
					"Split/MergeOutcome ignore `question`; it must be 0 or the payload is dropped.",
					{ path: "question" },
				),
			);
		}
		if (op === "2" && (values.outcome as bigint) !== 0n) {
			out.push(
				issue(
					"corewriter.unused_nonzero",
					"error",
					"MergeQuestion ignores `outcome`; it must be 0 or the payload is dropped.",
					{ path: "outcome" },
				),
			);
		}
	}
	if (
		spec.key === "spotSend" ||
		spec.key === "sendAsset" ||
		spec.key === "vaultTransfer"
	) {
		const amountField = spec.key === "vaultTransfer" ? "usd" : "wei";
		if ((values[amountField] as bigint) === 0n)
			out.push(
				issue("corewriter.zero_amount", "warning", "Amount is 0.", {
					path: amountField,
				}),
			);
	}
	return out;
}

/** Strip an optional `sendRawAction(bytes)` wrapper (calldata) to the raw action. */
export function unwrapSendRawAction(bytes: Uint8Array): {
	action: Uint8Array;
	wrapped: boolean;
} {
	const hex = bytesToHex(bytes);
	if (hex.startsWith(SEND_RAW_ACTION_SELECTOR) && bytes.length >= 4 + 64) {
		try {
			const [inner] = decodeAbiParameters(
				[{ type: "bytes" }],
				`0x${hex.slice(10)}` as Hex,
			);
			return { action: hexToBytes(inner), wrapped: true };
		} catch {
			return { action: bytes, wrapped: false };
		}
	}
	return { action: bytes, wrapped: false };
}

export function decodeCoreWriterAction(
	input: Uint8Array | string,
	ctx: CoreWriterContext = {},
): CoreWriterDecode {
	let bytes: Uint8Array;
	try {
		bytes = typeof input === "string" ? hexToBytes(input) : input;
	} catch (e) {
		return {
			kind: "malformed",
			bytes: null,
			issues: [issue("corewriter.hex", "error", (e as Error).message)],
		};
	}
	const issues: Issue[] = [];
	const unwrapped = unwrapSendRawAction(bytes);
	if (unwrapped.wrapped) {
		issues.push(
			issue(
				"corewriter.calldata",
				"info",
				"Input was sendRawAction(bytes) calldata; decoded the inner action bytes.",
			),
		);
		bytes = unwrapped.action;
	}
	if (bytes.length < 4) {
		return {
			kind: "malformed",
			bytes,
			issues: [
				...issues,
				issue(
					"corewriter.short",
					"error",
					`Only ${bytes.length} bytes: an action needs a 1-byte version and a 3-byte action ID before its ABI body.`,
				),
			],
		};
	}
	const version = bytes[0] as number;
	const actionId =
		((bytes[1] as number) << 16) |
		((bytes[2] as number) << 8) |
		(bytes[3] as number);
	if (!(SUPPORTED_ENCODING_VERSIONS as readonly number[]).includes(version)) {
		return {
			kind: "unknown-version",
			version,
			actionId,
			bytes,
			issues: [
				...issues,
				issue(
					"corewriter.unknown_version",
					"error",
					`Encoding version ${version} is not defined (only ${SUPPORTED_ENCODING_VERSIONS.join(", ")}). The body is not decoded: a different version may lay it out differently.`,
				),
			],
		};
	}
	const spec = coreWriterActionById(actionId);
	if (!spec) {
		return {
			kind: "unknown-action",
			version,
			actionId,
			bytes,
			issues: [
				...issues,
				issue(
					"corewriter.unknown_action",
					"error",
					`Action ID ${actionId} is not defined for version ${version}.`,
				),
			],
		};
	}
	const bodyHex = bytesToHex(bytes.slice(4)) as Hex;
	let decoded: readonly unknown[];
	try {
		decoded = decodeAbiParameters(
			spec.fields.map((f) => ({ type: f.type, name: f.name })),
			bodyHex,
		);
	} catch (e) {
		return {
			kind: "malformed",
			bytes,
			issues: [
				...issues,
				issue(
					"corewriter.abi",
					"error",
					`The body does not ABI-decode as ${spec.name} (${spec.fields.map((f) => f.type).join(", ")}): ${(e as Error).message.split("\n")[0]}`,
				),
			],
		};
	}
	const values: Record<string, bigint | boolean | string> = {};
	spec.fields.forEach((f, i) => {
		const v = decoded[i];
		values[f.name] =
			typeof v === "number" ? BigInt(v) : (v as bigint | boolean | string);
	});
	const reencoded = encodeAbiParameters(
		spec.fields.map((f) => ({ type: f.type })),
		spec.fields.map((f) => values[f.name]) as unknown[],
	);
	if (reencoded.toLowerCase() !== bodyHex.toLowerCase()) {
		issues.push(
			issue(
				"corewriter.noncanonical",
				"warning",
				`The ABI body has ${(bodyHex.length - reencoded.length) / 2} extra or non-canonical bytes after the fields.`,
			),
		);
	}
	const fields: DecodedField[] = spec.fields.map((f) => {
		const raw = values[f.name] as bigint | boolean | string;
		const { human, note } = humanize(f, raw, values, ctx);
		return {
			field: f,
			raw,
			rawDisplay: typeof raw === "bigint" ? raw.toString() : String(raw),
			human,
			note,
		};
	});
	issues.push(...semanticIssues(spec, values, ctx));
	return {
		kind: "decoded",
		version,
		actionId,
		spec,
		fields,
		bodyHex,
		bytes,
		issues,
	};
}

export interface EncodeResult {
	readonly bytes: Uint8Array | null;
	readonly hex: Hex | null;
	readonly values: Record<string, bigint | boolean | string>;
	readonly issues: readonly Issue[];
}

/**
 * Encode an action from user inputs. `fixed` fields accept human decimals
 * ("2667.1" → 266710000000 for 1e8) and reject values that aren't exact;
 * `tokenWei` accepts raw integers; enums accept the number or the label.
 */
export function encodeCoreWriterAction(
	key: string,
	inputs: Readonly<Record<string, string>>,
	ctx: CoreWriterContext = {},
): EncodeResult {
	const spec = coreWriterActionByKey(key);
	if (!spec)
		return {
			bytes: null,
			hex: null,
			values: {},
			issues: [
				issue("corewriter.unknown_action", "error", `Unknown action ${key}.`),
			],
		};
	const issues: Issue[] = [];
	const values: Record<string, bigint | boolean | string> = {};
	for (const f of spec.fields) {
		const text = (inputs[f.name] ?? "").trim();
		const u = f.unit;
		const maxBits = /^u?int(\d+)$/.exec(f.type)?.[1];
		const max = maxBits ? (1n << BigInt(maxBits)) - 1n : null;
		const fail = (msg: string) =>
			issues.push(issue("corewriter.input", "error", msg, { path: f.name }));
		if (f.type === "address") {
			if (!/^0x[0-9a-fA-F]{40}$/.test(text))
				fail(`${f.name}: enter a 0x-prefixed 20-byte address.`);
			else values[f.name] = text.toLowerCase();
			continue;
		}
		if (f.type === "bool") {
			if (text !== "true" && text !== "false")
				fail(`${f.name}: choose true or false.`);
			else values[f.name] = text === "true";
			continue;
		}
		if (f.type === "string") {
			values[f.name] = text;
			continue;
		}
		let n: bigint | null = null;
		if (u.kind === "fixed") {
			const d = Decimal.tryParse(text);
			if (!d) fail(`${f.name}: enter a decimal number.`);
			else {
				try {
					n = d.toScaledBigInt(u.decimals);
				} catch (e) {
					if (e instanceof InexactError)
						fail(
							`${f.name}: ${d.toString()} has more than ${u.decimals} decimal places and cannot be encoded exactly.`,
						);
					else throw e;
				}
			}
		} else if (u.kind === "enum") {
			const byLabel = Object.entries(u.values).find(
				([, label]) => label.toLowerCase() === text.toLowerCase(),
			);
			if (byLabel) n = BigInt(byLabel[0]);
			else if (/^\d+$/.test(text)) n = BigInt(text);
			else
				fail(`${f.name}: choose one of ${Object.values(u.values).join(", ")}.`);
		} else if (u.kind === "cloid") {
			if (text === "" || text === "0") n = 0n;
			else if (/^0x[0-9a-fA-F]{1,32}$/.test(text)) n = BigInt(text);
			else if (/^\d+$/.test(text)) n = BigInt(text);
			else
				fail(
					`${f.name}: enter 0 (none), a decimal integer or up to 16 bytes of hex.`,
				);
		} else if (u.kind === "dex" && text.toLowerCase() === "spot") {
			n = BigInt(UINT32_MAX);
		} else if (
			u.kind === "decibps" &&
			/^\d+(\.\d)?$/.test(text) &&
			text.includes(".")
		) {
			fail(
				`${f.name}: enter an integer number of tenths of a basis point (10 = 1 bps).`,
			);
		} else if (/^\d+$/.test(text)) {
			n = BigInt(text);
		} else {
			fail(`${f.name}: enter a non-negative integer.`);
		}
		if (n !== null) {
			if (n < 0n || (max !== null && n > max))
				fail(`${f.name}: ${n} does not fit in ${f.type}.`);
			else values[f.name] = n;
		}
	}
	if (issues.some((i) => i.severity === "error"))
		return { bytes: null, hex: null, values, issues };
	issues.push(...semanticIssues(spec, values, ctx));
	const body = encodeAbiParameters(
		spec.fields.map((f) => ({ type: f.type })),
		spec.fields.map((f) => values[f.name]) as unknown[],
	);
	const header = new Uint8Array([
		1,
		(spec.id >> 16) & 0xff,
		(spec.id >> 8) & 0xff,
		spec.id & 0xff,
	]);
	const bodyBytes = hexToBytes(body);
	const bytes = new Uint8Array(4 + bodyBytes.length);
	bytes.set(header, 0);
	bytes.set(bodyBytes, 4);
	return { bytes, hex: bytesToHex(bytes) as Hex, values, issues };
}

/** calldata for CoreWriter.sendRawAction(bytes). */
export function sendRawActionCalldata(actionHex: Hex): Hex {
	const encoded = encodeAbiParameters([{ type: "bytes" }], [actionHex]);
	return `${SEND_RAW_ACTION_SELECTOR}${encoded.slice(2)}` as Hex;
}

function solidityLiteral(
	f: CoreWriterField,
	v: bigint | boolean | string,
): string {
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "bigint")
		return f.type.startsWith("uint") && f.type !== "uint256"
			? `${f.type}(${v})`
			: v.toString();
	if (f.type === "address") return v;
	return JSON.stringify(v);
}

export interface CoreWriterSnippets {
	readonly calldata: Hex;
	readonly castSend: string;
	readonly castCall: string;
	readonly solidity: string;
}

export function coreWriterSnippets(
	spec: CoreWriterActionSpec,
	values: Record<string, bigint | boolean | string>,
	actionHex: Hex,
	rpcUrl: string,
	from?: string,
): CoreWriterSnippets {
	const calldata = sendRawActionCalldata(actionHex);
	const castSend = [
		`cast send ${COREWRITER_ADDRESS} \\`,
		`  "sendRawAction(bytes)" ${actionHex} \\`,
		`  --rpc-url ${rpcUrl} \\`,
		"  --ledger  # or --account <keystore>; never paste a raw private key",
	].join("\n");
	const castCall = [
		`cast call ${COREWRITER_ADDRESS} \\`,
		`  "sendRawAction(bytes)" ${actionHex} \\`,
		...(from ? [`  --from ${from} \\`] : []),
		`  --rpc-url ${rpcUrl}`,
		"# Succeeds if the EVM call doesn't revert. HyperCore validates the action later — a successful call does not mean it will be accepted.",
	].join("\n");
	const params = spec.fields.map((f) => `${f.type} ${f.name}`).join(", ");
	const args = spec.fields
		.map((f) => solidityLiteral(f, values[f.name] as bigint | boolean | string))
		.join(", ");
	const fnName = `send${spec.key.charAt(0).toUpperCase()}${spec.key.slice(1)}`;
	const solidity = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICoreWriter {
    function sendRawAction(bytes calldata data) external;
}

contract CoreWriterCaller {
    ICoreWriter constant CORE_WRITER = ICoreWriter(${COREWRITER_ADDRESS});
    uint8 constant ENCODING_VERSION = 1;
    uint24 constant ${spec.key.replace(/([A-Z])/g, "_$1").toUpperCase()}_ACTION = ${spec.id};

    /// ${spec.name}. This contract must already exist on HyperCore
    /// (e.g. have received USDC) before the EVM block that calls this.
    function ${fnName}(${params}) external {
        bytes memory data = abi.encodePacked(
            ENCODING_VERSION,
            ${spec.key.replace(/([A-Z])/g, "_$1").toUpperCase()}_ACTION,
            abi.encode(${spec.fields.map((f) => f.name).join(", ")})
        );
        CORE_WRITER.sendRawAction(data);
    }
}

// Call with the decoded values:
// ${fnName}(${args});`;
	return { calldata, castSend, castCall, solidity };
}

export { COREWRITER_ACTIONS };
