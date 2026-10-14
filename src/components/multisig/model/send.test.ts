import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	accountMode,
	explainExchangeError,
	type PlainObject,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { RECIPIENT, TREASURY } from "#/test/keys";
import type { Receiver } from "./actions";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import {
	costLine,
	largerOf,
	modeRefusal,
	preflight,
	receiverOf,
	receiverRecheckMs,
	type SendFacts,
	sendsBefore,
	sendsFirstLine,
	spotAvailable,
	standingRefusals,
	TO_HYPEREVM,
} from "./send";

const USDC = "USDC:0xeb62eee3685fc4c43992febcd9e75443";
const PURR = "PURR:0xc4bf3f870c0e9465323c0b6ed28096c2";
const MANUAL = accountMode("default");
const UNIFIED = accountMode("unifiedAccount");
const asset = (
	sourceDex: string,
	destinationDex: string,
	amount = "5",
	token = USDC,
): PlainObject => ({
	type: "sendAsset",
	destination: RECIPIENT,
	sourceDex,
	destinationDex,
	token,
	amount,
	fromSubAccount: "",
	nonce: 1_791_000_000_000,
});
const usdSend = (amount = "5", time = 1_791_000_000_000): PlainObject => ({
	type: "usdSend",
	destination: RECIPIENT,
	amount,
	time,
});
const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
	mode: MANUAL,
	perpsUsdc: "100",
	spot: [{ coin: "USDC", total: "100", hold: "0" }],
	receiver: { status: "active", mode: MANUAL },
	...over,
});
const codes = (action: PlainObject, f: SendFacts) =>
	preflight(action, f).map((r) => r.code);
const FRESH: Receiver = { status: "new", mode: MANUAL };

describe("spotAvailable", () => {
	it("is the total less what is held", () => {
		const spot = [
			{ coin: "USDC", total: "23.714386", hold: "2.31337" },
			{ coin: "PURR", total: "7" },
		];
		expect(spotAvailable(spot, "USDC")).toBe("21.401016");
		expect(spotAvailable(spot, "PURR")).toBe("7");
		// read, and the token is not there: nothing can be sent
		expect(spotAvailable(spot, "HYPE")).toBe("0");
	});
	it("is unknown when the balances were not read or cannot be", () => {
		expect(spotAvailable(null, "USDC")).toBeNull();
		expect(spotAvailable([{ coin: "USDC", total: "n/a" }], "USDC")).toBeNull();
	});
});

describe("receiverOf", () => {
	it("reads Hyperliquid's two answers about an address", () => {
		expect(receiverOf({ role: "missing" }, "default")).toEqual({
			status: "new",
			mode: MANUAL,
		});
		expect(receiverOf({ role: "user" }, "unifiedAccount")).toEqual({
			status: "active",
			mode: UNIFIED,
		});
		expect(
			receiverOf({ role: "agent", data: { user: TREASURY } }, "default"),
		).toEqual({ status: "agent", mode: MANUAL, agentOf: TREASURY });
		expect(receiverOf({ role: "agent" }, "default").agentOf).toBeNull();
		expect(receiverOf({ role: "vault" }, "default").status).toBe("other");
		expect(
			receiverOf({ role: "subAccount", data: { master: TREASURY } }, "default")
				.status,
		).toBe("other");
	});
	it("claims nothing about an answer it cannot read", () => {
		for (const role of [null, undefined, "user", {}, { role: "somethingNew" }])
			expect(receiverOf(role, "default").status).toBe("unknown");
		// the mode could not be read: the role still stands
		expect(receiverOf({ role: "user" }, null)).toEqual({
			status: "active",
			mode: null,
		});
	});
});

describe("receiverRecheckMs", () => {
	it("asks again only about an address that can still come into use", () => {
		expect(receiverRecheckMs(FRESH, 60_000)).toBe(60_000);
		expect(receiverRecheckMs({ status: "unknown", mode: null }, 60_000)).toBe(
			60_000,
		);
		for (const status of ["active", "agent", "other"] as const)
			expect(receiverRecheckMs({ status, mode: MANUAL }, 60_000)).toBe(false);
		// not read yet: the first read is on its way, no second one beside it
		expect(receiverRecheckMs(null, 60_000)).toBe(false);
		expect(receiverRecheckMs(undefined, 60_000)).toBe(false);
	});
});

describe("preflight: what Hyperliquid would refuse as things stand", () => {
	it("lets through what nothing known stands in the way of", () => {
		for (const a of [
			asset("", ""),
			asset("spot", "spot"),
			usdSend(),
			{ type: "approveAgent", agentAddress: RECIPIENT, agentName: "bot" },
			{ type: "withdraw3", destination: RECIPIENT, amount: "5", time: 1 },
		])
			expect(preflight(a, facts()), JSON.stringify(a)).toEqual([]);
	});
	it("a fact that was not read is no reason to stop", () => {
		const blind: SendFacts = {
			mode: null,
			perpsUsdc: null,
			spot: null,
			receiver: null,
		};
		expect(preflight(asset("", "", "999999"), blind)).toEqual([]);
		expect(preflight(usdSend("999999"), blind)).toEqual([]);
	});
	it("stops what a unified treasury is refused, and says what to do", () => {
		expect(codes(usdSend(), facts({ mode: UNIFIED }))).toEqual([
			"unified-disabled",
		]);
		expect(
			codes(
				{ type: "usdClassTransfer", amount: "1", toPerp: true },
				facts({ mode: UNIFIED }),
			),
		).toEqual(["unified-disabled"]);
		const r = preflight(asset("", "spot"), facts({ mode: UNIFIED }));
		expect(r.map((x) => x.code)).toEqual(["unified-spot-only"]);
		expect(r[0]?.message).toContain("Propose it again");
		expect(codes(asset("spot", ""), facts({ mode: UNIFIED }))).toEqual([]);
		// a token that is not the collateral, into perps
		expect(codes(asset("spot", "", "1", PURR), facts())).toEqual([
			"token-invalid",
		]);
	});
	it("stops a send or a withdrawal above what can be moved now", () => {
		const f = facts({
			perpsUsdc: "25",
			spot: [
				{ coin: "USDC", total: "10", hold: "4" },
				{ coin: "PURR", total: "2" },
			],
		});
		expect(codes(usdSend("30"), f)).toEqual(["transfer-balance"]);
		expect(codes(usdSend("25"), f)).toEqual([]);
		expect(codes(asset("", "", "25.01"), f)).toEqual(["transfer-balance"]);
		// spot: what is held by positions and orders cannot be sent
		expect(codes(asset("spot", "spot", "6"), f)).toEqual([]);
		const over = preflight(asset("spot", "spot", "6.01"), f);
		expect(over.map((x) => x.code)).toEqual(["token-balance"]);
		expect(over[0]?.message).toContain("can move 6 from its spot balance");
		expect(codes(asset("spot", "spot", "3", PURR), f)).toEqual([
			"token-balance",
		]);
		expect(
			codes({ type: "withdraw3", destination: RECIPIENT, amount: "26" }, f),
		).toEqual(["transfer-balance"]);
		// a unified treasury's one balance is called that
		expect(
			preflight(asset("spot", "spot", "7"), { ...f, mode: UNIFIED })[0]
				?.message,
		).toContain("from its balance right now");
		// another perp dex: its balance is not read here, so nothing is claimed
		expect(codes(asset("xyz", "spot", "999"), f)).toEqual([]);
	});
	it("holds a unified treasury's withdrawal to its one balance, not to a perps figure", () => {
		// as Hyperliquid reported a unified lab treasury on 2026-10-13
		const f = facts({
			mode: UNIFIED,
			perpsUsdc: "0.291437",
			spot: [{ coin: "USDC", total: "16.614529", hold: "2.818399" }],
		});
		const withdraw = (amount: string) => ({
			type: "withdraw3",
			destination: RECIPIENT,
			amount,
		});
		expect(codes(withdraw("5"), f)).toEqual([]);
		const over = preflight(withdraw("13.8"), f);
		expect(over.map((x) => x.code)).toEqual(["transfer-balance"]);
		expect(over[0]?.message).toBe(
			"This sends 13.8 USDC, and the treasury can move 13.79613 from its balance right now.",
		);
		// one of the two figures was not read: nothing is claimed
		expect(codes(withdraw("999"), { ...f, spot: null })).toEqual([]);
		expect(codes(withdraw("999"), { ...f, perpsUsdc: null })).toEqual([]);
		// an account with two balances is held to its perps balance, as before
		expect(codes(withdraw("5"), { ...f, mode: MANUAL })).toEqual([
			"transfer-balance",
		]);
		expect(largerOf("2", "10")).toBe("10");
		expect(largerOf("10", "2")).toBe("10");
		expect(largerOf("n/a", "2")).toBeNull();
	});
	it("stops a send to a new address that the treasury cannot pay the 1 USDC for", () => {
		const held = (perps: string, spot: string): Partial<SendFacts> => ({
			receiver: FRESH,
			perpsUsdc: perps,
			spot: [{ coin: "USDC", total: spot, hold: "0" }],
		});
		expect(codes(asset("", "", "5"), facts(held("5", "1")))).toEqual([]);
		expect(codes(asset("", "", "5"), facts(held("6", "0")))).toEqual([]);
		expect(codes(asset("", "", "5"), facts(held("5.5", "0.5")))).toEqual([
			"transfer-gas",
		]);
		expect(codes(asset("spot", "spot", "5"), facts(held("0", "5.9")))).toEqual([
			"transfer-gas",
		]);
		// the older send pays out of the amount
		expect(codes(usdSend("1"), facts(held("50", "50")))).toEqual([
			"transfer-below-fee",
		]);
		expect(codes(usdSend("1.5"), facts(held("50", "50")))).toEqual([]);
		// an address in use costs nothing, whatever the balances
		expect(
			codes(
				asset("", "", "5"),
				facts({
					...held("5", "0"),
					receiver: { status: "active", mode: MANUAL },
				}),
			),
		).toEqual([]);
	});
	it("stops a USDC send that a newer one has shut out", () => {
		const newer = { action: usdSend("1", 1_791_000_500_000) };
		expect(
			codes(usdSend("1", 1_791_000_000_000), facts({ done: [newer] })),
		).toEqual(["nonce-used"]);
		// the send that replaces it is not ordered
		expect(codes(asset("", ""), facts({ done: [newer] }))).toEqual([]);
	});
	it("names the mode first and does not pile a balance on top of it", () => {
		expect(
			codes(usdSend("999"), facts({ mode: UNIFIED, perpsUsdc: "0" })),
		).toEqual(["unified-disabled"]);
	});
});

describe("modeRefusal: what the treasury's mode alone rules out", () => {
	it("names what a unified treasury cannot send, with a title for the page", () => {
		expect(modeRefusal(UNIFIED, usdSend())).toMatchObject({
			code: "unified-disabled",
			title: "Cannot be sent while the treasury is a unified account",
		});
		expect(modeRefusal(UNIFIED, asset("", ""))?.code).toBe("unified-spot-only");
		expect(modeRefusal(MANUAL, asset("spot", "", "1", PURR))?.title).toContain(
			"token",
		);
	});
	it("refuses a destination that moves the token to HyperEVM, whatever the mode and also when it was not read", () => {
		const hype = "0x2222222222222222222222222222222222222222";
		const toEvm = { ...asset("spot", "spot"), destination: hype };
		for (const mode of [MANUAL, UNIFIED, null])
			expect(modeRefusal(mode, toEvm)).toEqual({
				code: "evm-multisig",
				title: "Hyperliquid refuses a send to HyperEVM from a multi-sig",
				message: TO_HYPEREVM,
			});
		// said before what the mode has against it: no other way of sending would do
		expect(
			modeRefusal(UNIFIED, { ...usdSend(), destination: hype })?.code,
		).toBe("evm-multisig");
		// a token's system address by its index
		expect(
			modeRefusal(MANUAL, {
				...asset("spot", "spot", "1", PURR),
				destination: "0x2000000000000000000000000000000000000001",
			})?.code,
		).toBe("evm-multisig");
		expect(TO_HYPEREVM).toContain("refuses that from a multi-sig account");
		for (const pattern of FORBIDDEN_CLAIMS)
			expect(TO_HYPEREVM).not.toMatch(pattern);
	});
	it("says nothing when the mode allows it, or was not read", () => {
		expect(modeRefusal(UNIFIED, asset("spot", "spot"))).toBeNull();
		expect(modeRefusal(MANUAL, usdSend())).toBeNull();
		expect(modeRefusal(null, usdSend())).toBeNull();
		expect(modeRefusal(UNIFIED, { type: "approveAgent" })).toBeNull();
	});
});

describe("costLine: what sending to this address costs", () => {
	const line = (
		action: PlainObject | null,
		receiver: Receiver | "loading" | null,
		over: Partial<Parameters<typeof costLine>[0]> = {},
	) =>
		costLine({
			action,
			receiver,
			mode: MANUAL,
			perpsUsdc: "100",
			spot: [{ coin: "USDC", total: "100", hold: "0" }],
			...over,
		});
	it("is silent for a destination that is no account: the form refuses it under the field", () => {
		expect(
			line(
				{
					...asset("spot", "spot"),
					destination: "0x2222222222222222222222222222222222222222",
				},
				FRESH,
			),
		).toBeNull();
	});
	it("is silent for what pays nobody", () => {
		expect(line(null, FRESH)).toBeNull();
		expect(
			line({ type: "usdClassTransfer", amount: "1", toPerp: true }, FRESH),
		).toBeNull();
		expect(line({ type: "approveAgent" }, FRESH)).toBeNull();
		expect(
			line({ type: "withdraw3", destination: RECIPIENT, amount: "5" }, FRESH),
		).toBeNull();
	});
	it("says nothing is charged for an address in use, and where the money arrives", () => {
		const perps = line(asset("", ""), { status: "active", mode: MANUAL });
		expect(perps?.tone).toBe("plain");
		expect(perps?.text).toBe(
			"This address is in use on Hyperliquid: sending to it costs nothing. It arrives in their perps balance.",
		);
		expect(
			line(asset("", "spot"), { status: "active", mode: MANUAL })?.text,
		).toContain("their spot balance");
		expect(
			line(asset("", ""), { status: "active", mode: UNIFIED })?.text,
		).toContain("their one balance");
		// its mode was not read: only the cost is said
		expect(line(asset("", ""), { status: "active", mode: null })?.text).toBe(
			"This address is in use on Hyperliquid: sending to it costs nothing.",
		);
		expect(
			line(asset("spot", "xyz"), { status: "active", mode: MANUAL })?.text,
		).not.toContain("arrives");
	});
	it("says who pays the 1 USDC for a new address, and from where", () => {
		const fromSpot = line(asset("", ""), FRESH);
		expect(fromSpot?.tone).toBe("fee");
		expect(fromSpot?.text).toContain("costs 1 USDC, once");
		expect(fromSpot?.text).toContain(
			"The receiver gets the full amount, and the treasury pays 1 USDC on top, from its spot USDC.",
		);
		expect(
			line(asset("", ""), FRESH, { spot: [{ coin: "USDC", total: "0.2" }] })
				?.text,
		).toContain("from its perps balance");
		expect(line(asset("spot", ""), FRESH, { mode: UNIFIED })?.text).toContain(
			"from its balance",
		);
		// balances not read: the fee is still said, the pocket is not guessed
		const blind = line(asset("", ""), FRESH, { perpsUsdc: null, spot: null });
		expect(blind?.tone).toBe("fee");
		expect(blind?.text).toContain("pays 1 USDC on top.");
		// and it cannot be paid
		const short = line(asset("", "", "5"), FRESH, {
			perpsUsdc: "5.5",
			spot: [{ coin: "USDC", total: "0.5" }],
		});
		expect(short?.tone).toBe("warn");
		expect(short?.text).toContain("cannot pay both");
	});
	it("says an older USDC send delivers 1 USDC less, or is refused", () => {
		const less = line(usdSend("5"), FRESH);
		expect(less?.tone).toBe("fee");
		expect(less?.text).toContain("the receiver gets 4 USDC");
		const refused = line(usdSend("1"), FRESH);
		expect(refused?.tone).toBe("warn");
		expect(refused?.text).toContain("refuses an amount of 1 USDC or less");
		expect(line(usdSend("abc"), FRESH)?.text).toContain(
			"pays it out of the amount.",
		);
	});
	it("warns about an API wallet, a vault and a sub-account", () => {
		const agent = line(asset("", ""), {
			status: "agent",
			mode: MANUAL,
			agentOf: TREASURY,
		});
		expect(agent?.tone).toBe("warn");
		expect(agent?.text).toContain(`API wallet of ${TREASURY.slice(0, 6)}…`);
		expect(
			line(asset("", ""), { status: "agent", mode: null })?.text,
		).toContain("is an API wallet, not an account");
		expect(line(asset("", ""), { status: "other", mode: null })?.tone).toBe(
			"warn",
		);
	});
	it("claims nothing while it does not know", () => {
		expect(line(asset("", ""), "loading")?.tone).toBe("muted");
		for (const r of [null, { status: "unknown", mode: null } as Receiver]) {
			const l = line(asset("", ""), r);
			expect(l?.tone).toBe("muted");
			expect(l?.text).toContain("could not be checked");
		}
	});
	it("promises nothing the product does not provide", () => {
		const texts = [
			line(asset("", ""), FRESH),
			line(asset("", ""), { status: "active", mode: UNIFIED }),
			line(usdSend("5"), FRESH),
			line(usdSend("1"), FRESH),
			line(asset("", ""), { status: "agent", mode: null }),
			line(asset("", ""), { status: "other", mode: null }),
			line(asset("", ""), null),
			line(asset("", ""), "loading"),
			...preflight(usdSend("999"), facts({ mode: UNIFIED })).map((r) => ({
				text: r.message,
			})),
			...preflight(asset("", "", "999"), facts()).map((r) => ({
				text: r.message,
			})),
		].map((l) => l?.text ?? "");
		expect(texts.every((t) => t.length > 20)).toBe(true);
		for (const t of texts)
			for (const claim of FORBIDDEN_CLAIMS) expect(t).not.toMatch(claim);
	});
});

interface Recorded {
	senderMode: string;
	action: PlainObject;
	answer: { status: string; response?: unknown };
	receiverWas?: "never used" | "in use";
	senderHeld?: { perps: number; spotUsdc: number } | null;
}
const recorded = (name: string): Recorded[] =>
	(
		JSON.parse(
			readFileSync(
				fileURLToPath(
					new URL(
						`../../../../packages/hl-core/fixtures/multisig/${name}.json`,
						import.meta.url,
					),
				),
				"utf8",
			),
		) as { sends: Recorded[] }
	).sends;
const answered = (r: Recorded): string | null =>
	r.answer.status === "err" ? explainExchangeError(r.answer, 200).id : null;

describe("what a proposal's page says against it before anyone signs", () => {
	it("is the balances and a withdrawal at the fee, never the mode or the receiver", () => {
		expect(
			standingRefusals(usdSend("1000"), facts()).map((r) => r.code),
		).toEqual(["transfer-balance"]);
		expect(
			standingRefusals(
				{ type: "withdraw3", destination: RECIPIENT, amount: "1", time: 1 },
				facts(),
			).map((r) => r.code),
		).toEqual(["withdrawal-below-fee"]);
		// the mode is said apart, and a new receiver is the cost line's
		expect(standingRefusals(usdSend(), facts({ mode: UNIFIED }))).toEqual([]);
		expect(
			standingRefusals(usdSend("100"), facts({ receiver: FRESH })),
		).toEqual([]);
		// a balance not read stops nothing
		expect(
			standingRefusals(usdSend("1000"), facts({ perpsUsdc: null })),
		).toEqual([]);
	});
});

describe("older USDC sends a withdrawal should let go first", () => {
	const withdraw = (time?: number): PlainObject => ({
		type: "withdraw3",
		destination: RECIPIENT,
		amount: "5",
		...(time === undefined ? {} : { time }),
	});
	const waiting = [
		{ action: usdSend("1", 300), title: "c" },
		{ action: usdSend("1", 100), title: "a" },
		{ action: asset("", ""), title: "not ordered" },
		{ action: withdraw(150), title: "another withdrawal" },
		{ action: usdSend("1", 500), title: "newer" },
	];
	it("names the older sends, oldest first, and nothing else", () => {
		expect(sendsBefore(withdraw(400), waiting).map((w) => w.title)).toEqual([
			"a",
			"c",
		]);
		// one not made yet is numbered after every one on record
		expect(sendsBefore(withdraw(), waiting).map((w) => w.title)).toEqual([
			"a",
			"c",
			"newer",
		]);
		// only a withdrawal asks
		expect(sendsBefore(usdSend("1", 900), waiting)).toEqual([]);
		expect(sendsBefore(null, waiting)).toEqual([]);
	});
	it("says to send them first, and that the rest was not measured", () => {
		expect(sendsFirstLine(["Rent"])).toBe(
			"A USDC send of this treasury proposed before this withdrawal is still waiting: “Rent”. Send it first: whether a withdrawal carried out first stops an older send from going through has not been measured.",
		);
		const two = sendsFirstLine(["Rent", "Pay"]);
		expect(two).toMatch(/^2 USDC sends .*“Rent”, “Pay”\. Send them first/);
		for (const p of FORBIDDEN_CLAIMS) expect(two).not.toMatch(p);
	});
});

describe("preflight against what testnet answered", () => {
	it("stops exactly the sends a sender's mode was refused, and no other", () => {
		const sends = recorded("send-modes");
		expect(sends.length).toBeGreaterThanOrEqual(70);
		for (const [i, r] of sends.entries()) {
			const got = codes(r.action, {
				mode: accountMode(r.senderMode),
				perpsUsdc: null,
				spot: null,
				receiver: null,
			});
			expect(got, `send ${i + 1}`).toEqual(
				answered(r) === null ? [] : [answered(r)],
			);
		}
	});
	it("stops exactly the sends to new addresses that were refused for the fee", () => {
		const sends = recorded("activation-fee").filter((r) => r.senderHeld);
		expect(sends.length).toBeGreaterThanOrEqual(20);
		for (const [i, r] of sends.entries()) {
			const held = r.senderHeld as { perps: number; spotUsdc: number };
			const got = codes(r.action, {
				mode: accountMode(r.senderMode),
				perpsUsdc: String(held.perps),
				spot: [{ coin: "USDC", total: String(held.spotUsdc), hold: "0" }],
				receiver: {
					status: r.receiverWas === "never used" ? "new" : "active",
					mode: MANUAL,
				},
			});
			// a token whose balance the fixture does not carry is not judged for its amount
			const expected = answered(r) === null ? [] : [answered(r)];
			expect(
				got.filter((c) => c !== "token-balance"),
				`send ${i + 1}: ${JSON.stringify(r.action)}`,
			).toEqual(expected);
		}
	});
});
