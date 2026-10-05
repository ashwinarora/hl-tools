import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	bytesToHex,
	decodedToJson,
	decodeMsgpack,
	encodeMsgpack,
	firstByteDivergence,
	getEntry,
	hexToBytes,
	inspectAction,
	type JsonNode,
	parseJson,
	parseSignature,
	splitRequestBody,
	stringifyJson,
	toPlain,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsText = readFileSync(
	join(here, "../fixtures/signing/python-sdk-vectors.json"),
	"utf8",
);
// Parse with hl-core's order-preserving parser: key order and big ints matter.
const root = parseJson(vectorsText);
const vectors = (
	getEntry(root, "vectors") as Extract<JsonNode, { kind: "array" }>
).items;
const signer = (
	toPlain(getEntry(root, "signerAddress") as JsonNode) as string
).toLowerCase();

function str(node: JsonNode, key: string): string | null {
	const v = getEntry(node, key);
	return v?.kind === "string" ? v.value : null;
}
function big(node: JsonNode, key: string): bigint | null {
	const v = getEntry(node, key);
	return v?.kind === "number" ? BigInt(v.raw) : null;
}

describe("Python SDK signing vectors", () => {
	expect(vectors.length).toBeGreaterThan(40);
	for (const v of vectors) {
		const name = `${str(v, "name")} [${str(v, "network")}] (${str(v, "source")})`;
		it(name, async () => {
			const action = getEntry(v, "action") as JsonNode;
			const network = str(v, "network") as "mainnet" | "testnet";
			const signature = toPlain(getEntry(v, "signature") as JsonNode);
			const result = await inspectAction({
				action,
				nonce: big(v, "nonce"),
				network,
				vaultAddress: str(v, "vaultAddress"),
				expiresAfter: big(v, "expiresAfter"),
				signature,
				now: Number(big(v, "nonce")),
			});
			expect(result.family).toBe(str(v, "family"));
			if (result.family === "l1") {
				expect(bytesToHex(result.l1?.actionBytes as Uint8Array)).toBe(
					str(v, "msgpackHex"),
				);
				expect(result.l1?.connectionId).toBe(str(v, "connectionId"));
			} else {
				expect(result.typedData?.primaryType).toBe(str(v, "primaryType"));
			}
			expect(result.hashes?.digest).toBe(str(v, "digest"));
			expect(result.recovered).toBe(signer);
		});
	}
});

describe("msgpack codec", () => {
	it("round-trips every vector action and matches spans", () => {
		for (const v of vectors) {
			const action = getEntry(v, "action") as JsonNode;
			const { bytes, spans } = encodeMsgpack(action);
			const decoded = decodeMsgpack(bytes);
			expect(stringifyJson(decodedToJson(decoded.value))).toBe(
				stringifyJson(action),
			);
			expect(decoded.spans.map((s) => [s.path, s.start, s.end])).toEqual(
				spans.map((s) => [s.path, s.start, s.end]),
			);
		}
	});

	it("uses the smallest int formats Python msgpack uses", () => {
		const cases: [string, string][] = [
			["0", "0x00"],
			["127", "0x7f"],
			["128", "0xcc80"],
			["256", "0xcd0100"],
			["65536", "0xce00010000"],
			["4294967296", "0xcf0000000100000000"],
			["-1", "0xff"],
			["-32", "0xe0"],
			["-33", "0xd0df"],
			["-129", "0xd1ff7f"],
			["-32769", "0xd2ffff7fff"],
			["-2147483649", "0xd3ffffffff7fffffff"],
			["1.5", "0xcb3ff8000000000000"],
			["1.0", "0xcb3ff0000000000000"],
		];
		for (const [lexeme, hex] of cases) {
			expect(bytesToHex(encodeMsgpack(parseJson(lexeme)).bytes)).toBe(hex);
		}
	});

	it("rejects trailing bytes and truncated input", () => {
		expect(() => decodeMsgpack(hexToBytes("0x0000"))).toThrow(/trailing/);
		expect(() => decodeMsgpack(hexToBytes("0xa5616263"))).toThrow(
			/end of data/,
		);
	});
});

describe("order-preserving JSON", () => {
	it("keeps integer-like keys in source order (JSON.parse does not)", () => {
		const text = '{"b":1,"1":2}';
		expect(Object.keys(JSON.parse(text))).toEqual(["1", "b"]);
		const node = parseJson(text);
		expect(node.kind === "object" && node.entries.map((e) => e.key)).toEqual([
			"b",
			"1",
		]);
	});
	it("keeps 1.0 distinct from 1", () => {
		const a = encodeMsgpack(parseJson('{"x":1}')).bytes;
		const b = encodeMsgpack(parseJson('{"x":1.0}')).bytes;
		const div = firstByteDivergence(
			a,
			b,
			encodeMsgpack(parseJson('{"x":1}')).spans,
			encodeMsgpack(parseJson('{"x":1.0}')).spans,
		);
		expect(div?.offset).toBe(3);
		expect(div?.pathA).toBe("x");
	});
	it("rejects duplicate keys and trailing commas with positions", () => {
		expect(() => parseJson('{"a":1,"a":2}')).toThrow(/Duplicate key "a"/);
		expect(() => parseJson("[1,2,]")).toThrow(
			/Trailing comma at line 1, column 5/,
		);
		expect(() => parseJson("{'a':1}")).toThrow(/Expected a double-quoted key/);
	});
});

describe("inspectAction diagnostics", () => {
	const nonce = 1790000000000n;
	const run = (
		text: string,
		extra: Partial<Parameters<typeof inspectAction>[0]> = {},
	) =>
		inspectAction({
			action: parseJson(text),
			nonce,
			network: "mainnet",
			now: Number(nonce),
			...extra,
		});

	it("flags trailing zeros, uppercase addresses and key order", async () => {
		const r = await run(
			'{"type":"order","orders":[{"b":true,"a":0,"p":"100.0","s":"1","r":false,"t":{"limit":{"tif":"Gtc"}}}],"grouping":"na","builder":{"b":"0x8C967E73E7B15087C42A10D344CFF4C96D877F1D","f":10}}',
		);
		const codes = r.issues.map((i) => i.code);
		expect(codes).toContain("field.order");
		expect(codes).toContain("decimal.not_canonical");
		expect(codes).toContain("address.uppercase");
		expect(r.l1?.canonicalChanged).toBe(true);
	});

	it("rejects cancel f:false", async () => {
		const r = await run(
			'{"type":"cancel","cancels":[{"a":0,"o":1}],"f":false}',
		);
		expect(r.issues.map((i) => i.code)).toContain("field.must_omit");
	});

	it("never silently crosses networks for user-signed actions", async () => {
		const r = await run(
			'{"type":"usdSend","signatureChainId":"0x66eee","hyperliquidChain":"Testnet","destination":"0x5e9ee1089755c3435139848e47e6635505d5a13a","amount":"1","time":1790000000000}',
		);
		expect(r.issues.find((i) => i.code === "network.mismatch")?.severity).toBe(
			"error",
		);
	});

	it("reports multisig as out of scope", async () => {
		const r = await run('{"type":"multiSig","signatureChainId":"0x66eee"}');
		expect(r.family).toBe("multisig");
	});

	it("accepts a whole request body", () => {
		const parts = splitRequestBody(
			parseJson(
				'{"action":{"type":"noop"},"nonce":5,"signature":{"r":"0x1","s":"0x2","v":27},"vaultAddress":null}',
			),
		);
		expect(parts.isEnvelope).toBe(true);
		expect(parts.nonce).toBe(5n);
		expect(parts.vaultAddress).toBeNull();
	});

	it("pads short r/s like the Python SDK emits", () => {
		const sig = parseSignature({
			r: "0x53749d5b30552aeb2fca34b530185976545bb22d0b3ce6f62e31be961a59298",
			s: "0x755c40ba9bf05223521753995abb2f73ab3229be8ec921f350cb447e384d8ed8",
			v: 27,
		});
		expect(sig.r).toBe(
			"0x053749d5b30552aeb2fca34b530185976545bb22d0b3ce6f62e31be961a59298",
		);
		expect(() => parseSignature("0x1234")).toThrow(/65 bytes/);
		expect(() => parseSignature({ r: "0x1", s: "0x1", v: 29 })).toThrow(
			/27 or 28/,
		);
	});
});

describe("signing samples", () => {
	it("every built-in sample recovers the SDK test signer", async () => {
		const { SIGNING_SAMPLES } = await import("../src/samples/signing.ts");
		expect(SIGNING_SAMPLES.length).toBeGreaterThanOrEqual(5);
		for (const s of SIGNING_SAMPLES) {
			const parts = splitRequestBody(parseJson(s.requestBody));
			const r = await inspectAction({
				action: parts.action,
				nonce: parts.nonce ?? null,
				network: s.network,
				vaultAddress: parts.vaultAddress,
				expiresAfter: parts.expiresAfter,
				signature: parts.signature,
				now: Number(parts.nonce),
			});
			expect(r.hashes?.digest, s.id).toBe(s.digest);
			expect(r.recovered, s.id).toBe(s.expectedSigner);
		}
	});
});
