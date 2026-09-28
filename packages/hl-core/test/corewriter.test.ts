import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildUniverse,
	COREWRITER_ACTIONS,
	coreWriterSnippets,
	decodeCoreWriterAction,
	decodePrecompileOutput,
	encodeCoreWriterAction,
	encodePrecompileInput,
	type InfoExchange,
	type Network,
	PRECOMPILES,
	type RawMetadata,
	type RpcExchange,
	traceTransaction,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) =>
	JSON.parse(readFileSync(join(here, "..", "fixtures", p), "utf8"));
const universes = {
	mainnet: buildUniverse(
		"mainnet",
		load("metadata/mainnet.json") as RawMetadata,
	),
	testnet: buildUniverse(
		"testnet",
		load("metadata/testnet.json") as RawMetadata,
	),
};

interface Case {
	name: string;
	network: Network;
	hex: string;
	kind: string;
	action?: string;
	fields?: Record<string, [string, string]>;
	issueCodes?: string[];
}

describe("CoreWriter decode fixtures", () => {
	for (const c of (load("corewriter/cases.json") as { cases: Case[] }).cases) {
		it(c.name, () => {
			const r = decodeCoreWriterAction(c.hex, {
				universe: universes[c.network],
			});
			expect(r.kind).toBe(c.kind);
			for (const code of c.issueCodes ?? [])
				expect(r.issues.map((i) => i.code)).toContain(code);
			if (r.kind !== "decoded") return;
			if (c.action) expect(r.spec.key).toBe(c.action);
			for (const [name, [raw, human]] of Object.entries(c.fields ?? {})) {
				const f = r.fields.find((x) => x.field.name === name);
				expect(f?.rawDisplay, name).toBe(raw);
				expect(f?.human ?? f?.rawDisplay, name).toBe(human);
			}
		});
	}
});

describe("CoreWriter encode", () => {
	const sample: Record<string, string> = {
		asset: "1",
		isBuy: "true",
		limitPx: "2667.1",
		sz: "0.005",
		reduceOnly: "false",
		encodedTif: "Ioc",
		cloid: "0x000001a0e798df33f294ce1e316c6981",
		vault: "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303",
		isDeposit: "true",
		usd: "5",
		validator: "0x5ac99df645f3414876c816caa18b2d234024b487",
		wei: "100000000",
		isUndelegate: "false",
		destination: "0x5e9ee1089755c3435139848e47e6635505d5a13a",
		token: "0",
		ntl: "10",
		toPerp: "false",
		encodedFinalizeEvmContractVariant: "Create",
		createNonce: "0",
		apiWallet: "0x9f5c1a0e1b40e1e7a8ab4f4c8b48d6c6b1ee3a0b",
		apiWalletName: "bot",
		oid: "123",
		maxFeeRate: "10",
		builder: "0x8c967e73e7b15087c42a10d344cff4c96d877f1d",
		subAccount: "0x0000000000000000000000000000000000000000",
		sourceDex: "0",
		destinationDex: "spot",
		encodedOperation: "0",
		user: "0x5e9ee1089755c3435139848e47e6635505d5a13a",
		abstraction: "unifiedAccount",
		question: "0",
		outcome: "1",
	};
	for (const spec of COREWRITER_ACTIONS) {
		it(`round-trips ${spec.key}`, () => {
			const enc = encodeCoreWriterAction(spec.key, sample, {
				universe: universes.mainnet,
			});
			expect(
				enc.issues.filter((i) => i.severity === "error"),
				JSON.stringify(enc.issues),
			).toEqual([]);
			const dec = decodeCoreWriterAction(enc.hex as string, {
				universe: universes.mainnet,
			});
			expect(dec.kind).toBe("decoded");
			if (dec.kind === "decoded") expect(dec.spec.id).toBe(spec.id);
		});
	}
	it("reproduces the real mainnet limit order bytes from human inputs", () => {
		const real = (load("corewriter/cases.json") as { cases: Case[] }).cases[0]
			?.hex;
		const enc = encodeCoreWriterAction("limitOrder", sample, {
			universe: universes.mainnet,
		});
		expect(enc.hex).toBe(real);
	});
	it("refuses inexact fixed-point input instead of rounding", () => {
		const enc = encodeCoreWriterAction("limitOrder", {
			...sample,
			limitPx: "2667.123456789",
		});
		expect(enc.hex).toBeNull();
		expect(enc.issues[0]?.message).toMatch(/cannot be encoded exactly/);
	});
	it("builds cast and Solidity snippets", () => {
		const enc = encodeCoreWriterAction("usdClassTransfer", sample);
		const spec = COREWRITER_ACTIONS.find((s) => s.key === "usdClassTransfer");
		if (!spec || !enc.hex) throw new Error("setup");
		const s = coreWriterSnippets(
			spec,
			enc.values,
			enc.hex,
			"https://rpc.hyperliquid.xyz/evm",
			"0xc88ce9398899f95cfcbe6a4c9f7f188fde51ad60",
		);
		expect(s.calldata.startsWith("0x17938e13")).toBe(true);
		expect(s.castCall).toContain(
			"--from 0xc88ce9398899f95cfcbe6a4c9f7f188fde51ad60",
		);
		expect(s.castSend).not.toMatch(/private-key/);
		expect(s.solidity).toContain(
			"uint24 constant USD_CLASS_TRANSFER_ACTION = 7;",
		);
	});
});

describe("precompile codec", () => {
	it("encodes inputs and decodes a recorded output (BTC oracle price)", () => {
		const spec = PRECOMPILES.find((p) => p.key === "oraclePx");
		if (!spec) throw new Error("no spec");
		expect(encodePrecompileInput(spec, { perp: "0" }).data).toBe(
			`0x${"0".repeat(64)}`,
		);
		const d = decodePrecompileOutput(
			spec,
			"0x00000000000000000000000000000000000000000000000000000000000ca7c4",
			{ perpSzDecimals: 5 },
		);
		expect(d.kind === "tuple" && d.values[0]?.human).toBe("82938");
	});
	it("decodes a dynamic struct (perpAssetInfo) and rejects garbage", () => {
		const spec = PRECOMPILES.find((p) => p.key === "l1BlockNumber");
		if (!spec) throw new Error("no spec");
		expect(encodePrecompileInput(spec, {}).data).toBe("0x");
		expect(decodePrecompileOutput(spec, "0x1234").kind).toBe("error");
		const pai = PRECOMPILES.find((p) => p.key === "perpAssetInfo");
		if (!pai) throw new Error("no spec");
		expect(encodePrecompileInput(pai, { perp: "abc" }).issues[0]?.code).toBe(
			"precompile.input",
		);
	});
});

function replay(name: string) {
	const f = load(`trace/${name}.json`) as {
		network: Network;
		tx: string;
		rpc: Record<string, unknown>;
		info: Record<string, unknown>;
	};
	const rpc = async (m: string, p: unknown[]): Promise<RpcExchange> => {
		const key = JSON.stringify([m, p]);
		if (!(key in f.rpc)) throw new Error(`no recorded rpc for ${key}`);
		return {
			request: { jsonrpc: "2.0", id: 1, method: m, params: p },
			response: null,
			result: f.rpc[key],
			failure: null,
			durationMs: 0,
			startedAt: 0,
		};
	};
	const info = async (body: Record<string, unknown>): Promise<InfoExchange> => {
		const key = JSON.stringify(body);
		if (!(key in f.info)) throw new Error(`no recorded info for ${key}`);
		return { body, response: f.info[key], error: null };
	};
	return { f, rpc, info };
}

describe("trace replays (recorded from live networks)", () => {
	it("mainnet limit order: observed via cloid, fields match, filled", async () => {
		const { f, rpc, info } = replay("mainnet-limit-order");
		const t = await traceTransaction(f.network, f.tx, {
			rpc,
			info,
			universe: universes.mainnet,
		});
		expect(t.kind).toBe("ok");
		if (t.kind !== "ok") return;
		expect(t.receipt.status).toBe("success");
		const a = t.actions[0];
		expect(a?.decode.kind).toBe("decoded");
		expect(a?.observed?.evidence).toBe("observed");
		expect(a?.observed?.comparisons.every((c) => c.match)).toBe(true);
		expect(a?.observed?.headline).toMatch(/filled/);
		expect(a?.findings[0]?.title).toMatch(/existed/);
	});
	it("mainnet usdClassTransfer: observed in the ledger with the same amount", async () => {
		const { f, rpc, info } = replay("mainnet-usd-class-transfer");
		const t = await traceTransaction(f.network, f.tx, {
			rpc,
			info,
			universe: universes.mainnet,
		});
		if (t.kind !== "ok") throw new Error(t.kind);
		expect(t.actions[0]?.observed?.evidence).toBe("observed");
		expect(t.actions[0]?.observed?.headline).toContain("10.0 USDC perp → spot");
		expect(t.actions[0]?.observed?.l1Hash).toMatch(/^0x[0-9a-f]{64}$/);
	});
	it("testnet limit order without cloid is matched by inference", async () => {
		const { f, rpc, info } = replay("testnet-limit-order");
		const t = await traceTransaction(f.network, f.tx, {
			rpc,
			info,
			universe: universes.testnet,
		});
		if (t.kind !== "ok") throw new Error(t.kind);
		expect(["inferred", "observed"]).toContain(
			t.actions[0]?.observed?.evidence,
		);
	});
	it("unsupported actions decode but are not traced", async () => {
		const { f, rpc, info } = replay("testnet-cancel");
		const t = await traceTransaction(f.network, f.tx, {
			rpc,
			info,
			universe: universes.testnet,
		});
		if (t.kind !== "ok") throw new Error(t.kind);
		expect(t.actions[0]?.supported).toBe(false);
		expect(t.actions[0]?.decode.kind).toBe("decoded");
	});
	it("flags a sender with no HyperCore history (silent rejection)", async () => {
		const { f, rpc, info } = replay("mainnet-usd-class-transfer");
		const t = await traceTransaction(f.network, f.tx, {
			rpc,
			info: async (body) =>
				body.startTime === 0 ? { body, response: [], error: null } : info(body),
			universe: universes.mainnet,
		});
		if (t.kind !== "ok") throw new Error(t.kind);
		expect(
			t.actions[0]?.findings.some(
				(x) =>
					x.title.includes("no HyperCore ledger history") && x.tone === "bad",
			),
		).toBe(true);
	});
	it("reports not-found and checks the other network without switching", async () => {
		const t = await traceTransaction("testnet", `0x${"ab".repeat(32)}`, {
			rpc: async (m, p) => ({
				request: { jsonrpc: "2.0", id: 1, method: m, params: p },
				response: null,
				result: null,
				failure: null,
				durationMs: 0,
				startedAt: 0,
			}),
			otherRpc: async (m, p) => ({
				request: { jsonrpc: "2.0", id: 1, method: m, params: p },
				response: null,
				result: { status: "0x1" },
				failure: null,
				durationMs: 0,
				startedAt: 0,
			}),
			info: async (body) => ({ body, response: null, error: null }),
		});
		expect(t.kind).toBe("not-found");
		if (t.kind === "not-found") expect(t.foundOnOtherNetwork).toBe(true);
	});
});
