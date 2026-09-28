/**
 * Order- and lexeme-preserving JSON.
 *
 * `JSON.parse` is lossy for signing purposes: it reorders integer-like object
 * keys, collapses `1.0` into `1` (msgpack would encode an int instead of a
 * float64) and silently truncates integers above 2^53. MsgPack hashing depends
 * on all three, so the Signing Inspector parses pasted payloads with this
 * parser, which keeps key order, raw number lexemes and source offsets.
 */

export type JsonNode =
	| JsonObject
	| JsonArray
	| JsonString
	| JsonNumber
	| JsonBool
	| JsonNull;

interface Positioned {
	readonly start: number;
	readonly end: number;
}

export interface JsonEntry {
	readonly key: string;
	readonly keyStart: number;
	readonly value: JsonNode;
}

export interface JsonObject extends Positioned {
	readonly kind: "object";
	readonly entries: readonly JsonEntry[];
}
export interface JsonArray extends Positioned {
	readonly kind: "array";
	readonly items: readonly JsonNode[];
}
export interface JsonString extends Positioned {
	readonly kind: "string";
	readonly value: string;
}
export interface JsonNumber extends Positioned {
	readonly kind: "number";
	/** Exact source lexeme, e.g. "1.0", "-0", "1e3". */
	readonly raw: string;
}
export interface JsonBool extends Positioned {
	readonly kind: "bool";
	readonly value: boolean;
}
export interface JsonNull extends Positioned {
	readonly kind: "null";
}

export class JsonParseError extends Error {
	readonly offset: number;
	readonly line: number;
	readonly column: number;
	constructor(message: string, source: string, offset: number) {
		const before = source.slice(0, offset);
		const line = before.split("\n").length;
		const column = offset - before.lastIndexOf("\n");
		super(`${message} at line ${line}, column ${column}`);
		this.name = "JsonParseError";
		this.offset = offset;
		this.line = line;
		this.column = column;
	}
}

export interface ParseOptions {
	/** Reject duplicate keys (default true — duplicates make hashes ambiguous). */
	readonly rejectDuplicateKeys?: boolean;
}

export function parseJson(
	source: string,
	options: ParseOptions = {},
): JsonNode {
	const rejectDup = options.rejectDuplicateKeys ?? true;
	let i = 0;
	const fail = (msg: string, at = i): never => {
		throw new JsonParseError(msg, source, at);
	};
	const ws = () => {
		while (i < source.length) {
			const c = source.charCodeAt(i);
			if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
			else break;
		}
	};
	const value = (): JsonNode => {
		ws();
		const c = source[i];
		if (c === "{") return object();
		if (c === "[") return array();
		if (c === '"') return string();
		if (c === "t") return literal("true", { kind: "bool", value: true });
		if (c === "f") return literal("false", { kind: "bool", value: false });
		if (c === "n") return literal("null", { kind: "null" });
		if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return number();
		if (c === undefined) return fail("Unexpected end of input");
		if (c === "'") return fail("Strings must use double quotes");
		return fail(`Unexpected character '${c}'`);
	};
	const literal = (
		word: string,
		node: { kind: "bool"; value: boolean } | { kind: "null" },
	): JsonBool | JsonNull => {
		const start = i;
		if (source.slice(i, i + word.length) !== word) {
			fail(`Expected '${word}'`);
		}
		i += word.length;
		return { ...node, start, end: i };
	};
	const number = (): JsonNumber => {
		const start = i;
		const re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
		re.lastIndex = i;
		const m = re.exec(source);
		if (!m) return fail("Invalid number");
		i += m[0].length;
		return { kind: "number", raw: m[0], start, end: i };
	};
	const string = (): JsonString => {
		const start = i;
		i++; // opening quote
		let out = "";
		while (true) {
			if (i >= source.length) fail("Unterminated string", start);
			const c = source[i] as string;
			if (c === '"') {
				i++;
				break;
			}
			if (c === "\\") {
				const n = source[i + 1];
				i += 2;
				switch (n) {
					case '"':
						out += '"';
						break;
					case "\\":
						out += "\\";
						break;
					case "/":
						out += "/";
						break;
					case "b":
						out += "\b";
						break;
					case "f":
						out += "\f";
						break;
					case "n":
						out += "\n";
						break;
					case "r":
						out += "\r";
						break;
					case "t":
						out += "\t";
						break;
					case "u": {
						const hex = source.slice(i, i + 4);
						if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid \\u escape");
						out += String.fromCharCode(Number.parseInt(hex, 16));
						i += 4;
						break;
					}
					default:
						fail("Invalid escape", i - 1);
				}
				continue;
			}
			if (c.charCodeAt(0) < 0x20) fail("Control character in string");
			out += c;
			i++;
		}
		return { kind: "string", value: out, start, end: i };
	};
	const object = (): JsonObject => {
		const start = i;
		i++;
		const entries: JsonEntry[] = [];
		const seen = new Set<string>();
		ws();
		if (source[i] === "}") {
			i++;
			return { kind: "object", entries, start, end: i };
		}
		while (true) {
			ws();
			if (source[i] !== '"') fail("Expected a double-quoted key");
			const keyStart = i;
			const key = string().value;
			if (rejectDup && seen.has(key)) fail(`Duplicate key "${key}"`, keyStart);
			seen.add(key);
			ws();
			if (source[i] !== ":") fail("Expected ':'");
			i++;
			const v = value();
			entries.push({ key, keyStart, value: v });
			ws();
			if (source[i] === ",") {
				const comma = i;
				i++;
				ws();
				if (source[i] === "}") fail("Trailing comma", comma);
				continue;
			}
			if (source[i] === "}") {
				i++;
				break;
			}
			fail("Expected ',' or '}'");
		}
		return { kind: "object", entries, start, end: i };
	};
	const array = (): JsonArray => {
		const start = i;
		i++;
		const items: JsonNode[] = [];
		ws();
		if (source[i] === "]") {
			i++;
			return { kind: "array", items, start, end: i };
		}
		while (true) {
			items.push(value());
			ws();
			if (source[i] === ",") {
				const comma = i;
				i++;
				ws();
				if (source[i] === "]") fail("Trailing comma", comma);
				continue;
			}
			if (source[i] === "]") {
				i++;
				break;
			}
			fail("Expected ',' or ']'");
		}
		return { kind: "array", items, start, end: i };
	};
	const root = value();
	ws();
	if (i < source.length) fail("Unexpected trailing content");
	return root;
}

export function tryParseJson(
	source: string,
	options?: ParseOptions,
): { ok: true; node: JsonNode } | { ok: false; error: JsonParseError } {
	try {
		return { ok: true, node: parseJson(source, options) };
	} catch (e) {
		if (e instanceof JsonParseError) return { ok: false, error: e };
		throw e;
	}
}

/** True if a number lexeme denotes an integer (no fraction/exponent). */
export function isIntegerLexeme(raw: string): boolean {
	return /^-?(0|[1-9]\d*)$/.test(raw);
}

export type PlainJson =
	| string
	| number
	| bigint
	| boolean
	| null
	| PlainJson[]
	| { [key: string]: PlainJson };

/**
 * Convert to plain JS. Integers outside the safe range become bigint so no
 * precision is lost; non-integers become numbers.
 */
export function toPlain(node: JsonNode): PlainJson {
	switch (node.kind) {
		case "object": {
			const out: { [key: string]: PlainJson } = {};
			for (const e of node.entries) out[e.key] = toPlain(e.value);
			return out;
		}
		case "array":
			return node.items.map(toPlain);
		case "string":
			return node.value;
		case "bool":
			return node.value;
		case "null":
			return null;
		case "number": {
			if (isIntegerLexeme(node.raw)) {
				const big = BigInt(node.raw);
				return big >= BigInt(Number.MIN_SAFE_INTEGER) &&
					big <= BigInt(Number.MAX_SAFE_INTEGER)
					? Number(big)
					: big;
			}
			return Number(node.raw);
		}
	}
}

/**
 * Build an AST from a plain JS value (insertion order preserved; integer
 * numbers and bigints become integer lexemes). Floats are rejected unless
 * `allowFloats` — protocol numbers belong in strings.
 */
export function fromPlain(value: unknown, allowFloats = false): JsonNode {
	const pos = { start: 0, end: 0 };
	if (value === null) return { kind: "null", ...pos };
	if (typeof value === "boolean") return { kind: "bool", value, ...pos };
	if (typeof value === "string") return { kind: "string", value, ...pos };
	if (typeof value === "bigint")
		return { kind: "number", raw: value.toString(), ...pos };
	if (typeof value === "number") {
		if (Number.isInteger(value)) {
			return { kind: "number", raw: BigInt(value).toString(), ...pos };
		}
		if (!allowFloats) {
			throw new TypeError(
				`Refusing float ${value}; protocol numbers must be strings`,
			);
		}
		return { kind: "number", raw: String(value), ...pos };
	}
	if (Array.isArray(value)) {
		return {
			kind: "array",
			items: value.map((v) => fromPlain(v, allowFloats)),
			...pos,
		};
	}
	if (typeof value === "object") {
		const entries: JsonEntry[] = [];
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			if (v === undefined) continue;
			entries.push({ key, keyStart: 0, value: fromPlain(v, allowFloats) });
		}
		return { kind: "object", entries, ...pos };
	}
	throw new TypeError(`Unsupported JSON value of type ${typeof value}`);
}

/** Serialise an AST back to JSON text (preserving order and lexemes). */
export function stringifyJson(node: JsonNode, indent = 2): string {
	const pad = (depth: number) => (indent > 0 ? " ".repeat(indent * depth) : "");
	const nl = indent > 0 ? "\n" : "";
	const sep = indent > 0 ? ": " : ":";
	const rec = (n: JsonNode, depth: number): string => {
		switch (n.kind) {
			case "object":
				if (n.entries.length === 0) return "{}";
				return `{${nl}${n.entries
					.map(
						(e) =>
							`${pad(depth + 1)}${JSON.stringify(e.key)}${sep}${rec(e.value, depth + 1)}`,
					)
					.join(`,${nl}`)}${nl}${pad(depth)}}`;
			case "array":
				if (n.items.length === 0) return "[]";
				return `[${nl}${n.items.map((it) => `${pad(depth + 1)}${rec(it, depth + 1)}`).join(`,${nl}`)}${nl}${pad(depth)}]`;
			case "string":
				return JSON.stringify(n.value);
			case "number":
				return n.raw;
			case "bool":
				return n.value ? "true" : "false";
			case "null":
				return "null";
		}
	};
	return rec(node, 0);
}

/** Look up a key in an object node. */
export function getEntry(node: JsonNode, key: string): JsonNode | undefined {
	if (node.kind !== "object") return undefined;
	return node.entries.find((e) => e.key === key)?.value;
}

export function getString(node: JsonNode, key: string): string | undefined {
	const v = getEntry(node, key);
	return v?.kind === "string" ? v.value : undefined;
}

/** Return a copy of an object node without the given keys. */
export function omitKeys(
	node: JsonObject,
	keys: readonly string[],
): JsonObject {
	return {
		...node,
		entries: node.entries.filter((e) => !keys.includes(e.key)),
	};
}
