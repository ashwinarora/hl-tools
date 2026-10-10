import { createProposal, hasErrors, type Issue } from "@hl-tools/core";
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
	type BuildContext,
	buildAction,
	buildProposalInput,
	DEFAULT_FORM,
	fieldOf,
	formFromAction,
} from "./actions";

const PURR = {
	name: "PURR",
	tokenId: "0xc4bf3f870c0e9465323c0b6ed28096c2",
	weiDecimals: 5,
};
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({
	network: "testnet",
	multiSigUser: TREASURY,
	nonce: NONCE,
	signatureChainId: "0x3e6",
	policyAtCreation: POLICY,
	tokens: [PURR],
	...over,
});
const form = (over: Partial<ActionForm>): ActionForm => ({
	...DEFAULT_FORM,
	finaliser: B,
	...over,
});
const codes = (issues: readonly Issue[]) => issues.map((i) => i.code);
const HEAD = { signatureChainId: "0x3e6", hyperliquidChain: "Testnet" };
const UPPER = `0x${RECIPIENT.slice(2).toUpperCase()}`;

const VALID: Record<string, { form: ActionForm; action: object }> = {
	usdSend: {
		form: form({ kind: "usdSend", destination: UPPER, amount: "1.0" }),
		action: {
			type: "usdSend",
			...HEAD,
			destination: RECIPIENT,
			amount: "1",
			time: NONCE,
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
	spotSend: {
		form: form({
			kind: "spotSend",
			destination: RECIPIENT,
			token: `PURR:${PURR.tokenId}`,
			amount: "0.00001",
		}),
		action: {
			type: "spotSend",
			...HEAD,
			destination: RECIPIENT,
			token: `PURR:${PURR.tokenId}`,
			amount: "0.00001",
			time: NONCE,
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
			"usdSend",
			"spotSend",
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
			form({ ...VALID.usdSend?.form, title: " rent ", note: "" }),
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
			form({ ...VALID.usdSend?.form }),
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
				form({ kind: "usdSend", destination: RECIPIENT, amount: a }),
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
			buildAction(form({ kind: "usdSend", destination, amount: "1" }), ctx());
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
					kind: "spotSend",
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
			{ kind: "usdSend", destination: RECIPIENT, amount: "30" },
			{ kind: "withdraw3", destination: RECIPIENT, amount: "25.000001" },
			{ kind: "usdClassTransfer", amount: "6", toPerp: "perp" },
			{ kind: "usdClassTransfer", amount: "26", toPerp: "spot" },
			{
				kind: "spotSend",
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
			over({ kind: "usdSend", destination: RECIPIENT, amount: "25" }).issues,
		).toEqual([]);
		// an unreadable or absent balance says nothing
		expect(
			buildAction(
				form({ kind: "usdSend", destination: RECIPIENT, amount: "99" }),
				ctx({ balances: { perpWithdrawable: "n/a" } }),
			).issues,
		).toEqual([]);
		expect(
			buildAction(
				form({
					kind: "spotSend",
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
			buildProposalInput(form({ ...VALID.usdSend?.form, finaliser }), c);
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
			buildProposalInput(form({ kind: "usdSend", amount: "1" }), ctx()).input,
		).toBeNull();
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
			kind: "spotSend",
			destination: "",
			token: "",
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
