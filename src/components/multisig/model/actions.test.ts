import {
	accountMode,
	createProposal,
	hasErrors,
	type Issue,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	A,
	B,
	NONCE,
	NOW,
	OUTSIDER,
	POLICY,
	RECIPIENT,
	TREASURY,
} from "#/test/keys";
import {
	ACTION_KINDS,
	type ActionForm,
	actionTypeOf,
	arrivalPocket,
	type BuildContext,
	buildAction,
	buildProposalInput,
	DEFAULT_FORM,
	destinationOf,
	fieldOf,
	formFromAction,
	sourcePocket,
} from "./actions";

const PURR = {
	name: "PURR",
	tokenId: "0xc4bf3f870c0e9465323c0b6ed28096c2",
	weiDecimals: 5,
};
const USDC = {
	name: "USDC",
	tokenId: "0xeb62eee3685fc4c43992febcd9e75443",
	weiDecimals: 8,
};
const USDC_ID = `USDC:${USDC.tokenId}`;
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({
	network: "testnet",
	multiSigUser: TREASURY,
	nonce: NONCE,
	signatureChainId: "0x3e6",
	policyAtCreation: POLICY,
	tokens: [PURR, USDC],
	...over,
});
const UNIFIED = accountMode("unifiedAccount");
const MANUAL = accountMode("default");
const form = (over: Partial<ActionForm>): ActionForm => ({
	...DEFAULT_FORM,
	finaliser: B,
	...over,
});
const codes = (issues: readonly Issue[]) => issues.map((i) => i.code);
const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
const UPPER = `0x${RECIPIENT.slice(2).toUpperCase()}`;

const VALID: Record<string, { form: ActionForm; action: object }> = {
	sendUsdc: {
		form: form({ kind: "sendUsdc", destination: UPPER, amount: "1.0" }),
		action: {
			type: "sendAsset",
			...HEAD,
			destination: RECIPIENT,
			sourceDex: "",
			destinationDex: "",
			token: USDC_ID,
			amount: "1",
			fromSubAccount: "",
			nonce: NONCE,
		},
	},
	"sendUsdc from spot into spot": {
		form: form({
			kind: "sendUsdc",
			destination: RECIPIENT,
			amount: "2.5",
			fromPocket: "spot",
			toPocket: "spot",
		}),
		action: {
			type: "sendAsset",
			...HEAD,
			destination: RECIPIENT,
			sourceDex: "spot",
			destinationDex: "spot",
			token: USDC_ID,
			amount: "2.5",
			fromSubAccount: "",
			nonce: NONCE,
		},
	},
	"sendUsdc from spot into perps": {
		form: form({
			kind: "sendUsdc",
			destination: RECIPIENT,
			amount: "3",
			fromPocket: "spot",
			toPocket: "perps",
		}),
		action: {
			type: "sendAsset",
			...HEAD,
			destination: RECIPIENT,
			sourceDex: "spot",
			destinationDex: "",
			token: USDC_ID,
			amount: "3",
			fromSubAccount: "",
			nonce: NONCE,
		},
	},
	withdraw3: {
		form: form({ kind: "withdraw3", destination: RECIPIENT, amount: "12.5" }),
		action: {
			type: "withdraw3",
			...HEAD,
			destination: RECIPIENT,
			amount: "12.5",
			time: NONCE,
		},
	},
	sendToken: {
		form: form({
			kind: "sendToken",
			destination: RECIPIENT,
			token: `PURR:${PURR.tokenId}`,
			amount: "0.00001",
		}),
		action: {
			type: "sendAsset",
			...HEAD,
			destination: RECIPIENT,
			sourceDex: "spot",
			destinationDex: "spot",
			token: `PURR:${PURR.tokenId}`,
			amount: "0.00001",
			fromSubAccount: "",
			nonce: NONCE,
		},
	},
	"usdClassTransfer to perps": {
		form: form({ kind: "usdClassTransfer", amount: "5", toPerp: "perp" }),
		action: {
			type: "usdClassTransfer",
			...HEAD,
			amount: "5",
			toPerp: true,
			nonce: NONCE,
		},
	},
	"usdClassTransfer to spot": {
		form: form({ kind: "usdClassTransfer", amount: "5", toPerp: "spot" }),
		action: {
			type: "usdClassTransfer",
			...HEAD,
			amount: "5",
			toPerp: false,
			nonce: NONCE,
		},
	},
	"approveAgent unnamed": {
		form: form({ kind: "approveAgent", agentAddress: UPPER }),
		action: {
			type: "approveAgent",
			...HEAD,
			agentAddress: RECIPIENT,
			agentName: "",
			nonce: NONCE,
		},
	},
	"approveAgent named": {
		form: form({
			kind: "approveAgent",
			agentAddress: RECIPIENT,
			agentName: " bot ",
		}),
		action: {
			type: "approveAgent",
			...HEAD,
			agentAddress: RECIPIENT,
			agentName: "bot",
			nonce: NONCE,
		},
	},
	"raw approveBuilderFee": {
		form: form({
			kind: "raw",
			raw: JSON.stringify({
				type: "approveBuilderFee",
				maxFeeRate: "0.001%",
				builder: RECIPIENT,
			}),
		}),
		action: {
			type: "approveBuilderFee",
			maxFeeRate: "0.001%",
			builder: RECIPIENT,
			...HEAD,
			nonce: NONCE,
		},
	},
};

describe("buildAction / buildProposalInput", () => {
	it("lists the six kinds once each", () => {
		expect(ACTION_KINDS.map((k) => k.kind)).toEqual([
			"sendUsdc",
			"sendToken",
			"usdClassTransfer",
			"withdraw3",
			"approveAgent",
			"raw",
		]);
	});

	for (const [name, v] of Object.entries(VALID)) {
		it(`${name}: builds the action and the core accepts it`, () => {
			const draft = buildProposalInput(v.form, ctx());
			expect(draft.issues.filter((i) => i.severity !== "info")).toEqual([]);
			expect(draft.action).toEqual(v.action);
			expect(draft.input).toMatchObject({
				network: "testnet",
				multiSigUser: TREASURY,
				outerSigner: B,
				nonce: NONCE,
				vaultAddress: null,
				expiresAfter: null,
				policyAtCreation: POLICY,
			});
			if (!draft.input) throw new Error("no input");
			const created = createProposal(draft.input, { now: NOW });
			expect(hasErrors(created.issues)).toBe(false);
			expect(created.proposal?.meta.kind).toBe("user-signed");
			expect(created.proposal?.payload.outerSigner).toBe(B);
		});
	}

	it("carries title, note, proposer and the superseded digest", () => {
		const digest = `0x${"ab".repeat(32)}` as const;
		const draft = buildProposalInput(
			form({ ...VALID.sendUsdc?.form, title: " rent ", note: "" }),
			ctx({
				createdBy: A.toUpperCase().replace("0X", "0x"),
				supersedes: digest,
			}),
		);
		expect(draft.input).toMatchObject({
			title: "rent",
			note: null,
			createdBy: A,
			supersedes: digest,
		});
		const bare = buildProposalInput(
			form({ ...VALID.sendUsdc?.form }),
			ctx({ policyAtCreation: undefined }),
		);
		expect(bare.input).toMatchObject({
			title: null,
			createdBy: null,
			supersedes: null,
			policyAtCreation: null,
		});
	});

	it("writes amounts canonically and never rounds", () => {
		const amount = (a: string, c = ctx()) =>
			buildAction(
				form({ kind: "sendUsdc", destination: RECIPIENT, amount: a }),
				c,
			);
		expect((amount("1.0").action as { amount: string }).amount).toBe("1");
		expect((amount(" 2.50 ").action as { amount: string }).amount).toBe("2.5");
		expect((amount("+3").action as { amount: string }).amount).toBe("3");
		expect((amount("0.000001").action as { amount: string }).amount).toBe(
			"0.000001",
		);
		for (const [a, code] of [
			["", "field.required"],
			["abc", "amount.invalid"],
			["1e3", "amount.invalid"],
			["1,5", "amount.invalid"],
			["-1", "amount.not_positive"],
			["0", "amount.not_positive"],
			["1.0000001", "amount.precision"],
		] as const) {
			const r = amount(a);
			expect(codes(r.issues), a).toEqual([code]);
			expect(r.action).toBeNull();
			expect(fieldOf(r.issues[0] as Issue)).toBe("amount");
		}
	});

	it("checks addresses and flags a send to the account itself", () => {
		const send = (destination: string) =>
			buildAction(form({ kind: "sendUsdc", destination, amount: "1" }), ctx());
		expect(codes(send("").issues)).toEqual(["field.required"]);
		expect(codes(send("0x1234").issues)).toEqual(["address.invalid"]);
		expect(
			codes(send("51d3aaa37dc88af4d4ef846629e7e7f201b47fd9").issues),
		).toEqual(["address.invalid"]);
		const self = send(TREASURY.toUpperCase().replace("0X", "0x"));
		expect(codes(self.issues)).toEqual(["action.self_send"]);
		expect(self.action).not.toBeNull();
		const agent = buildAction(
			form({ kind: "approveAgent", agentAddress: TREASURY }),
			ctx(),
		);
		expect(codes(agent.issues)).toEqual(["agent.self"]);
		expect(agent.action).toBeNull();
	});

	it("checks the spot token against the network's list and its decimals", () => {
		const spot = (over: Partial<ActionForm>, c = ctx()) =>
			buildAction(
				form({
					kind: "sendToken",
					destination: RECIPIENT,
					token: `PURR:${PURR.tokenId}`,
					amount: "1",
					...over,
				}),
				c,
			);
		expect(codes(spot({ token: "" }).issues)).toEqual(["field.required"]);
		expect(codes(spot({ token: "PURR" }).issues)).toEqual(["token.invalid"]);
		expect(codes(spot({ token: `NOPE:0x${"0".repeat(32)}` }).issues)).toEqual([
			"token.unknown",
		]);
		expect(codes(spot({ amount: "0.000001" }).issues)).toEqual([
			"amount.precision",
		]);
		// without a token list the id is taken as written and 8 decimals are allowed
		const blind = spot(
			{ token: `NOPE:0x${"0".repeat(32)}`, amount: "0.00000001" },
			ctx({ tokens: undefined }),
		);
		expect(blind.issues).toEqual([]);
		expect((blind.action as { amount: string }).amount).toBe("0.00000001");
	});

	it("warns, never blocks, when the amount exceeds an observed balance", () => {
		const balances = {
			perpWithdrawable: "25",
			spot: [
				{ coin: "USDC", total: "5.0" },
				{ coin: "PURR", total: "2" },
			],
		};
		const c = ctx({ balances });
		const over = (f: Partial<ActionForm>) => buildProposalInput(form(f), c);
		for (const f of [
			{ kind: "sendUsdc", destination: RECIPIENT, amount: "30" },
			{ kind: "withdraw3", destination: RECIPIENT, amount: "25.000001" },
			{ kind: "usdClassTransfer", amount: "6", toPerp: "perp" },
			{ kind: "usdClassTransfer", amount: "26", toPerp: "spot" },
			{
				kind: "sendToken",
				destination: RECIPIENT,
				token: `PURR:${PURR.tokenId}`,
				amount: "3",
			},
		] as Partial<ActionForm>[]) {
			const r = over(f);
			expect(codes(r.issues), JSON.stringify(f)).toEqual([
				"amount.exceeds_balance",
			]);
			expect(r.issues[0]?.severity).toBe("warning");
			expect(r.input).not.toBeNull();
		}
		expect(
			over({ kind: "sendUsdc", destination: RECIPIENT, amount: "25" }).issues,
		).toEqual([]);
		// an unreadable or absent balance says nothing
		expect(
			buildAction(
				form({ kind: "sendUsdc", destination: RECIPIENT, amount: "99" }),
				ctx({ balances: { perpWithdrawable: "n/a" } }),
			).issues,
		).toEqual([]);
		expect(
			buildAction(
				form({
					kind: "sendToken",
					destination: RECIPIENT,
					token: `PURR:${PURR.tokenId}`,
					amount: "99",
				}),
				ctx({ balances: { spot: [] } }),
			).issues,
		).toEqual([]);
	});

	it("accepts only user-signed actions as raw JSON", () => {
		const raw = (text: string) =>
			buildAction(form({ kind: "raw", raw: text }), ctx());
		for (const [text, code] of [
			["", "field.required"],
			["{not json", "raw.invalid"],
			["[1]", "raw.not_object"],
			["7", "raw.not_object"],
			['{"a":1}', "raw.no_type"],
			['{"type":"multiSig"}', "raw.nested_envelope"],
			['{"type":"order","orders":[],"grouping":"na"}', "raw.l1_out_of_scope"],
			['{"type":"noop"}', "raw.l1_out_of_scope"],
			[
				'{"type":"convertToMultiSigUser","signers":"null"}',
				"raw.convert_out_of_scope",
			],
		] as const) {
			const r = raw(text);
			expect(codes(r.issues), text).toEqual([code]);
			expect(r.action).toBeNull();
			expect(fieldOf(r.issues[0] as Issue)).toBe("raw");
		}
		// what this page sets replaces what was pasted, and says so
		const pasted = raw(
			JSON.stringify({
				type: "usdSend",
				signatureChainId: "0x66eee",
				hyperliquidChain: "Mainnet",
				destination: RECIPIENT,
				amount: "1",
				time: 5,
			}),
		);
		expect(codes(pasted.issues)).toEqual(["raw.field_overridden"]);
		expect(pasted.issues[0]?.message).toContain(
			"signatureChainId, hyperliquidChain, time are set by this page",
		);
		expect(pasted.action).toMatchObject({ ...HEAD, time: NONCE });
		const one = raw(
			JSON.stringify({
				type: "approveBuilderFee",
				maxFeeRate: "1%",
				builder: RECIPIENT,
				nonce: 1,
			}),
		);
		expect(one.issues[0]?.message).toContain("nonce is set by this page");
		// the same values as this page would set are not an override
		expect(
			raw(
				JSON.stringify({
					type: "usdSend",
					...HEAD,
					destination: RECIPIENT,
					amount: "1",
					time: NONCE,
				}),
			).issues,
		).toEqual([]);
	});

	it("requires a finaliser from the current signer set", () => {
		const f = (finaliser: string, c = ctx()) =>
			buildProposalInput(form({ ...VALID.sendUsdc?.form, finaliser }), c);
		for (const [who, code] of [
			["", "finaliser.required"],
			["0x12", "address.invalid"],
			[OUTSIDER, "finaliser.not_signer"],
		] as const) {
			const r = f(who);
			expect(codes(r.issues)).toEqual([code]);
			expect(r.input).toBeNull();
			expect(r.action).not.toBeNull();
			expect(fieldOf(r.issues[0] as Issue)).toBe("finaliser");
		}
		expect(
			f(` ${A.toUpperCase().replace("0X", "0x")} `).input?.outerSigner,
		).toBe(A);
		// without a known signer set the choice cannot be checked here; the chain decides
		expect(
			f(OUTSIDER, ctx({ policyAtCreation: null })).input?.outerSigner,
		).toBe(OUTSIDER);
		// an action that does not build leaves no input even with a good finaliser
		expect(
			buildProposalInput(form({ kind: "sendUsdc", amount: "1" }), ctx()).input,
		).toBeNull();
	});
});

describe("where a USDC send is taken from and where it arrives", () => {
	const usdc = (total: string, hold = "0") => ({ coin: "USDC", total, hold });
	it("a manual treasury sends from the pocket that holds the money, perps when both do", () => {
		const auto = (perpWithdrawable?: string, spot?: string) =>
			sourcePocket(
				{ fromPocket: "auto" },
				{
					mode: MANUAL,
					balances: { perpWithdrawable, spot: spot ? [usdc(spot)] : [] },
				},
			);
		expect(auto("10", "5")).toBe("perps");
		expect(auto("10", undefined)).toBe("perps");
		expect(auto("0", "5")).toBe("spot");
		expect(auto("0.0", "5")).toBe("spot");
		// nothing known, or nothing anywhere: perps, as a USDC send always was
		expect(auto(undefined, undefined)).toBe("perps");
		expect(auto("0", "0")).toBe("perps");
		expect(sourcePocket({ fromPocket: "auto" }, {})).toBe("perps");
		// spot money that is all on hold is not money that can be sent
		expect(
			sourcePocket(
				{ fromPocket: "auto" },
				{ balances: { perpWithdrawable: "0", spot: [usdc("5", "5")] } },
			),
		).toBe("perps");
	});
	it("the form's choice wins for a manual treasury, and a unified one has only one balance", () => {
		const balances = { perpWithdrawable: "10", spot: [usdc("5")] };
		expect(
			sourcePocket({ fromPocket: "spot" }, { mode: MANUAL, balances }),
		).toBe("spot");
		expect(sourcePocket({ fromPocket: "perps" }, { balances })).toBe("perps");
		for (const fromPocket of ["auto", "perps", "spot"] as const)
			expect(sourcePocket({ fromPocket }, { mode: UNIFIED, balances })).toBe(
				"spot",
			);
	});
	it("arrives in the pocket named, or in a unified receiver's one balance", () => {
		expect(arrivalPocket({ toPocket: "perps" }, {})).toBe("perps");
		expect(
			arrivalPocket(
				{ toPocket: "spot" },
				{ receiver: { status: "active", mode: MANUAL } },
			),
		).toBe("spot");
		expect(
			arrivalPocket(
				{ toPocket: "perps" },
				{ receiver: { status: "active", mode: UNIFIED } },
			),
		).toBe("spot");
		expect(
			arrivalPocket(
				{ toPocket: "perps" },
				{ receiver: { status: "new", mode: null } },
			),
		).toBe("perps");
	});
	it("builds the action accordingly", () => {
		const built = (c: Partial<BuildContext>, f: Partial<ActionForm> = {}) =>
			buildAction(
				form({ kind: "sendUsdc", destination: RECIPIENT, amount: "1", ...f }),
				ctx(c),
			).action as { sourceDex: string; destinationDex: string };
		// a unified treasury: from its one balance, whatever the form says
		expect(built({ mode: UNIFIED }, { fromPocket: "perps" })).toMatchObject({
			sourceDex: "spot",
			destinationDex: "",
		});
		// a unified receiver: named as spot
		expect(
			built({ receiver: { status: "active", mode: UNIFIED } }),
		).toMatchObject({ sourceDex: "", destinationDex: "spot" });
		// money only in spot: sent from there without being told
		expect(
			built({
				mode: MANUAL,
				balances: { perpWithdrawable: "0", spot: [usdc("9")] },
			}),
		).toMatchObject({ sourceDex: "spot", destinationDex: "" });
	});
	it("needs the token list to name USDC by its id", () => {
		const r = buildAction(
			form({ kind: "sendUsdc", destination: RECIPIENT, amount: "1" }),
			ctx({ tokens: undefined }),
		);
		expect(codes(r.issues)).toEqual(["token.list_missing"]);
		expect(r.action).toBeNull();
		// shown with the general notes: this form has no token field
		expect(fieldOf(r.issues[0] as Issue)).toBeNull();
	});
});

describe("what the treasury's mode and a new receiver make of an action", () => {
	const send = (c: Partial<BuildContext>, f: Partial<ActionForm> = {}) =>
		buildAction(
			form({ kind: "sendUsdc", destination: RECIPIENT, amount: "5", ...f }),
			ctx(c),
		);
	const raw = (action: object, c: Partial<BuildContext>) =>
		buildAction(form({ kind: "raw", raw: JSON.stringify(action) }), ctx(c));
	const real = (issues: readonly Issue[]) =>
		codes(issues.filter((i) => i.severity !== "info"));

	it("a unified treasury has nothing to move between perps and spot", () => {
		const r = buildAction(
			form({ kind: "usdClassTransfer", amount: "5" }),
			ctx({ mode: UNIFIED }),
		);
		expect(codes(r.issues)).toEqual(["mode.one_balance"]);
		expect(r.action).toBeNull();
		// shown with the general notes: the form has no field for it
		expect(fieldOf(r.issues[0] as Issue)).toBeNull();
		expect(
			buildAction(
				form({ kind: "usdClassTransfer", amount: "5" }),
				ctx({ mode: MANUAL }),
			).issues,
		).toEqual([]);
	});
	it("warns when raw JSON names something a unified treasury is refused", () => {
		const usdSend = { type: "usdSend", destination: RECIPIENT, amount: "5" };
		expect(real(raw(usdSend, { mode: UNIFIED }).issues)).toEqual([
			"mode.refuses",
		]);
		expect(raw(usdSend, { mode: UNIFIED }).action).not.toBeNull();
		expect(real(raw(usdSend, { mode: MANUAL }).issues)).toEqual([]);
		expect(real(raw(usdSend, {}).issues)).toEqual([]);
		const fromPerps = {
			type: "sendAsset",
			destination: RECIPIENT,
			sourceDex: "",
			destinationDex: "spot",
			token: USDC_ID,
			amount: "5",
			fromSubAccount: "",
		};
		const r = raw(fromPerps, { mode: UNIFIED });
		expect(real(r.issues)).toEqual(["mode.refuses"]);
		expect(r.issues.find((i) => i.code === "mode.refuses")?.message).toContain(
			"one balance",
		);
		// the guided send never trips it
		expect(send({ mode: UNIFIED }).issues).toEqual([]);
	});
	it("warns when a token that is not USDC is sent into perps", () => {
		const r = raw(
			{
				type: "sendAsset",
				destination: RECIPIENT,
				sourceDex: "spot",
				destinationDex: "",
				token: `PURR:${PURR.tokenId}`,
				amount: "1",
				fromSubAccount: "",
			},
			{ mode: MANUAL },
		);
		expect(real(r.issues)).toEqual(["token.not_collateral"]);
	});
	it("a new receiver costs 1 USDC on top: warns when the balances cannot cover both", () => {
		const fresh = { status: "new", mode: null } as const;
		const held = (perps: string, spot: string) => ({
			perpWithdrawable: perps,
			spot: [{ coin: "USDC", total: spot, hold: "0" }],
		});
		// 5 from perps, the fee from spot
		expect(send({ receiver: fresh, balances: held("5", "1") }).issues).toEqual(
			[],
		);
		// 5 from perps, spot too small: the fee from perps too
		expect(
			send({ receiver: fresh, balances: held("6", "0.5") }).issues,
		).toEqual([]);
		const short = send({ receiver: fresh, balances: held("5.5", "0.5") });
		expect(codes(short.issues)).toEqual(["fee.not_covered"]);
		expect(short.issues[0]?.severity).toBe("warning");
		expect(short.action).not.toBeNull();
		// the same balances and an address in use: nothing to say
		expect(
			send({
				receiver: { status: "active", mode: MANUAL },
				balances: held("5.5", "0.5"),
			}).issues,
		).toEqual([]);
		// balances not known: nothing is claimed
		expect(send({ receiver: fresh }).issues).toEqual([]);
		// an older send written by hand pays the fee out of the amount
		const tiny = raw(
			{ type: "usdSend", destination: RECIPIENT, amount: "1" },
			{ receiver: fresh, balances: held("50", "50") },
		);
		expect(real(tiny.issues)).toEqual(["fee.below"]);
	});
});

describe("destinationOf: the account whose being new decides the fee", () => {
	it("is the destination of a send, once it is a whole address", () => {
		const of = (f: Partial<ActionForm>) => destinationOf(form(f));
		expect(of({ kind: "sendUsdc", destination: ` ${UPPER} ` })).toBe(RECIPIENT);
		expect(of({ kind: "sendToken", destination: RECIPIENT })).toBe(RECIPIENT);
		expect(of({ kind: "sendUsdc", destination: "0x1234" })).toBeNull();
		expect(of({ kind: "sendUsdc", destination: "" })).toBeNull();
		for (const type of ["usdSend", "spotSend", "sendAsset"])
			expect(
				of({ kind: "raw", raw: JSON.stringify({ type, destination: UPPER }) }),
			).toBe(RECIPIENT);
	});
	it("is nobody for what does not pay a Hyperliquid account", () => {
		const of = (f: Partial<ActionForm>) => destinationOf(form(f));
		// a withdrawal names an address on Arbitrum
		expect(of({ kind: "withdraw3", destination: RECIPIENT })).toBeNull();
		expect(
			of({
				kind: "raw",
				raw: JSON.stringify({ type: "withdraw3", destination: RECIPIENT }),
			}),
		).toBeNull();
		expect(of({ kind: "usdClassTransfer" })).toBeNull();
		expect(of({ kind: "approveAgent", agentAddress: RECIPIENT })).toBeNull();
		for (const raw of ["", "nope", "[]", '{"type":"usdSend"}'])
			expect(of({ kind: "raw", raw })).toBeNull();
	});
	it("a form that does not build yet still gives a sketch to say the cost from", () => {
		const r = buildProposalInput(
			form({ kind: "sendUsdc", destination: RECIPIENT, amount: "" }),
			ctx(),
		);
		expect(r.action).toBeNull();
		expect(r.sketch).toMatchObject({
			type: "sendAsset",
			destination: RECIPIENT,
			amount: "",
		});
		const whole = buildProposalInput(
			form({ kind: "sendUsdc", destination: RECIPIENT, amount: "2" }),
			ctx(),
		);
		expect(whole.sketch).toEqual(whole.action);
	});
});

describe("actionTypeOf", () => {
	it("is known before the action can be built", () => {
		const of = (f: Partial<ActionForm>) => actionTypeOf(form(f));
		expect(of({ kind: "sendUsdc" })).toBe("sendAsset");
		expect(of({ kind: "sendToken" })).toBe("sendAsset");
		expect(of({ kind: "withdraw3" })).toBe("withdraw3");
		expect(of({ kind: "usdClassTransfer" })).toBe("usdClassTransfer");
		expect(of({ kind: "approveAgent" })).toBe("approveAgent");
		expect(of({ kind: "raw", raw: ' {"type":"usdSend","amount":"1"} ' })).toBe(
			"usdSend",
		);
		for (const raw of ["", "not json", "[1]", "7", '{"type":5}', "{}"])
			expect(of({ kind: "raw", raw }), raw).toBeNull();
	});
});

describe("formFromAction: the older ways of sending come back as the send that replaces them", () => {
	const refill = (action: object) => formFromAction(action as never, "testnet");
	it("a usdSend becomes Send USDC from perps into perps", () => {
		expect(
			refill({ type: "usdSend", destination: RECIPIENT, amount: "12.5" }),
		).toEqual({
			kind: "sendUsdc",
			destination: RECIPIENT,
			amount: "12.5",
			fromPocket: "perps",
			toPocket: "perps",
		});
	});
	it("a spotSend becomes Send USDC from spot into spot, or Send spot token", () => {
		expect(
			refill({
				type: "spotSend",
				destination: RECIPIENT,
				token: USDC_ID,
				amount: "3",
			}),
		).toMatchObject({ kind: "sendUsdc", fromPocket: "spot", toPocket: "spot" });
		expect(
			refill({
				type: "spotSend",
				destination: RECIPIENT,
				token: `PURR:${PURR.tokenId}`,
				amount: "3",
			}),
		).toEqual({
			kind: "sendToken",
			destination: RECIPIENT,
			token: `PURR:${PURR.tokenId}`,
			amount: "3",
		});
	});
	it("a sendAsset the two forms cannot express stays raw JSON", () => {
		const asset = {
			type: "sendAsset",
			destination: RECIPIENT,
			sourceDex: "",
			destinationDex: "spot",
			token: USDC_ID,
			amount: "1",
			fromSubAccount: "",
			nonce: 5,
		};
		expect(refill(asset)).toMatchObject({
			kind: "sendUsdc",
			fromPocket: "perps",
			toPocket: "spot",
		});
		for (const odd of [
			{ ...asset, destinationDex: "xyz" },
			{ ...asset, sourceDex: "xyz" },
			{ ...asset, fromSubAccount: A },
			// another token can only go spot to spot
			{ ...asset, token: `PURR:${PURR.tokenId}` },
		]) {
			const f = refill(odd);
			expect(f.kind, JSON.stringify(odd)).toBe("raw");
			expect(f.raw).toContain('"type": "sendAsset"');
			expect(f.raw).not.toContain("nonce");
		}
	});
});

describe("formFromAction", () => {
	for (const [name, v] of Object.entries(VALID)) {
		it(`${name}: pre-fills a form that rebuilds the same action`, () => {
			const built = buildAction(v.form, ctx()).action;
			if (!built) throw new Error("fixture does not build");
			const refill = {
				...DEFAULT_FORM,
				finaliser: B,
				...formFromAction(built, "testnet"),
			};
			expect(refill.chain).toBe("hyperevm");
			expect(buildAction(refill, ctx()).action).toEqual(built);
			expect(
				buildAction(refill, ctx()).issues.filter(
					(i) => i.code === "raw.field_overridden",
				),
			).toEqual([]);
		});
	}

	it("recognises the signing chain only when it is one of the two offered", () => {
		const a = {
			type: "usdSend",
			signatureChainId: "0xa4b1",
			destination: RECIPIENT,
			amount: "1",
		};
		expect(formFromAction(a, "mainnet").chain).toBe("arbitrum");
		expect(
			"chain" in formFromAction({ ...a, signatureChainId: "0x1" }, "mainnet"),
		).toBe(false);
		expect("chain" in formFromAction({ type: "usdSend" }, "testnet")).toBe(
			false,
		);
		// missing fields become empty strings; an unknown type becomes raw JSON
		expect(formFromAction({ type: "spotSend" }, "testnet")).toMatchObject({
			kind: "sendToken",
			destination: "",
			token: "",
			amount: "",
		});
		expect(formFromAction({ type: "withdraw3" }, "testnet")).toEqual({
			kind: "withdraw3",
			destination: "",
			amount: "",
		});
		expect(
			formFromAction({ type: "mystery", x: 1, nonce: 2 }, "testnet"),
		).toEqual({
			kind: "raw",
			raw: '{\n  "type": "mystery",\n  "x": 1\n}',
		});
		expect(formFromAction({ x: 1 }, "testnet").kind).toBe("raw");
	});
});

describe("fieldOf", () => {
	it("maps issue paths to form fields", () => {
		const at = (path?: string) =>
			fieldOf({ code: "x", severity: "error", message: "", path });
		expect(at("action.destination")).toBe("destination");
		expect(at("action.amount")).toBe("amount");
		expect(at("action.token")).toBe("token");
		expect(at("action.agentAddress")).toBe("agentAddress");
		expect(at("action.agentName")).toBe("agentName");
		expect(at("action")).toBe("raw");
		expect(at("action.type")).toBe("raw");
		expect(at("payload.outerSigner")).toBe("finaliser");
		expect(at("payload.nonce")).toBeNull();
		expect(at(undefined)).toBeNull();
	});
});
