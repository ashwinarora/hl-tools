import { describe, expect, it } from "vitest";
import { L1_ACTION_SHAPES } from "../../src/canonical.ts";
import {
	describeAction,
	type PlainObject,
	returnQueueLine,
	stakeLockupLine,
} from "../../src/multisig/index.ts";
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
		// a time that is no date is written as the number it is, never thrown at
		for (const time of [9_000_000_000_000_000, "soon"])
			expect(
				describeAction({ type: "scheduleCancel", time } as PlainObject)
					.headline,
			).toMatch(/^Schedule cancel-all at .*\(no date\)$/);
	});
	it("says a value that holds an integer too large for a number, also nested", () => {
		// order-preserving parsing hands such an integer over as a bigint
		const d = describeAction({
			type: "somethingNew",
			limits: { max: 12345678901234567890n, list: [1n, "a"] },
			big: 98765432109876543210n,
		} as unknown as PlainObject);
		expect(d.lines.join(" ")).toContain('"max":"12345678901234567890"');
		expect(d.lines.join(" ")).toContain("98765432109876543210");
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
		// a testnet withdrawal leaves for Arbitrum's test network, and the bridge keeps its fee
		const out = describeAction(SAMPLES.withdraw3 as PlainObject);
		expect(out.headline).toBe(
			`Withdraw 10 USDC to ${RECIPIENT} on Arbitrum Sepolia`,
		);
		expect(out.lines).toEqual([
			"Leaves Hyperliquid through the bridge.",
			"The bridge keeps 1 USDC of it as its fee: 9 USDC arrives.",
		]);
		const main = describeAction({
			...(SAMPLES.withdraw3 as PlainObject),
			hyperliquidChain: "Mainnet",
		});
		expect(main.headline).toBe(`Withdraw 10 USDC to ${RECIPIENT} on Arbitrum`);
		// not more than the fee: said as the refusal it will be
		expect(
			describeAction({ ...(SAMPLES.withdraw3 as PlainObject), amount: "1" })
				.lines[1],
		).toBe(
			"The bridge's fee is 1 USDC, and Hyperliquid refuses a withdrawal that is not more than that.",
		);
		// an amount that cannot be read: only what is certain
		expect(
			describeAction({ ...(SAMPLES.withdraw3 as PlainObject), amount: 7 })
				.lines,
		).toEqual(["Leaves Hyperliquid through the bridge."]);
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
		expect(sa.headline).toBe(`Send 1 USDC to ${RECIPIENT}`);
		expect(sa.lines).toEqual([
			"taken from the perps balance",
			'arrives in the receiver\'s balance on perp dex "xyz"',
			"token USDC",
			`from sub-account ${A}`,
		]);
		// the usual case: perps or spot on either side, no sub-account, a token with its id
		const plain = describeAction({
			...SAMPLES.sendAsset,
			sourceDex: "spot",
			destinationDex: "",
			token: "USDC:0xeb62eee3685fc4c43992febcd9e75443",
			amount: "12.5",
			fromSubAccount: "",
		} as PlainObject);
		expect(plain.headline).toBe(`Send 12.5 USDC to ${RECIPIENT}`);
		expect(plain.lines).toEqual([
			"taken from the spot balance",
			"arrives in the receiver's perps balance",
			"token USDC:0xeb62eee3685fc4c43992febcd9e75443",
		]);
		expect(
			describeAction({
				...SAMPLES.sendAsset,
				sourceDex: "xyz",
				destinationDex: "spot",
				fromSubAccount: "",
			} as PlainObject).lines.slice(0, 2),
		).toEqual([
			'taken from the balance on perp dex "xyz"',
			"arrives in the receiver's spot balance",
		]);
		// a field that is an integer too large for a number is written out, never thrown on
		expect(
			describeAction({
				type: "sendAsset",
				sourceDex: 12345678901234567890n,
				destinationDex: "spot",
			} as never).lines[0],
		).toBe('taken from the balance on perp dex "12345678901234567890"');
		// fields left out are shown as unknown, never guessed
		const bare = describeAction({ type: "sendAsset" } as PlainObject);
		expect(bare.headline).toBe("Send ? ? to ?");
		expect(bare.lines).toEqual([
			'taken from the balance on perp dex "?"',
			'arrives in the receiver\'s balance on perp dex "?"',
			"token ?",
		]);
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
		// a name is part of what is signed: a character in it that does not
		// show is written out, never dropped
		expect(
			describeAction({
				...SAMPLES.approveAgent,
				agentName: `lab${String.fromCodePoint(0x202e)}`,
			} as PlainObject).headline,
		).toBe(`Approve API wallet ${B} named "lab\\u{202e}"`);
		// the zero address approves nobody: it removes the wallet of that name
		const removal = describeAction({
			...SAMPLES.approveAgent,
			agentAddress: `0x${"0".repeat(40)}`,
		} as PlainObject);
		expect(removal.headline).toBe('Remove the API wallet named "lab"');
		expect(removal.lines[0]).toContain("stops acting for the account");
		expect(removal.flags).toEqual([]);
		// the zero address is no party to it
		expect(removal.parties).toEqual([]);
		expect(
			describeAction({
				...SAMPLES.approveAgent,
				agentAddress: `0x${"0".repeat(40)}`,
				agentName: "",
			} as PlainObject).headline,
		).toBe("Remove the API wallet without a name");
		expect(
			describeAction(SAMPLES.approveBuilderFee as PlainObject).headline,
		).toBe(`Approve builder ${B} up to 0.01%`);
		const stake = describeAction(SAMPLES.tokenDelegate as PlainObject);
		expect(stake.headline).toBe(`Stake 1 HYPE with validator ${B}`);
		// the wait of the network the action names for itself, in one verb
		expect(stake.lines).toEqual([
			"A stake cannot be unstaked for 2 minutes after it is made or added to.",
		]);
		expect(
			describeAction({
				...SAMPLES.tokenDelegate,
				hyperliquidChain: "Mainnet",
			} as PlainObject).lines,
		).toEqual([
			"A stake cannot be unstaked for 1 day after it is made or added to.",
		]);
		// an action that names no network this version knows: both lengths
		const { hyperliquidChain: _, ...nowhere } =
			SAMPLES.tokenDelegate as PlainObject;
		expect(describeAction(nowhere).lines).toEqual([stakeLockupLine(null)]);
		expect(stakeLockupLine(null)).toBe(
			"A stake cannot be unstaked for 1 day after it is made or added to (2 minutes on testnet).",
		);
		const unstake = describeAction({
			...SAMPLES.tokenDelegate,
			isUndelegate: true,
		} as PlainObject);
		expect(unstake.headline).toBe(`Unstake 1 HYPE from validator ${B}`);
		expect(unstake.lines[0]).toContain("separate step");
		expect(describeAction(SAMPLES.cDeposit as PlainObject).headline).toBe(
			"Move 0.00000005 HYPE from the spot balance to the staking balance",
		);
		const back = describeAction(SAMPLES.cWithdraw as PlainObject);
		expect(back.headline).toBe(
			"Return 0.00000005 HYPE from the staking balance to the spot balance",
		);
		expect(back.lines).toEqual([
			"Hyperliquid releases a return to spot 5 minutes after it is carried out, with no further signature.",
		]);
		expect(returnQueueLine("mainnet")).toBe(
			"Hyperliquid releases a return to spot 7 days after it is carried out, with no further signature.",
		);
		expect(returnQueueLine(null)).toBe(
			"Hyperliquid releases a return to spot 7 days after it is carried out (5 minutes on testnet), with no further signature.",
		);
		// an amount that is no whole number is shown as it stands, never guessed
		expect(
			describeAction({ ...SAMPLES.cDeposit, wei: "1.5" } as PlainObject)
				.headline,
		).toBe("Move 1.5 wei of HYPE from the spot balance to the staking balance");
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
		// the measured switches are said in words (see modeSwitch.test.ts)
		expect(
			describeAction(SAMPLES.userSetAbstraction as PlainObject).headline,
		).toBe("Switch to a unified account: one balance");
		expect(
			describeAction({
				...SAMPLES.userSetAbstraction,
				abstraction: "dexAbstraction",
			} as PlainObject).headline,
		).toContain('"dexAbstraction"');
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

describe("describeAction parties", () => {
	const of = (type: string) =>
		describeAction(SAMPLES[type] as PlainObject).parties.map(
			(p) => `${p.role} ${p.address}`,
		);
	const lc = (a: string) => a.toLowerCase();
	it("names every account an action mentions, with what it is to the action", () => {
		expect(of("usdSend")).toEqual([`destination ${lc(RECIPIENT)}`]);
		expect(of("spotSend")).toEqual([`destination ${lc(RECIPIENT)}`]);
		expect(of("withdraw3")).toEqual([`destination ${lc(RECIPIENT)}`]);
		expect(of("sendAsset")).toEqual([
			`destination ${lc(RECIPIENT)}`,
			`subAccount ${lc(A)}`,
		]);
		expect(of("sendToEvmWithData")).toEqual([`destination ${lc(B)}`]);
		expect(of("approveAgent")).toEqual([`agent ${lc(B)}`]);
		expect(of("approveBuilderFee")).toEqual([`builder ${lc(B)}`]);
		expect(of("tokenDelegate")).toEqual([`validator ${lc(B)}`]);
		expect(of("vaultTransfer")).toEqual([`vault ${lc(A)}`]);
		expect(of("subAccountTransfer")).toEqual([`subAccount ${lc(A)}`]);
		expect(of("subAccountSpotTransfer")).toEqual([`subAccount ${lc(A)}`]);
		for (const type of [
			"linkStakingUser",
			"userDexAbstraction",
			"userSetAbstraction",
			"userPortfolioMargin",
		])
			expect(of(type)).toEqual([`user ${lc(B)}`]);
		expect(of("convertToMultiSigUser")).toEqual(
			[A, B].sort().map((a) => `signer ${lc(a)}`),
		);
	});
	it("lists nobody for actions that name no account", () => {
		for (const type of [
			"order",
			"cancel",
			"usdClassTransfer",
			"cDeposit",
			"noop",
			"createSubAccount",
		])
			expect(of(type)).toEqual([]);
		expect(describeAction({ type: "spotDeploy", user: A }).parties).toEqual([]);
		// converting back to a normal user names no signers
		expect(
			describeAction({ type: "convertToMultiSigUser", signers: "null" })
				.parties,
		).toEqual([]);
		expect(
			describeAction({ type: "convertToMultiSigUser", signers: "{" }).parties,
		).toEqual([]);
	});
	it("lists an order's builder, lowercases, and skips what is not an address", () => {
		expect(
			describeAction({ ...ORDER, builder: { b: B, f: 10 } }).parties,
		).toEqual([{ role: "builder", address: lc(B) }]);
		expect(
			describeAction({
				type: "usdSend",
				destination: RECIPIENT.toUpperCase().replace("0X", "0x"),
				amount: "1",
			}).parties,
		).toEqual([{ role: "destination", address: lc(RECIPIENT) }]);
		for (const destination of ["0x123", `${RECIPIENT}00`, 5, null, undefined])
			expect(
				describeAction({
					type: "usdSend",
					destination: destination as never,
					amount: "1",
				}).parties,
			).toEqual([]);
		// a sub-account sending to itself is one account in two roles; the same role twice is one entry
		expect(
			describeAction({
				type: "sendAsset",
				destination: A,
				fromSubAccount: A,
			}).parties.map((p) => p.role),
		).toEqual(["destination", "subAccount"]);
		expect(
			describeAction({
				type: "convertToMultiSigUser",
				signers: JSON.stringify({ authorizedUsers: [A, A], threshold: 1 }),
			}).parties,
		).toEqual([{ role: "signer", address: lc(A) }]);
	});
});
