import { describe, expect, it } from "vitest";
import { L1_ACTION_SHAPES } from "../../src/canonical.ts";
import { describeAction, type PlainObject } from "../../src/multisig/index.ts";
import { USER_SIGNED_SPECS } from "../../src/rules/signing.ts";
import { A, B, ORDER, RECIPIENT, usdSend } from "./_helpers.ts";

const leg = {
	a: 3,
	b: true,
	p: "50000",
	s: "0.001",
	r: false,
	t: { limit: { tif: "Gtc" } },
};
/** A representative, canonical instance of every modelled action type. */
const SAMPLES: Record<string, PlainObject> = {
	order: ORDER,
	cancel: { type: "cancel", cancels: [{ a: 3, o: 1 }] },
	cancelByCloid: {
		type: "cancelByCloid",
		cancels: [{ asset: 3, cloid: `0x${"1".repeat(32)}` }],
	},
	modify: { type: "modify", oid: 7, order: leg },
	batchModify: {
		type: "batchModify",
		modifies: [
			{ oid: 7, order: leg },
			{ oid: `0x${"2".repeat(32)}`, order: { ...leg, b: false } },
		],
	},
	scheduleCancel: { type: "scheduleCancel", time: 1_791_000_000_000 },
	updateLeverage: {
		type: "updateLeverage",
		asset: 3,
		isCross: true,
		leverage: 10,
	},
	updateIsolatedMargin: {
		type: "updateIsolatedMargin",
		asset: 3,
		isBuy: true,
		ntli: 1_500_000,
	},
	twapOrder: {
		type: "twapOrder",
		twap: { a: 3, b: false, s: "1", r: true, m: 30, t: true },
	},
	twapCancel: { type: "twapCancel", a: 3, t: 9 },
	vaultTransfer: {
		type: "vaultTransfer",
		vaultAddress: A,
		isDeposit: true,
		usd: 20_000_000,
	},
	subAccountTransfer: {
		type: "subAccountTransfer",
		subAccountUser: A,
		isDeposit: false,
		usd: 1,
	},
	subAccountSpotTransfer: {
		type: "subAccountSpotTransfer",
		subAccountUser: A,
		isDeposit: true,
		token: "PURR:0x1",
		amount: "2",
	},
	createSubAccount: { type: "createSubAccount", name: "lab" },
	setReferrer: { type: "setReferrer", code: "HL" },
	evmUserModify: { type: "evmUserModify", usingBigBlocks: true },
	reserveRequestWeight: { type: "reserveRequestWeight", weight: 100 },
	noop: { type: "noop" },
	usdSend: usdSend(),
	spotSend: {
		type: "spotSend",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		destination: RECIPIENT,
		token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
		amount: "0.5",
		time: 1,
	},
	withdraw3: {
		type: "withdraw3",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		destination: RECIPIENT,
		amount: "10",
		time: 1,
	},
	usdClassTransfer: {
		type: "usdClassTransfer",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		amount: "10",
		toPerp: false,
		nonce: 1,
	},
	sendAsset: {
		type: "sendAsset",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		destination: RECIPIENT,
		sourceDex: "",
		destinationDex: "xyz",
		token: "USDC",
		amount: "1",
		fromSubAccount: A,
		nonce: 1,
	},
	approveAgent: {
		type: "approveAgent",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		agentAddress: B,
		agentName: "lab",
		nonce: 1,
	},
	approveBuilderFee: {
		type: "approveBuilderFee",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		maxFeeRate: "0.01%",
		builder: B,
		nonce: 1,
	},
	tokenDelegate: {
		type: "tokenDelegate",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		validator: B,
		wei: 100000000n,
		isUndelegate: false,
		nonce: 1,
	},
	cDeposit: {
		type: "cDeposit",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		wei: 5,
		nonce: 1,
	},
	cWithdraw: {
		type: "cWithdraw",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		wei: 5,
		nonce: 1,
	},
	linkStakingUser: {
		type: "linkStakingUser",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		user: B,
		isFinalize: true,
		nonce: 1,
	},
	sendToEvmWithData: {
		type: "sendToEvmWithData",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		token: "USDC:0x1",
		amount: "1",
		sourceDex: "",
		destinationRecipient: B,
		addressEncoding: "evm",
		destinationChainId: 998,
		gasLimit: 1,
		data: "0x",
		nonce: 1,
	},
	userDexAbstraction: {
		type: "userDexAbstraction",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		user: B,
		enabled: true,
		nonce: 1,
	},
	userSetAbstraction: {
		type: "userSetAbstraction",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		user: B,
		abstraction: "unifiedAccount",
		nonce: 1,
	},
	userPortfolioMargin: {
		type: "userPortfolioMargin",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		user: B,
		enabled: false,
		nonce: 1,
	},
	convertToMultiSigUser: {
		type: "convertToMultiSigUser",
		signatureChainId: "0x66eee",
		hyperliquidChain: "Testnet",
		signers: JSON.stringify({ authorizedUsers: [A, B].sort(), threshold: 1 }),
		nonce: 1,
	},
};

describe("describeAction covers every modelled type", () => {
	const types = [
		...Object.keys(L1_ACTION_SHAPES),
		...USER_SIGNED_SPECS.map((s) => s.actionType),
	];
	for (const type of types) {
		it(type, () => {
			const sample = SAMPLES[type];
			expect(sample, `add a sample for ${type}`).toBeDefined();
			const d = describeAction(sample as PlainObject);
			expect(d.known).toBe(true);
			expect(d.type).toBe(type);
			expect(d.headline.length).toBeGreaterThan(5);
			expect(d.headline).not.toContain("?");
			expect(d.headline).not.toContain("undefined");
		});
	}
});

describe("describeAction details", () => {
	it("orders: limit, trigger, reduce-only, cloid, builder, grouping, coin resolver, multiple legs", () => {
		const coin = (a: number) => (a === 3 ? "BTC" : undefined);
		expect(describeAction(ORDER, { coin }).headline).toBe(
			"Limit buy 0.001 BTC at 50000 (Gtc)",
		);
		expect(describeAction(ORDER).headline).toBe(
			"Limit buy 0.001 asset #3 at 50000 (Gtc)",
		);
		const trigger = {
			type: "order",
			orders: [
				{
					a: 9,
					b: false,
					p: "100",
					s: "2",
					r: true,
					t: { trigger: { isMarket: true, triggerPx: "99", tpsl: "sl" } },
					c: `0x${"a".repeat(32)}`,
				},
			],
			grouping: "positionTpsl",
			builder: { b: B, f: 10 },
		};
		const d = describeAction(trigger, { coin });
		expect(d.headline).toBe(
			`SL market trigger sell 2 asset #9 at 100 at trigger 99, reduce-only, cloid 0x${"a".repeat(32)}`,
		);
		expect(d.lines).toEqual([
			"grouping positionTpsl",
			`builder ${B} fee 10 (tenths of a bp)`,
		]);
		const two = describeAction({
			type: "order",
			orders: [
				leg,
				{
					...leg,
					t: { trigger: { isMarket: false, triggerPx: "1", tpsl: "tp" } },
				},
			],
			grouping: "na",
		});
		expect(two.headline).toBe("2 orders");
		expect(two.lines.length).toBe(2);
		expect(two.lines[1]).toContain("TP limit trigger");
		expect(
			describeAction({
				type: "order",
				orders: [{ a: 1, s: "1", p: "1", t: {} }],
				grouping: "na",
			}).headline,
		).toBe("Order order 1 asset #1 at 1");
		expect(
			describeAction({ type: "order", orders: "nope", grouping: "na" })
				.headline,
		).toBe("0 orders");
	});
	it("cancels, modify, batchModify", () => {
		expect(describeAction(SAMPLES.cancel as PlainObject).headline).toBe(
			"Cancel 1 order",
		);
		expect(
			describeAction({
				type: "cancel",
				cancels: [
					{ a: 1, o: 1 },
					{ a: 2, o: 2 },
				],
			}).lines,
		).toEqual(["oid 1 on asset #1", "oid 2 on asset #2"]);
		expect(describeAction({ type: "cancel" }).headline).toBe("Cancel 0 orders");
		expect(
			describeAction(SAMPLES.cancelByCloid as PlainObject).lines[0],
		).toContain("cloid 0x1111");
		expect(describeAction({ type: "cancelByCloid" }).headline).toBe(
			"Cancel 0 orders by cloid",
		);
		expect(describeAction(SAMPLES.modify as PlainObject).headline).toBe(
			"Modify order 7",
		);
		expect(describeAction({ type: "modify", oid: 1 }).lines[0]).toContain(
			"Order order",
		);
		expect(
			describeAction(SAMPLES.batchModify as PlainObject).lines.length,
		).toBe(2);
		expect(
			describeAction({ type: "batchModify", modifies: [{ oid: 1 }] }).lines[0],
		).toContain("1: Order order");
		expect(describeAction({ type: "batchModify" }).headline).toBe(
			"Modify 0 orders",
		);
	});
	it("scheduleCancel with and without a time", () => {
		expect(describeAction({ type: "scheduleCancel" }).headline).toContain(
			"Remove the scheduled cancel",
		);
		expect(
			describeAction(SAMPLES.scheduleCancel as PlainObject).headline,
		).toContain("Schedule cancel-all at 2026-");
	});
	it("USD micro-units are rendered as USDC, raw otherwise", () => {
		expect(describeAction(SAMPLES.vaultTransfer as PlainObject).headline).toBe(
			`Deposit 20 USDC into vault ${A}`,
		);
		expect(
			describeAction(SAMPLES.subAccountTransfer as PlainObject).headline,
		).toBe(`Withdraw 0.000001 USDC from sub-account ${A}`);
		expect(
			describeAction({
				type: "vaultTransfer",
				vaultAddress: A,
				isDeposit: false,
				usd: "12",
			}).headline,
		).toBe(`Withdraw 12 (raw) from vault ${A}`);
		expect(
			describeAction({
				type: "updateIsolatedMargin",
				asset: 3,
				isBuy: false,
				ntli: 2_500_000n,
			}).headline,
		).toBe("Remove 2.5 USDC isolated margin on asset #3");
	});
	it("twap buy and a sub-account deposit", () => {
		expect(
			describeAction({
				type: "twapOrder",
				twap: { a: 1, b: true, s: "2", r: false, m: 5, t: false },
			}).headline,
		).toBe("TWAP buy 2 asset #1 over 5 min");
		expect(
			describeAction({
				type: "subAccountTransfer",
				subAccountUser: A,
				isDeposit: true,
				usd: 1_000_000,
			}).headline,
		).toBe(`Deposit 1 USDC into sub-account ${A}`);
	});
	it("twap, leverage, sub-account spot, referrer, evm, reserve, noop", () => {
		expect(describeAction(SAMPLES.twapOrder as PlainObject)).toMatchObject({
			headline: "TWAP sell 1 asset #3 over 30 min",
			lines: ["reduce-only", "randomised timing"],
		});
		expect(describeAction({ type: "twapOrder" }).lines).toEqual([]);
		expect(describeAction(SAMPLES.twapCancel as PlainObject).headline).toBe(
			"Cancel TWAP 9 on asset #3",
		);
		expect(describeAction(SAMPLES.updateLeverage as PlainObject).headline).toBe(
			"Set asset #3 leverage to 10x cross",
		);
		expect(
			describeAction({
				...SAMPLES.updateLeverage,
				isCross: false,
			} as PlainObject).headline,
		).toContain("isolated");
		expect(
			describeAction(SAMPLES.subAccountSpotTransfer as PlainObject).headline,
		).toBe(`Deposit 2 PURR:0x1 into sub-account ${A}`);
		expect(
			describeAction({
				...SAMPLES.subAccountSpotTransfer,
				isDeposit: false,
			} as PlainObject).headline,
		).toContain("Withdraw");
		expect(describeAction(SAMPLES.setReferrer as PlainObject).headline).toBe(
			'Set referrer code "HL"',
		);
		expect(describeAction(SAMPLES.evmUserModify as PlainObject).headline).toBe(
			"Use HyperEVM big blocks",
		);
		expect(
			describeAction({ type: "evmUserModify", usingBigBlocks: false }).headline,
		).toBe("Stop using HyperEVM big blocks");
		expect(
			describeAction(SAMPLES.reserveRequestWeight as PlainObject).headline,
		).toBe("Reserve 100 request weight");
		expect(describeAction(SAMPLES.noop as PlainObject).headline).toContain(
			"No-op",
		);
	});
	it("user-signed actions", () => {
		expect(describeAction(usdSend()).headline).toBe(
			`Send 5 USDC (perps) to ${RECIPIENT}`,
		);
		expect(describeAction(SAMPLES.spotSend as PlainObject).headline).toBe(
			`Send 0.5 USDC (spot) to ${RECIPIENT}`,
		);
		expect(
			describeAction({ type: "spotSend", amount: "1", destination: RECIPIENT })
				.headline,
		).toContain("? (spot)");
		expect(describeAction(SAMPLES.withdraw3 as PlainObject).headline).toContain(
			"on Arbitrum",
		);
		expect(
			describeAction(SAMPLES.usdClassTransfer as PlainObject).headline,
		).toBe("Move 10 USDC perps → spot");
		expect(
			describeAction({
				...SAMPLES.usdClassTransfer,
				toPerp: true,
			} as PlainObject).headline,
		).toBe("Move 10 USDC spot → perps");
		const sa = describeAction(SAMPLES.sendAsset as PlainObject);
		expect(sa.lines).toEqual([
			'from dex "" to dex "xyz"',
			`from sub-account ${A}`,
		]);
		expect(
			describeAction({
				...SAMPLES.sendAsset,
				fromSubAccount: "",
			} as PlainObject).lines.length,
		).toBe(1);
		expect(describeAction(SAMPLES.approveAgent as PlainObject).headline).toBe(
			`Approve API wallet ${B} named "lab"`,
		);
		expect(
			describeAction({ ...SAMPLES.approveAgent, agentName: "" } as PlainObject)
				.headline,
		).toContain("main (unnamed) agent");
		expect(describeAction(SAMPLES.approveAgent as PlainObject).flags).toEqual([
			"agent_bypass",
		]);
		expect(
			describeAction(SAMPLES.approveBuilderFee as PlainObject).headline,
		).toBe(`Approve builder ${B} up to 0.01%`);
		expect(describeAction(SAMPLES.tokenDelegate as PlainObject).headline).toBe(
			`Delegate 100000000 wei of HYPE to validator ${B}`,
		);
		expect(
			describeAction({
				...SAMPLES.tokenDelegate,
				isUndelegate: true,
			} as PlainObject).headline,
		).toContain("Undelegate");
		expect(describeAction(SAMPLES.cDeposit as PlainObject).headline).toContain(
			"into staking",
		);
		expect(describeAction(SAMPLES.cWithdraw as PlainObject).lines[0]).toContain(
			"7 days",
		);
		expect(
			describeAction(SAMPLES.linkStakingUser as PlainObject).headline,
		).toContain("Finalise");
		expect(
			describeAction({
				...SAMPLES.linkStakingUser,
				isFinalize: false,
			} as PlainObject).headline,
		).toContain("Start");
		expect(
			describeAction(SAMPLES.sendToEvmWithData as PlainObject).lines[0],
		).toBe("chain 998, gas limit 1, data 0x");
		expect(
			describeAction(SAMPLES.userDexAbstraction as PlainObject).headline,
		).toContain("Enable HIP-3");
		expect(
			describeAction({
				...SAMPLES.userDexAbstraction,
				enabled: false,
			} as PlainObject).headline,
		).toContain("Disable");
		expect(
			describeAction(SAMPLES.userSetAbstraction as PlainObject).headline,
		).toContain("unifiedAccount");
		expect(
			describeAction(SAMPLES.userPortfolioMargin as PlainObject).headline,
		).toContain("Disable portfolio margin");
		expect(
			describeAction({
				...SAMPLES.userPortfolioMargin,
				enabled: true,
			} as PlainObject).headline,
		).toContain("Enable");
	});
	it("convert: set, revert, unparseable", () => {
		const d = describeAction(SAMPLES.convertToMultiSigUser as PlainObject);
		expect(d.headline).toBe("Set the multi-sig to 1 of 2 signers");
		expect(d.lines).toEqual([B, A].map((a) => `signer ${a}`));
		expect(d.flags).toEqual(["policy_change"]);
		expect(
			describeAction({
				type: "convertToMultiSigUser",
				signers: JSON.stringify({ authorizedUsers: [A], threshold: 1 }),
			}).headline,
		).toBe("Set the multi-sig to 1 of 1 signer");
		const r = describeAction({
			type: "convertToMultiSigUser",
			signers: "null",
		});
		expect(r.headline).toContain("Convert back to a normal user");
		expect(r.flags).toEqual(["destructive"]);
		const bad = describeAction({ type: "convertToMultiSigUser", signers: "{" });
		expect(bad.headline).toContain("unparseable");
		expect(bad.lines[0]).toContain("not valid JSON");
	});
	it("unknown types are described as hashed-as-written with their keys; odd values never throw", () => {
		const d = describeAction({
			type: "spotDeploy",
			registerToken2: { spec: { name: "X" } },
			big: 1n << 70n,
			nothing: null,
		});
		expect(d.known).toBe(false);
		expect(d.headline).toBe(
			'Unknown action "spotDeploy" (hashed exactly as written)',
		);
		expect(d.lines).toEqual([
			'registerToken2: {"spec":{"name":"X"}}',
			`big: ${(1n << 70n).toString()}`,
			"nothing: null",
		]);
		expect(describeAction({ type: 5 as never }).headline).toContain('"5"');
	});
});
