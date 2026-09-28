/**
 * MsgPack encoder/decoder that records which bytes belong to which field.
 *
 * Encoding matches Python `msgpack.packb` defaults (what the official SDK
 * hashes): maps in insertion order, smallest int format (unsigned formats for
 * non-negative ints), float64 for non-integers, str8/16/32 for strings, bin
 * for bytes. Spans let the UI highlight the bytes of any field and report the
 * first divergent field when comparing two payloads.
 */

import { isIntegerLexeme, type JsonNode } from "./json.ts";

export type SpanKind =
	| "map"
	| "array"
	| "key"
	| "str"
	| "int"
	| "float"
	| "bool"
	| "nil"
	| "bin";

export interface Span {
	/** JSON-path of the value, e.g. "orders[0].p"; keys use "orders[0].p#key". */
	readonly path: string;
	readonly kind: SpanKind;
	/** Inclusive start offset. */
	readonly start: number;
	/** Exclusive end offset (covers header + payload + children). */
	readonly end: number;
	/** Exclusive end of the type/length header. */
	readonly headerEnd: number;
	readonly depth: number;
}

export interface Encoded {
	readonly bytes: Uint8Array;
	readonly spans: readonly Span[];
}

export class MsgpackEncodeError extends Error {
	readonly path: string;
	constructor(message: string, path: string) {
		super(`${message}${path ? ` at ${path}` : ""}`);
		this.name = "MsgpackEncodeError";
		this.path = path;
	}
}

class Writer {
	private buf = new Uint8Array(256);
	length = 0;
	private ensure(n: number) {
		if (this.length + n <= this.buf.length) return;
		let size = this.buf.length * 2;
		while (size < this.length + n) size *= 2;
		const next = new Uint8Array(size);
		next.set(this.buf.subarray(0, this.length));
		this.buf = next;
	}
	u8(v: number) {
		this.ensure(1);
		this.buf[this.length++] = v & 0xff;
	}
	bytes(b: Uint8Array) {
		this.ensure(b.length);
		this.buf.set(b, this.length);
		this.length += b.length;
	}
	uint(v: bigint, width: 2 | 4 | 8) {
		const out = new Uint8Array(width);
		let x = v;
		for (let k = width - 1; k >= 0; k--) {
			out[k] = Number(x & 0xffn);
			x >>= 8n;
		}
		this.bytes(out);
	}
	f64(v: number) {
		const out = new Uint8Array(8);
		new DataView(out.buffer).setFloat64(0, v, false);
		this.bytes(out);
	}
	result(): Uint8Array {
		return this.buf.slice(0, this.length);
	}
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);

function joinPath(parent: string, key: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(key)
		? parent
			? `${parent}.${key}`
			: key
		: `${parent}[${JSON.stringify(key)}]`;
}

function writeInt(w: Writer, v: bigint, path: string) {
	if (v >= 0n) {
		if (v <= 0x7fn) w.u8(Number(v));
		else if (v <= 0xffn) {
			w.u8(0xcc);
			w.u8(Number(v));
		} else if (v <= 0xffffn) {
			w.u8(0xcd);
			w.uint(v, 2);
		} else if (v <= 0xffffffffn) {
			w.u8(0xce);
			w.uint(v, 4);
		} else if (v <= U64_MAX) {
			w.u8(0xcf);
			w.uint(v, 8);
		} else throw new MsgpackEncodeError(`Integer ${v} exceeds uint64`, path);
		return;
	}
	if (v >= -32n) w.u8(Number(v & 0xffn));
	else if (v >= -0x80n) {
		w.u8(0xd0);
		w.u8(Number(v & 0xffn));
	} else if (v >= -0x8000n) {
		w.u8(0xd1);
		w.uint(v & 0xffffn, 2);
	} else if (v >= -0x80000000n) {
		w.u8(0xd2);
		w.uint(v & 0xffffffffn, 4);
	} else if (v >= I64_MIN) {
		w.u8(0xd3);
		w.uint(v & U64_MAX, 8);
	} else throw new MsgpackEncodeError(`Integer ${v} below int64`, path);
}

function writeStrHeader(w: Writer, len: number) {
	if (len < 32) w.u8(0xa0 | len);
	else if (len <= 0xff) {
		w.u8(0xd9);
		w.u8(len);
	} else if (len <= 0xffff) {
		w.u8(0xda);
		w.uint(BigInt(len), 2);
	} else {
		w.u8(0xdb);
		w.uint(BigInt(len), 4);
	}
}

function writeContainerHeader(w: Writer, len: number, map: boolean) {
	if (len < 16) w.u8((map ? 0x80 : 0x90) | len);
	else if (len <= 0xffff) {
		w.u8(map ? 0xde : 0xdc);
		w.uint(BigInt(len), 2);
	} else {
		w.u8(map ? 0xdf : 0xdd);
		w.uint(BigInt(len), 4);
	}
}

/** Encode a JSON AST to MsgPack, recording a span for every value and key. */
export function encodeMsgpack(node: JsonNode): Encoded {
	const w = new Writer();
	const spans: Span[] = [];
	const rec = (n: JsonNode, path: string, depth: number) => {
		const start = w.length;
		let kind: SpanKind;
		let headerEnd = start;
		switch (n.kind) {
			case "null":
				kind = "nil";
				w.u8(0xc0);
				headerEnd = w.length;
				break;
			case "bool":
				kind = "bool";
				w.u8(n.value ? 0xc3 : 0xc2);
				headerEnd = w.length;
				break;
			case "number":
				if (isIntegerLexeme(n.raw)) {
					kind = "int";
					writeInt(w, BigInt(n.raw), path);
					headerEnd = w.length;
				} else {
					kind = "float";
					const f = Number(n.raw);
					if (!Number.isFinite(f)) {
						throw new MsgpackEncodeError(`Number ${n.raw} is not finite`, path);
					}
					w.u8(0xcb);
					headerEnd = w.length;
					w.f64(f);
				}
				break;
			case "string": {
				kind = "str";
				const b = textEncoder.encode(n.value);
				writeStrHeader(w, b.length);
				headerEnd = w.length;
				w.bytes(b);
				break;
			}
			case "array":
				kind = "array";
				writeContainerHeader(w, n.items.length, false);
				headerEnd = w.length;
				n.items.forEach((item, idx) => {
					rec(item, `${path}[${idx}]`, depth + 1);
				});
				break;
			case "object":
				kind = "map";
				writeContainerHeader(w, n.entries.length, true);
				headerEnd = w.length;
				for (const e of n.entries) {
					const childPath = joinPath(path, e.key);
					const keyStart = w.length;
					const kb = textEncoder.encode(e.key);
					writeStrHeader(w, kb.length);
					const keyHeaderEnd = w.length;
					w.bytes(kb);
					spans.push({
						path: `${childPath}#key`,
						kind: "key",
						start: keyStart,
						end: w.length,
						headerEnd: keyHeaderEnd,
						depth: depth + 1,
					});
					rec(e.value, childPath, depth + 1);
				}
				break;
		}
		spans.push({ path, kind, start, end: w.length, headerEnd, depth });
	};
	rec(node, "", 0);
	spans.sort((a, b) => a.start - b.start || b.end - a.end);
	return { bytes: w.result(), spans };
}

export class MsgpackDecodeError extends Error {
	readonly offset: number;
	constructor(message: string, offset: number) {
		super(`${message} at byte ${offset}`);
		this.name = "MsgpackDecodeError";
		this.offset = offset;
	}
}

export type DecodedValue =
	| { type: "nil" }
	| { type: "bool"; value: boolean }
	| { type: "int"; value: bigint }
	| { type: "float"; value: number; single: boolean }
	| { type: "str"; value: string }
	| { type: "bin"; value: Uint8Array }
	| { type: "ext"; extType: number; value: Uint8Array }
	| { type: "array"; items: DecodedValue[] }
	| { type: "map"; entries: [DecodedValue, DecodedValue][] };

export interface Decoded {
	readonly value: DecodedValue;
	readonly spans: readonly Span[];
}

/** Decode MsgPack bytes (strict: rejects trailing bytes). */
export function decodeMsgpack(bytes: Uint8Array): Decoded {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const spans: Span[] = [];
	let i = 0;
	const need = (n: number) => {
		if (i + n > bytes.length)
			throw new MsgpackDecodeError("Unexpected end of data", i);
	};
	const readUint = (width: number): bigint => {
		need(width);
		let v = 0n;
		for (let k = 0; k < width; k++)
			v = (v << 8n) | BigInt(bytes[i + k] as number);
		i += width;
		return v;
	};
	const readInt = (width: number): bigint => {
		const u = readUint(width);
		const bits = BigInt(width * 8);
		const signBit = 1n << (bits - 1n);
		return u & signBit ? u - (1n << bits) : u;
	};
	const readBytes = (n: number): Uint8Array => {
		need(n);
		const out = bytes.slice(i, i + n);
		i += n;
		return out;
	};
	const rec = (path: string, depth: number, asKey = false): DecodedValue => {
		const start = i;
		need(1);
		const b = bytes[i++] as number;
		let headerEnd = i;
		let value: DecodedValue;
		let kind: SpanKind;
		const str = (len: number): DecodedValue => {
			headerEnd = i;
			const raw = readBytes(len);
			try {
				return { type: "str", value: textDecoder.decode(raw) };
			} catch {
				throw new MsgpackDecodeError("Invalid UTF-8 in string", start);
			}
		};
		const arr = (len: number): DecodedValue => {
			headerEnd = i;
			const items: DecodedValue[] = [];
			for (let k = 0; k < len; k++) items.push(rec(`${path}[${k}]`, depth + 1));
			return { type: "array", items };
		};
		const map = (len: number): DecodedValue => {
			headerEnd = i;
			const entries: [DecodedValue, DecodedValue][] = [];
			for (let k = 0; k < len; k++) {
				const keyStart = i;
				const key = rec("", depth + 1, true);
				const keyName = key.type === "str" ? key.value : `<${key.type}>`;
				const childPath = joinPath(path, keyName);
				spans.push({
					path: `${childPath}#key`,
					kind: "key",
					start: keyStart,
					end: i,
					headerEnd: keyStart + 1,
					depth: depth + 1,
				});
				const val = rec(childPath, depth + 1);
				entries.push([key, val]);
			}
			return { type: "map", entries };
		};
		if (b <= 0x7f) {
			value = { type: "int", value: BigInt(b) };
			kind = "int";
		} else if (b >= 0xe0) {
			value = { type: "int", value: BigInt(b - 0x100) };
			kind = "int";
		} else if ((b & 0xe0) === 0xa0) {
			value = str(b & 0x1f);
			kind = "str";
		} else if ((b & 0xf0) === 0x90) {
			value = arr(b & 0x0f);
			kind = "array";
		} else if ((b & 0xf0) === 0x80) {
			value = map(b & 0x0f);
			kind = "map";
		} else {
			switch (b) {
				case 0xc0:
					value = { type: "nil" };
					kind = "nil";
					break;
				case 0xc2:
				case 0xc3:
					value = { type: "bool", value: b === 0xc3 };
					kind = "bool";
					break;
				case 0xc4:
				case 0xc5:
				case 0xc6: {
					const len = Number(readUint(b === 0xc4 ? 1 : b === 0xc5 ? 2 : 4));
					headerEnd = i;
					value = { type: "bin", value: readBytes(len) };
					kind = "bin";
					break;
				}
				case 0xc7:
				case 0xc8:
				case 0xc9: {
					const len = Number(readUint(b === 0xc7 ? 1 : b === 0xc8 ? 2 : 4));
					need(1);
					const extType = view.getInt8(i++);
					headerEnd = i;
					value = { type: "ext", extType, value: readBytes(len) };
					kind = "bin";
					break;
				}
				case 0xca:
					need(4);
					value = {
						type: "float",
						value: view.getFloat32(i, false),
						single: true,
					};
					headerEnd = i;
					i += 4;
					kind = "float";
					break;
				case 0xcb:
					need(8);
					value = {
						type: "float",
						value: view.getFloat64(i, false),
						single: false,
					};
					headerEnd = i;
					i += 8;
					kind = "float";
					break;
				case 0xcc:
				case 0xcd:
				case 0xce:
				case 0xcf:
					value = { type: "int", value: readUint(1 << (b - 0xcc)) };
					kind = "int";
					break;
				case 0xd0:
				case 0xd1:
				case 0xd2:
				case 0xd3:
					value = { type: "int", value: readInt(1 << (b - 0xd0)) };
					kind = "int";
					break;
				case 0xd4:
				case 0xd5:
				case 0xd6:
				case 0xd7:
				case 0xd8: {
					need(1);
					const extType = view.getInt8(i++);
					headerEnd = i;
					value = { type: "ext", extType, value: readBytes(1 << (b - 0xd4)) };
					kind = "bin";
					break;
				}
				case 0xd9:
				case 0xda:
				case 0xdb:
					value = str(Number(readUint(b === 0xd9 ? 1 : b === 0xda ? 2 : 4)));
					kind = "str";
					break;
				case 0xdc:
				case 0xdd:
					value = arr(Number(readUint(b === 0xdc ? 2 : 4)));
					kind = "array";
					break;
				case 0xde:
				case 0xdf:
					value = map(Number(readUint(b === 0xde ? 2 : 4)));
					kind = "map";
					break;
				default:
					throw new MsgpackDecodeError(
						`Unknown type byte 0x${b.toString(16)}`,
						start,
					);
			}
		}
		if (!asKey) spans.push({ path, kind, start, end: i, headerEnd, depth });
		return value;
	};
	const value = rec("", 0);
	if (i !== bytes.length) {
		throw new MsgpackDecodeError(`${bytes.length - i} trailing bytes`, i);
	}
	spans.sort((a, b) => a.start - b.start || b.end - a.end);
	return { value, spans };
}

/** Convert a decoded value to a JSON AST (bin/ext become hex strings). */
export function decodedToJson(v: DecodedValue): JsonNode {
	const pos = { start: 0, end: 0 };
	switch (v.type) {
		case "nil":
			return { kind: "null", ...pos };
		case "bool":
			return { kind: "bool", value: v.value, ...pos };
		case "int":
			return { kind: "number", raw: v.value.toString(), ...pos };
		case "float": {
			let raw = String(v.value);
			if (!raw.includes(".") && !raw.includes("e")) raw = `${raw}.0`;
			return { kind: "number", raw, ...pos };
		}
		case "str":
			return { kind: "string", value: v.value, ...pos };
		case "bin":
		case "ext":
			return { kind: "string", value: bytesToHex(v.value), ...pos };
		case "array":
			return { kind: "array", items: v.items.map(decodedToJson), ...pos };
		case "map":
			return {
				kind: "object",
				entries: v.entries.map(([k, val]) => ({
					key: k.type === "str" ? k.value : JSON.stringify(decodedToJson(k)),
					keyStart: 0,
					value: decodedToJson(val),
				})),
				...pos,
			};
	}
}

/** Deepest span containing byte `offset`. */
export function spanAt(
	spans: readonly Span[],
	offset: number,
): Span | undefined {
	let best: Span | undefined;
	for (const s of spans) {
		if (offset >= s.start && offset < s.end) {
			if (
				!best ||
				s.depth > best.depth ||
				(s.depth === best.depth && s.kind === "key")
			) {
				best = s;
			}
		}
	}
	return best;
}

export function bytesToHex(bytes: Uint8Array, prefix = true): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return prefix ? `0x${out}` : out;
}

export function hexToBytes(hex: string): Uint8Array {
	let h = hex.trim();
	if (h.startsWith("0x") || h.startsWith("0X")) h = h.slice(2);
	h = h.replace(/[\s_:]/g, "");
	if (h.length % 2 !== 0)
		throw new Error("Hex string has an odd number of digits");
	if (!/^[0-9a-fA-F]*$/.test(h))
		throw new Error("Hex string contains non-hex characters");
	const out = new Uint8Array(h.length / 2);
	for (let k = 0; k < out.length; k++) {
		out[k] = Number.parseInt(h.slice(k * 2, k * 2 + 2), 16);
	}
	return out;
}
