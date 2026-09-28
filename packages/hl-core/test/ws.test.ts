import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildSubscription,
	diffChannelState,
	isAckFor,
	isSnapshotMessage,
	parseSessionFile,
	reduceChannel,
	SESSION_LIMITS,
	SessionRecorder,
	sanitizeSession,
	summarizeMessage,
	WS_CHANNELS,
	type WsChannelSpec,
	wsChannel,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const loadText = (p: string) =>
	readFileSync(join(here, "..", "fixtures", p), "utf8");
const ch = (t: string) => wsChannel(t) as WsChannelSpec;

describe("subscriptions", () => {
	it("builds valid messages and lowercases users", () => {
		expect(buildSubscription(ch("l2Book"), { coin: "BTC" }).message).toEqual({
			method: "subscribe",
			subscription: { type: "l2Book", coin: "BTC" },
		});
		expect(
			buildSubscription(ch("userFills"), {
				user: "0xABCDEF0123456789abcdef0123456789ABCDEF01",
				aggregateByTime: "true",
			}).subscription,
		).toEqual({
			type: "userFills",
			user: "0xabcdef0123456789abcdef0123456789abcdef01",
			aggregateByTime: true,
		});
		expect(buildSubscription(ch("allMids"), {}).subscription).toEqual({
			type: "allMids",
		});
	});
	it("rejects malformed parameters", () => {
		expect(buildSubscription(ch("l2Book"), {}).issues[0]?.code).toBe(
			"ws.param.missing",
		);
		expect(
			buildSubscription(ch("candle"), { coin: "BTC", interval: "7m" }).issues[0]
				?.code,
		).toBe("ws.param.interval");
		expect(
			buildSubscription(ch("userFills"), { user: "0x123" }).issues[0]?.code,
		).toBe("ws.param.user");
		expect(
			buildSubscription(ch("l2Book"), {
				coin: "BTC",
				nSigFigs: "4",
				mantissa: "2",
			}).issues.map((i) => i.code),
		).toContain("ws.param.mantissa");
	});
	it("every channel has a documented ordering statement", () => {
		for (const c of WS_CHANNELS) expect(c.ordering).toMatch(/sequence/i);
	});
});

describe("recorded sessions", () => {
	for (const name of ["mainnet-btc-l2book", "mainnet-btc-trades"]) {
		it(`${name}: parses, acks, reduces and is sanitised`, () => {
			const parsed = parseSessionFile(loadText(`ws/${name}.json`));
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) return;
			const f = parsed.file;
			expect(f.sanitized).toBe(true);
			const spec = ch(f.channel);
			const ins = f.messages
				.filter((m) => m.dir === "in")
				.map((m) => JSON.parse(m.text) as { channel: string; data: unknown });
			expect(isAckFor(ins[0], f.subscription)).toBe(true);
			let state = {};
			const data = ins.filter((m) => m.channel === spec.channel);
			expect(isSnapshotMessage(spec, data[0]?.data, true)).toBe(true);
			for (const m of data) state = reduceChannel(spec, state, m.data);
			expect(Object.keys(state).length).toBeGreaterThan(0);
			expect(summarizeMessage(spec.channel, data[0]?.data)).not.toBe("");
			// No real addresses survive sanitisation (pseudonyms start with 28 zero nibbles).
			for (const m of f.messages)
				for (const a of m.text.match(/0x[0-9a-fA-F]{40}/g) ?? [])
					expect(a.startsWith(`0x${"0".repeat(28)}`)).toBe(true);
		});
	}
	it("dedupes trades by (time, tid) and diffs state", () => {
		const spec = ch("trades");
		const t = [{ time: 1, tid: 5, side: "B", px: "1", sz: "1" }];
		const s1 = reduceChannel(spec, {}, t);
		const s2 = reduceChannel(spec, s1, t);
		expect(Object.keys(s2)).toHaveLength(1);
		const s3 = reduceChannel(spec, s2, [
			{ time: 2, tid: 6, side: "A", px: "2", sz: "1" },
		]);
		const d = diffChannelState(s1, s3);
		expect(d.added).toEqual(["2:6"]);
		expect(d.unchanged).toBe(1);
	});
});

describe("session files", () => {
	it("pseudonymises addresses consistently", () => {
		const rec = new SessionRecorder(
			"mainnet",
			"wss://x",
			"userFills",
			{ type: "userFills", user: "0xAbCdEf0123456789abcdef0123456789abcdef01" },
			0,
		);
		rec.push(
			"in",
			'{"data":{"user":"0xabcdef0123456789abcdef0123456789abcdef01","other":"0x1111111111111111111111111111111111111111"}}',
			5,
		);
		const s = sanitizeSession(rec.toFile(10));
		expect(s.subscription.user).toBe(`0x${"0".repeat(32)}00000001`);
		expect(s.messages[0]?.text).toContain(`0x${"0".repeat(32)}00000001`);
		expect(s.messages[0]?.text).toContain(`0x${"0".repeat(32)}00000002`);
	});
	it("stops recording at the bound", () => {
		const rec = new SessionRecorder(
			"mainnet",
			"wss://x",
			"trades",
			{ type: "trades" },
			0,
		);
		for (let i = 0; i < SESSION_LIMITS.maxMessages + 10; i++)
			rec.push("in", "{}", i);
		expect(rec.size.messages).toBe(SESSION_LIMITS.maxMessages);
		expect(rec.toFile().truncated).toBe(true);
	});
	it("rejects malformed files with a reason", () => {
		expect(parseSessionFile("nope")).toMatchObject({ ok: false });
		expect(parseSessionFile('{"format":"x"}')).toMatchObject({
			ok: false,
			error: expect.stringContaining("Unknown format"),
		});
		const base = {
			format: "hl-tools.ws-session",
			version: 1,
			network: "mainnet",
			channel: "trades",
			subscription: { type: "trades" },
		};
		expect(
			parseSessionFile(
				JSON.stringify({
					...base,
					messages: [
						{ t: 5, dir: "in", text: "" },
						{ t: 1, dir: "in", text: "" },
					],
				}),
			),
		).toMatchObject({
			ok: false,
			error: expect.stringContaining("out of order"),
		});
		expect(
			parseSessionFile(
				JSON.stringify({ ...base, network: "devnet", messages: [] }),
			),
		).toMatchObject({ ok: false });
	});
});
