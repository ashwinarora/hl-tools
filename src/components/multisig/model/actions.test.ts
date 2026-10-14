import {
	accountMode,
	createProposal,
	hasErrors,
	type Issue,
	judgeMove,
	type PlainObject,
	type Proposal,
	parseVaultDetails,
	tieSteps,
	type Validator,
} from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	A,
	B,
	C,
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
	buildProposalInputs,
	DEFAULT_FORM,
	destinationOf,
	fieldOf,
	formFromAction,
	formFromMove,
	formFromProposal,
	modeTargetFor,
	REMOVE_AGENT,
	sourcePocket,
	wholeMove,
} from "./actions";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import { type SignerCheck, signersField } from "./signerSet";
import type { StakingRead } from "./staking";

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
const ZERO = "0x0000000000000000000000000000000000000000";

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
	"removeAgent named": {
		form: form({ kind: "removeAgent", removeAgent: "lab" }),
		action: {
			type: "approveAgent",
			...HEAD,
			agentAddress: ZERO,
			agentName: "lab",
			nonce: NONCE,
		},
	},
	"removeAgent unnamed": {
		form: form({ kind: "removeAgent", removeAgent: "" }),
		action: {
			type: "approveAgent",
			...HEAD,
			agentAddress: ZERO,
			agentName: "",
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
	"changeSigners: another number": {
		form: form({
			kind: "changeSigners",
			signers: signersField(POLICY.authorizedUsers, 3),
		}),
		action: {
			type: "convertToMultiSigUser",
			...HEAD,
			signers: JSON.stringify({
				authorizedUsers: POLICY.authorizedUsers,
				threshold: 3,
			}),
			nonce: NONCE,
		},
	},
	"changeSigners: back to a normal account": {
		form: form({ kind: "changeSigners", signers: "null" }),
		action: {
			type: "convertToMultiSigUser",
			...HEAD,
			signers: "null",
			nonce: NONCE,
		},
	},
};

describe("buildAction / buildProposalInput", () => {
	it("lists the fourteen kinds once each, the staking forms and the vault forms as one group each", () => {
		expect(ACTION_KINDS.map((k) => k.kind)).toEqual([
			"sendUsdc",
			"sendToken",
			"usdClassTransfer",
			"withdraw3",
			"approveAgent",
			"removeAgent",
			"accountMode",
			"changeSigners",
			"stake",
			"returnToSpot",
			"moveStake",
			"vaultDeposit",
			"vaultWithdraw",
			"raw",
		]);
		expect(
			ACTION_KINDS.filter((k) => k.group === "staking").map((k) => k.label),
		).toEqual(["Stake", "Return to spot", "Move to another validator"]);
		expect(
			ACTION_KINDS.filter((k) => k.group === "vault").map((k) => k.label),
		).toEqual(["Deposit", "Withdraw"]);
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

	it("stops a send to one of HyperEVM's own addresses, in both send forms and in Raw JSON", () => {
		const HYPE_SYSTEM = "0x2222222222222222222222222222222222222222";
		const usdc = buildAction(
			form({ kind: "sendUsdc", destination: HYPE_SYSTEM, amount: "1" }),
			// also for a receiver the look-up called new: no fee line beside it
			ctx({ receiver: { status: "new", mode: null } }),
		);
		expect(codes(usdc.issues)).toEqual(["action.to_hyperevm"]);
		expect(usdc.action).toBeNull();
		expect(usdc.issues[0]?.severity).toBe("error");
		expect(usdc.issues[0]?.message).toContain("HyperEVM");
		expect(fieldOf(usdc.issues[0] as Issue)).toBe("destination");
		// a token's own system address: 0x20 and the token's index
		const token = buildAction(
			form({
				kind: "sendToken",
				destination: "0x2000000000000000000000000000000000000001",
				token: `PURR:${PURR.tokenId}`,
				amount: "1",
			}),
			ctx(),
		);
		expect(codes(token.issues)).toEqual(["action.to_hyperevm"]);
		expect(token.action).toBeNull();
		const raw = buildAction(
			form({
				kind: "raw",
				raw: JSON.stringify({
					type: "spotSend",
					destination: HYPE_SYSTEM,
					token: "HYPE:0x7317beb7cceed72ef0b346074cc8e7ab",
					amount: "0.1",
				}),
			}),
			ctx(),
		);
		expect(codes(raw.issues)).toContain("action.to_hyperevm");
		expect(raw.action).toBeNull();
		// an account whose address merely begins like one is an account
		const account = buildAction(
			form({
				kind: "sendUsdc",
				destination: "0x20a5b6f2154b4836de8c8b80fb90feacc236bd07",
				amount: "1",
			}),
			ctx(),
		);
		expect(codes(account.issues)).toEqual([]);
		expect(account.action).not.toBeNull();
	});

	it("checks addresses and flags a send to the account itself", () => {
		const send = (destination: string) =>
			buildAction(form({ kind: "sendUsdc", destination, amount: "1" }), ctx());
		expect(codes(send("").issues)).toEqual(["field.required"]);
		expect(codes(send("0x1234").issues)).toEqual(["address.invalid"]);
		expect(
			codes(send("51d3aaa37dc88af4d4ef846629e7e7f201b47fd9").issues),
		).toEqual(["address.invalid"]);
		// to itself into the same balance: Hyperliquid answers "Invalid send"
		const self = send(TREASURY.toUpperCase().replace("0X", "0x"));
		expect(codes(self.issues)).toEqual(["action.self_refused"]);
		expect(self.action).toBeNull();
		expect(fieldOf(self.issues[0] as Issue)).toBe("destination");
		// from its spot balance into its perps balance is taken: it only moves money inside
		const inside = buildAction(
			form({
				kind: "sendUsdc",
				destination: TREASURY,
				amount: "1",
				fromPocket: "spot",
				toPocket: "perps",
			}),
			ctx(),
		);
		expect(codes(inside.issues)).toEqual(["action.self_send"]);
		expect(inside.action).not.toBeNull();
		// the older sends are refused to oneself whatever they name ("Cannot self-transfer.")
		const old = buildAction(
			form({
				kind: "raw",
				raw: JSON.stringify({
					type: "usdSend",
					destination: TREASURY,
					amount: "1",
				}),
			}),
			ctx(),
		);
		expect(codes(old.issues)).toContain("action.self_refused");
		expect(old.action).toBeNull();
		// a withdrawal to the same address is another matter: it leaves Hyperliquid
		const out = buildAction(
			form({ kind: "withdraw3", destination: TREASURY, amount: "5" }),
			ctx(),
		);
		expect(codes(out.issues)).toEqual(["withdraw.own_address"]);
		expect(out.issues[0]?.message).toContain("not by the signers");
		expect(out.action).not.toBeNull();
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
		// without the token list nothing says how many decimals the token takes:
		// PURR takes 5, and an amount of 8 would be refused with the number spent
		const blind = spot({ amount: "0.00000001" }, ctx({ tokens: undefined }));
		expect(codes(blind.issues)).toEqual(["token.list_missing"]);
		expect(blind.issues[0]?.message).toBe(
			"The token list of testnet is not loaded yet, and it says how many decimals PURR takes.",
		);
		expect(blind.action).toBeNull();
	});

	it("an API wallet's name is shown as it is, with what does not show written out", () => {
		// the name is what a removal has to carry, to the character: nothing is
		// dropped, and a name that only looks like another reads differently
		const hidden = `bot${String.fromCodePoint(0x202e)}1`;
		expect(REMOVE_AGENT.called(hidden)).toBe('named "bot\\u{202e}1"');
		expect(REMOVE_AGENT.missing(hidden)).toContain('named "bot\\u{202e}1"');
		expect(REMOVE_AGENT.called("bot 1")).toBe('named "bot 1"');
		expect(REMOVE_AGENT.called("")).toBe("without a name");
	});

	it("a move is never proposed with a step missing", () => {
		const one = { type: "cDeposit" };
		const whole: Issue[] = [];
		expect(wholeMove([1, 2], [one, one], whole)).toHaveLength(2);
		expect(wholeMove(null, [], whole)).toEqual([]);
		expect(whole).toEqual([]);
		const half: Issue[] = [];
		expect(wholeMove([1, 2], [one], half)).toEqual([]);
		expect(half.map((i) => [i.code, i.severity])).toEqual([
			["action.step_unbuilt", "error"],
		]);
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
		// a unified treasury has one balance: its withdrawal is not measured
		// against the perps figure Hyperliquid reports beside it
		const one = (amount: string, b: BuildContext["balances"]) =>
			buildAction(
				form({ kind: "withdraw3", destination: RECIPIENT, amount }),
				ctx({ mode: UNIFIED, balances: b }),
			).issues;
		const lab = {
			perpWithdrawable: "0.291437",
			spot: [{ coin: "USDC", total: "16.614529", hold: "2.818399" }],
		};
		expect(one("5", lab)).toEqual([]);
		expect(one("14", lab).map((i) => i.message)).toEqual([
			"14 is more than the balance that can be moved observed just now (13.79613). Hyperliquid will refuse it unless funds arrive first.",
		]);
		expect(one("14", { perpWithdrawable: "0.291437" })).toEqual([]);
		const purr = (balances: BuildContext["balances"]) =>
			buildAction(
				form({
					kind: "sendToken",
					destination: RECIPIENT,
					token: `PURR:${PURR.tokenId}`,
					amount: "99",
				}),
				ctx({ balances }),
			).issues;
		expect(purr({})).toEqual([]);
		// Hyperliquid lists only what the account holds: not listed is none of it
		expect(codes(purr({ spot: [] }))).toEqual(["amount.exceeds_balance"]);
		expect(purr({ spot: [] })[0]?.message).toContain("(0)");
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
	it("says so when the mode could not be read and the action depends on it", () => {
		// null: read and failed. Absent: still on its way, nothing to say yet.
		const perps = send({ mode: null }, { fromPocket: "perps" });
		expect(real(perps.issues)).toEqual(["mode.unread"]);
		expect(perps.issues[0]?.message).toContain("choose Spot");
		expect(perps.action).not.toBeNull();
		expect(fieldOf(perps.issues[0] as Issue)).toBeNull();
		expect(real(send({ mode: null }, { fromPocket: "spot" }).issues)).toEqual(
			[],
		);
		expect(real(send({}, { fromPocket: "perps" }).issues)).toEqual([]);
		expect(
			real(send({ mode: MANUAL }, { fromPocket: "perps" }).issues),
		).toEqual([]);
		const move = buildAction(
			form({ kind: "usdClassTransfer", amount: "5" }),
			ctx({ mode: null }),
		);
		expect(codes(move.issues)).toEqual(["mode.unread"]);
		expect(move.action).not.toBeNull();
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
		// a removal is an approval of the zero address
		expect(of({ kind: "removeAgent" })).toBe("approveAgent");
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

describe("what the audit found the form letting through", () => {
	const CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

	it("stops a withdrawal that is not more than the bridge's fee, and says why", () => {
		const withdraw = (amount: string) =>
			buildAction(
				form({ kind: "withdraw3", destination: RECIPIENT, amount }),
				ctx(),
			);
		// exactly the fee was answered "Withdrawal is smaller than fee." on testnet
		for (const amount of ["1", "1.0", "0.5"]) {
			const r = withdraw(amount);
			expect(codes(r.issues), amount).toEqual(["withdraw.below_fee"]);
			expect(r.action).toBeNull();
			expect(fieldOf(r.issues[0] as Issue)).toBe("amount");
		}
		expect(withdraw("1").issues[0]?.message).toBe(
			"The bridge keeps 1 USDC of every withdrawal as its fee, so a withdrawal has to be more than 1 USDC. Hyperliquid refuses this one.",
		);
		expect(withdraw("1.000001").issues).toEqual([]);
		expect(withdraw("2").action).not.toBeNull();
	});

	it("asks a withdrawal to let the USDC sends still waiting go first, without blocking", () => {
		const waiting: { action: PlainObject; title: string }[] = [
			{
				action: {
					type: "usdSend",
					destination: RECIPIENT,
					amount: "1",
					time: 5,
				},
				title: "Rent",
			},
			{ action: { type: "spotSend", time: 6 }, title: "Not ordered" },
		];
		const r = buildAction(
			form({ kind: "withdraw3", destination: RECIPIENT, amount: "5" }),
			ctx({ waiting }),
		);
		expect(r.issues.map((i) => [i.severity, i.code])).toEqual([
			["warning", "withdraw.after_send"],
		]);
		expect(r.issues[0]?.message).toContain("“Rent”");
		expect(r.action).not.toBeNull();
	});

	it("notes a destination whose capitals do not match its checksum, without blocking", () => {
		const typo = CHECKSUMMED.replace("5aA", "5Aa");
		const r = buildAction(
			form({ kind: "sendUsdc", destination: typo, amount: "1" }),
			ctx(),
		);
		expect(r.issues.map((i) => [i.severity, i.code, i.path])).toEqual([
			["warning", "address.checksum", "action.destination"],
		]);
		expect(r.action).not.toBeNull();
		// written correctly, or in one case only (no checksum to break): nothing to say
		for (const ok of [CHECKSUMMED, CHECKSUMMED.toLowerCase()])
			expect(
				buildAction(
					form({ kind: "sendUsdc", destination: ok, amount: "1" }),
					ctx(),
				).issues,
			).toEqual([]);
		// a withdrawal's destination is typed the same way
		expect(
			codes(
				buildAction(
					form({ kind: "withdraw3", destination: typo, amount: "5" }),
					ctx(),
				).issues,
			),
		).toEqual(["address.checksum"]);
	});

	it("says what the zero address is, wherever one is typed", () => {
		const send = buildAction(
			form({ kind: "sendUsdc", destination: ZERO, amount: "1" }),
			ctx(),
		);
		expect(codes(send.issues)).toEqual(["address.zero"]);
		expect(send.issues[0]?.message).toContain("whatever is sent to it is lost");
		expect(send.action).not.toBeNull();
		// an approval of the zero address is a removal: the approve form does not build one
		const agent = buildAction(
			form({ kind: "approveAgent", agentAddress: ZERO, agentName: "lab" }),
			ctx(),
		);
		expect(codes(agent.issues)).toEqual(["agent.zero"]);
		expect(agent.issues[0]?.severity).toBe("error");
		expect(agent.issues[0]?.message).toContain("choose Remove API wallet");
		expect(agent.action).toBeNull();
		expect(fieldOf(agent.issues[0] as Issue)).toBe("agentAddress");
	});

	it("removes an API wallet by its name, and only one the treasury has", () => {
		const AGENTS = [
			{ name: "", address: A },
			{ name: "lab", address: B },
		];
		const remove = (
			removeAgent: string | null,
			agents: BuildContext["agents"] = AGENTS,
		) =>
			buildAction(form({ kind: "removeAgent", removeAgent }), ctx({ agents }));
		// none chosen yet
		const none = remove(null);
		expect(codes(none.issues)).toEqual(["field.required"]);
		expect(none.issues[0]?.message).toBe("Choose the API wallet to remove.");
		expect(none.action).toBeNull();
		expect(fieldOf(none.issues[0] as Issue)).toBe("removeAgent");
		// one of its wallets, the one without a name included
		for (const name of ["lab", ""]) {
			const r = remove(name);
			expect(r.issues).toEqual([]);
			expect(r.action).toMatchObject({
				type: "approveAgent",
				agentAddress: ZERO,
				agentName: name,
				nonce: NONCE,
			});
		}
		// no wallet of that name: Hyperliquid would answer "Extra agent does not exist."
		const gone = remove("rebalancer");
		expect(gone.issues.map((i) => [i.severity, i.code])).toEqual([
			["error", "agent.missing"],
		]);
		expect(gone.issues[0]?.message).toBe(REMOVE_AGENT.missing("rebalancer"));
		expect(gone.action).toBeNull();
		expect(remove("", [{ name: "lab", address: B }]).issues[0]?.message).toBe(
			"This treasury has no API wallet without a name: there is nothing to remove, and Hyperliquid would refuse it.",
		);
		// a name is the name: no trimming, no other case
		expect(codes(remove("Lab").issues)).toEqual(["agent.missing"]);
		// while the list is on its way nothing is said; when it could not be read, one warning
		const reading = remove("lab", undefined);
		expect(reading.issues).toEqual([]);
		expect(reading.action).not.toBeNull();
		const unread = remove("lab", null);
		expect(unread.issues.map((i) => [i.severity, i.code])).toEqual([
			["warning", "agents.unread"],
		]);
		expect(unread.action).not.toBeNull();
	});

	it("says nothing about a removal that the relay would not also provide", () => {
		for (const text of [
			REMOVE_AGENT.missing("lab"),
			REMOVE_AGENT.missing(""),
			REMOVE_AGENT.none,
			REMOVE_AGENT.unread,
			REMOVE_AGENT.reading,
			REMOVE_AGENT.what,
			REMOVE_AGENT.oneAtATime,
		])
			for (const pattern of FORBIDDEN_CLAIMS)
				expect(text, `${pattern}`).not.toMatch(pattern);
	});

	it("notes an API wallet address that is already in use on Hyperliquid", () => {
		const approve = (agent: BuildContext["agent"]) =>
			buildAction(
				form({ kind: "approveAgent", agentAddress: A, agentName: "bot" }),
				ctx({ agent }),
			);
		expect(approve(undefined).issues).toEqual([]);
		expect(approve({ status: "new", mode: null }).issues).toEqual([]);
		const used = approve({ status: "active", mode: null });
		expect(used.issues.map((i) => [i.severity, i.code, i.path])).toEqual([
			["warning", "agent.in_use", "action.agentAddress"],
		]);
		expect(used.action).not.toBeNull();
		expect(
			approve({ status: "agent", mode: null, agentOf: B }).issues[0]?.message,
		).toContain("already an API wallet");
	});

	it("sends an account-mode switch written as raw JSON to its own form", () => {
		const r = buildAction(
			form({
				kind: "raw",
				raw: JSON.stringify({
					type: "userSetAbstraction",
					user: TREASURY,
					abstraction: "portfolioMargin",
				}),
			}),
			ctx(),
		);
		expect(codes(r.issues)).toEqual(["raw.mode_switch_out_of_scope"]);
		expect(r.issues[0]?.message).toContain("choose “Switch account mode”");
		expect(r.action).toBeNull();
		expect(fieldOf(r.issues[0] as Issue)).toBe("raw");
	});
});

describe("accountMode: switching between a manual and a unified account", () => {
	const UNIFIED_NOW = accountMode("unifiedAccount");
	const sw = (toMode: ActionForm["toMode"], over: Partial<BuildContext> = {}) =>
		buildAction(form({ kind: "accountMode", toMode }), ctx(over));

	it("is a userSetAbstraction naming the treasury and the mode by Hyperliquid's word", () => {
		expect(actionTypeOf(form({ kind: "accountMode" }))).toBe(
			"userSetAbstraction",
		);
		expect(sw("unified", { mode: MANUAL }).action).toEqual({
			type: "userSetAbstraction",
			...HEAD,
			user: TREASURY,
			abstraction: "unifiedAccount",
			nonce: NONCE,
		});
		expect(sw("manual", { mode: UNIFIED_NOW }).action).toMatchObject({
			abstraction: "disabled",
		});
	});

	it("offers the other of the two when none is chosen, once the mode is read", () => {
		expect(sw("", { mode: MANUAL }).action).toMatchObject({
			abstraction: "unifiedAccount",
		});
		expect(sw("", { mode: UNIFIED_NOW }).action).toMatchObject({
			abstraction: "disabled",
		});
		expect(modeTargetFor(form({ toMode: "" }), MANUAL)).toBe("unified");
		expect(modeTargetFor(form({ toMode: "manual" }), MANUAL)).toBe("manual");
		// on its way: nothing to build, nothing to say
		const reading = sw("", { mode: undefined });
		expect(reading.action).toBeNull();
		expect(reading.issues).toEqual([]);
		// could not be read: the reader chooses
		const unread = sw("", { mode: null });
		expect(unread.action).toBeNull();
		expect(codes(unread.issues)).toEqual(["field.required"]);
		expect(fieldOf(unread.issues[0] as Issue)).toBe("toMode");
		// chosen all the same: built, with the one line that it may change nothing
		const chosen = sw("unified", { mode: null });
		expect(chosen.action).not.toBeNull();
		expect(chosen.issues.map((i) => [i.severity, i.code])).toEqual([
			["warning", "mode.note"],
		]);
	});

	it("is blocked only where Hyperliquid would refuse: back to manual with something open", () => {
		const busy = sw("manual", {
			mode: UNIFIED_NOW,
			open: { positions: 1, orders: 2 },
		});
		expect(busy.issues.map((i) => [i.severity, i.code])).toEqual([
			["error", "mode.busy"],
		]);
		expect(busy.issues[0]?.message).toContain(
			"1 open position and 2 open orders",
		);
		expect(busy.action).toBeNull();
		expect(fieldOf(busy.issues[0] as Issue)).toBe("toMode");
		// the other way is taken with the same things open
		const toUnified = sw("unified", {
			mode: MANUAL,
			open: { positions: 1, orders: 2 },
		});
		expect(toUnified.issues).toEqual([]);
		expect(toUnified.action).not.toBeNull();
		// not read: nothing is assumed
		expect(sw("manual", { mode: UNIFIED_NOW, open: null }).issues).toEqual([]);
	});

	it("says in one amber line what the switch does to waiting proposals, and when it changes nothing", () => {
		const waiting = [
			{
				action: {
					type: "usdSend",
					destination: RECIPIENT,
					amount: "5",
					time: 1,
				},
				title: "Pay the auditor",
			},
		];
		const r = sw("unified", { mode: MANUAL, waiting });
		expect(r.issues.map((i) => [i.severity, i.code, i.path])).toEqual([
			["warning", "mode.note", "mode"],
		]);
		expect(r.issues[0]?.message).toContain("“Pay the auditor”");
		expect(r.action).not.toBeNull();
		const same = sw("manual", { mode: MANUAL });
		expect(same.issues[0]?.message).toContain("already a manual account");
		expect(same.action).not.toBeNull();
	});

	it("comes back as its form, and any other mode as it was written", () => {
		const built = sw("manual", { mode: UNIFIED_NOW }).action as PlainObject;
		expect(formFromAction(built as never, "testnet")).toMatchObject({
			kind: "accountMode",
			toMode: "manual",
		});
		expect(
			formFromAction(
				{ ...built, abstraction: "portfolioMargin" } as never,
				"testnet",
			),
		).toMatchObject({ kind: "raw" });
	});
});

describe("changeSigners", () => {
	const change = (signers: string, over: Partial<BuildContext> = {}) =>
		buildAction(form({ kind: "changeSigners", signers }), ctx(over));
	const swapped = signersField([A, B, OUTSIDER], 2);
	const inUse = new Map<string, SignerCheck>([
		[OUTSIDER, { state: "ready", role: "user", multiSig: null }],
	]);

	it("is a convertToMultiSigUser, whatever the form holds", () => {
		expect(actionTypeOf(form({ kind: "changeSigners" }))).toBe(
			"convertToMultiSigUser",
		);
	});

	it("has nothing to propose while the list and the number are untouched", () => {
		for (const signers of ["", signersField(POLICY.authorizedUsers, 2)]) {
			const r = change(signers);
			expect(codes(r.issues)).toEqual(["signers.unchanged"]);
			expect(r.issues[0]?.message).toBe("Nothing changes yet.");
			expect(r.action).toBeNull();
			expect(fieldOf(r.issues[0] as Issue)).toBe("signers");
		}
	});

	it("waits for the look-up of a new signer, then builds the whole new set", () => {
		expect(codes(change(swapped).issues)).toEqual(["signers.checking"]);
		const r = change(swapped, { signerChecks: inUse });
		expect(r.issues).toEqual([]);
		expect(r.action).toEqual({
			type: "convertToMultiSigUser",
			...HEAD,
			signers: JSON.stringify({
				authorizedUsers: [A, B, OUTSIDER].sort(),
				threshold: 2,
			}),
			nonce: NONCE,
		});
	});

	it("is stopped by what Hyperliquid would refuse, naming the address", () => {
		const never = new Map<string, SignerCheck>([
			[OUTSIDER, { state: "ready", role: "missing", multiSig: null }],
		]);
		const r = change(swapped, { signerChecks: never });
		expect(codes(r.issues)).toEqual(["signers.blocked"]);
		expect(r.issues[0]?.message).toContain(OUTSIDER.slice(0, 6));
		expect(r.issues[0]?.message).toContain("Never used on Hyperliquid");
		// the treasury cannot sign for itself
		expect(codes(change(signersField([A, B, TREASURY], 2)).issues)).toEqual([
			"signers.blocked",
		]);
		// a number that was cleared
		expect(change(signersField([A, B], null)).issues[0]?.message).toBe(
			"Choose how many must sign.",
		);
	});

	it("only warns, in the form itself, about what is merely risky", () => {
		// all keys required, and the proposer taking themself out
		const r = change(signersField([B, C], 2), { createdBy: A });
		expect(r.issues).toEqual([]);
		expect(r.action).not.toBeNull();
	});

	it("needs the treasury's signers to have been read", () => {
		const r = change(swapped, { policyAtCreation: null });
		expect(codes(r.issues)).toEqual(["signers.unread"]);
		expect(r.action).toBeNull();
	});

	it("is not taken as raw JSON, and says where it lives", () => {
		const r = buildAction(
			form({
				kind: "raw",
				raw: '{"type":"convertToMultiSigUser","signers":"null"}',
			}),
			ctx(),
		);
		// the field shows the message alone, so the way out is in it
		expect(r.issues[0]?.message).toContain("choose “Change signers” above");
	});

	it("opens a re-proposed change in the form, with the action's own value", () => {
		const built = change(swapped, { signerChecks: inUse }).action;
		if (!built) throw new Error("does not build");
		expect(formFromAction(built, "testnet")).toEqual({
			chain: "hyperevm",
			kind: "changeSigners",
			signers: built.signers,
		});
	});
});

describe("the two vault forms", () => {
	const VAULT_ADDRESS = "0x49d05977597b22e3c73d654c351adde9d9920e18";
	const vaultRead = (
		over: Partial<NonNullable<BuildContext["vault"]>> = {},
	) => ({
		mode: MANUAL,
		perps: "100",
		spot: "40",
		deposits: [],
		vault: parseVaultDetails({
			name: "Crazy Franck",
			vaultAddress: VAULT_ADDRESS,
			leader: RECIPIENT,
		}),
		...over,
	});
	const deposit = (amount: string, over: Partial<BuildContext> = {}) =>
		buildProposalInputs(
			form({ kind: "vaultDeposit", amount, vault: VAULT_ADDRESS }),
			ctx({ vault: vaultRead(), now: NOW, ...over }),
		);

	it("builds one proposal for a deposit the perps balance covers: an L1 action with no number of its own", () => {
		const d = deposit("50");
		expect(d.issues).toEqual([]);
		expect(d.actions).toEqual([
			{
				type: "vaultTransfer",
				vaultAddress: VAULT_ADDRESS,
				isDeposit: true,
				usd: 50_000_000,
			},
		]);
		expect(d.inputs).toHaveLength(1);
		const made = createProposal(d.inputs?.[0] as never, { now: NOW });
		expect(made.issues.filter((i) => i.severity === "error")).toEqual([]);
		expect(made.proposal?.meta.kind).toBe("l1");
		expect(made.proposal?.payload.nonce).toBe(NONCE);
		expect(made.proposal?.payload.vaultAddress).toBeNull();
	});

	it("builds two proposals when the rest is in spot, which the core takes as one move", () => {
		const d = deposit("120");
		expect(d.issues).toEqual([]);
		expect(d.actions).toEqual([
			{
				type: "usdClassTransfer",
				...HEAD,
				amount: "20",
				toPerp: true,
				nonce: NONCE,
			},
			{
				type: "vaultTransfer",
				vaultAddress: VAULT_ADDRESS,
				isDeposit: true,
				usd: 120_000_000,
			},
		]);
		expect(d.inputs?.map((i) => i.nonce)).toEqual([NONCE, NONCE + 1]);
		const [first, second] = (d.inputs ?? []).map(
			(input) =>
				createProposal({ ...input, createdBy: A } as never, { now: NOW })
					.proposal as Proposal,
		);
		const judged = judgeMove(
			...tieSteps(first as Proposal, second as Proposal),
		);
		expect(judged.flaw).toBeNull();
		expect(judged.move).toMatchObject({
			kind: "vault",
			amount: "120",
			vault: VAULT_ADDRESS,
		});
		// and that move comes back as the deposit form, to work the steps out again
		expect(formFromMove(judged.move as never, "testnet")).toMatchObject({
			kind: "vaultDeposit",
			amount: "120",
			vault: VAULT_ADDRESS,
		});
	});

	it("is blocked where Hyperliquid would refuse, under the field it is about", () => {
		const small = deposit("4");
		expect(small.inputs).toBeNull();
		expect(codes(small.issues)).toEqual(["vault.vault-min-deposit"]);
		expect(fieldOf(small.issues[0] as Issue)).toBe("amount");
		const gone = deposit("50", {
			vault: vaultRead({ vault: { kind: "none" } }),
		});
		expect(codes(gone.issues)).toEqual(["vault.vault-unregistered"]);
		expect(fieldOf(gone.issues[0] as Issue)).toBe("vault");
		expect(gone.inputs).toBeNull();
		// nothing read yet: nothing to build, and nothing said
		const blind = deposit("50", { vault: undefined });
		expect(blind.actions).toEqual([]);
		expect(blind.issues).toEqual([]);
	});

	it("builds a withdrawal, and reads either back as its form", () => {
		const w = buildProposalInputs(
			form({ kind: "vaultWithdraw", amount: "20", vault: VAULT_ADDRESS }),
			ctx({
				vault: vaultRead({
					deposits: [{ vault: VAULT_ADDRESS, equity: "100", lockedUntil: 0 }],
				}),
				now: NOW,
			}),
		);
		expect(w.issues).toEqual([]);
		expect(w.actions[0]).toMatchObject({ isDeposit: false, usd: 20_000_000 });
		expect(formFromAction(w.actions[0] as never, "testnet")).toMatchObject({
			kind: "vaultWithdraw",
			amount: "20",
			vault: VAULT_ADDRESS,
		});
		expect(
			formFromAction(deposit("50").actions[0] as never, "testnet"),
		).toMatchObject({
			kind: "vaultDeposit",
			amount: "50",
			vault: VAULT_ADDRESS,
		});
		expect(actionTypeOf(form({ kind: "vaultDeposit" }))).toBeNull();
	});

	it("sends a vault action written as raw JSON to its form, and keeps every other L1 action out", () => {
		const raw = (action: object) =>
			buildAction(form({ kind: "raw", raw: JSON.stringify(action) }), ctx());
		const vault = raw({
			type: "vaultTransfer",
			vaultAddress: VAULT_ADDRESS,
			isDeposit: true,
			usd: 5_000_000,
		});
		expect(codes(vault.issues)).toEqual(["raw.vault_out_of_scope"]);
		expect(vault.issues[0]?.message).toContain("choose “Vault” above");
		expect(vault.action).toBeNull();
		const order = raw({ type: "order", orders: [], grouping: "na" });
		expect(codes(order.issues)).toEqual(["raw.l1_out_of_scope"]);
		expect(order.action).toBeNull();
	});
});

describe("formFromAction: a removal comes back as the form that names the wallet", () => {
	it("reads an approval of the zero address as Remove API wallet", () => {
		const removal = {
			type: "approveAgent",
			...HEAD,
			agentAddress: ZERO,
			agentName: "lab",
			nonce: NONCE,
		};
		expect(formFromAction(removal as never, "testnet")).toMatchObject({
			kind: "removeAgent",
			removeAgent: "lab",
		});
		// the one without a name is a name too, not "none chosen"
		expect(
			formFromAction({ ...removal, agentName: "" } as never, "testnet"),
		).toMatchObject({ kind: "removeAgent", removeAgent: "" });
		// an approval stays an approval
		expect(
			formFromAction({ ...removal, agentAddress: A } as never, "testnet"),
		).toMatchObject({
			kind: "approveAgent",
			agentAddress: A,
			agentName: "lab",
		});
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

describe("the staking forms", () => {
	const X = "0x946bf3135c7d15e4462b510f74b6e304aabb5b21";
	const Y = "0x0014b26bde5766c0c0f94130af5c4bf4551eeef6";
	const validator = (address: string, name: string): Validator => ({
		address,
		name,
		description: "",
		stake: "1000",
		isActive: true,
		isJailed: false,
		commission: "0.03",
		day: null,
		week: null,
		month: { uptime: "1", expectedRate: "0.02" },
	});
	/** 400 HYPE in spot, 50 unstaked in the staking balance, 1,000 staked with X. */
	const STAKING: StakingRead = {
		summary: {
			delegated: "1000",
			undelegated: "50",
			pendingTotal: "0",
			pendingReturns: 0,
		},
		delegations: [{ validator: X, amount: "1000", lockedUntil: 0 }],
		validators: [validator(X, "Hypurr"), validator(Y, "Nansen")],
		spotAvailable: "400",
	};
	const staking = (over: Partial<BuildContext> = {}) =>
		ctx({ staking: STAKING, now: NOW, createdBy: A, ...over });
	/** The proposals a form makes, tied when there are two. */
	const proposals = (f: ActionForm): Proposal[] => {
		const drafts = buildProposalInputs(f, staking());
		expect(drafts.issues.filter((i) => i.severity === "error")).toEqual([]);
		const made = (drafts.inputs ?? []).map((input) => {
			const created = createProposal(input, { now: NOW });
			if (!created.proposal) throw new Error(JSON.stringify(created.issues));
			return created.proposal;
		});
		const [first, second] = made;
		return first && second ? [...tieSteps(first, second)] : made;
	};

	it("stake: two proposals when part has to come from spot, numbered one after the other", () => {
		const f = form({ kind: "stake", amount: "100", validator: Y });
		const drafts = buildProposalInputs(f, staking());
		expect(drafts.issues).toEqual([]);
		expect(drafts.actions).toEqual([
			{ type: "cDeposit", ...HEAD, wei: 5000000000, nonce: NONCE },
			{
				type: "tokenDelegate",
				...HEAD,
				validator: Y,
				wei: 10000000000,
				isUndelegate: false,
				nonce: NONCE + 1,
			},
		]);
		expect(drafts.inputs?.map((i) => i.nonce)).toEqual([NONCE, NONCE + 1]);
		expect(drafts.inputs?.every((i) => i.outerSigner === B)).toBe(true);
		// the single-proposal reading gives the first step
		expect(buildProposalInput(f, staking()).action).toEqual(drafts.actions[0]);
		expect(buildAction(f, staking()).also).toEqual([drafts.actions[1]]);
	});

	it("the core takes both, and the two are one move", () => {
		const [first, second] = proposals(
			form({ kind: "stake", amount: "100", validator: Y }),
		) as [Proposal, Proposal];
		expect(first.meta.kind).toBe("user-signed");
		const judged = judgeMove(first, second);
		expect(judged.flaw).toBeNull();
		expect(judged.move).toMatchObject({
			kind: "stake",
			amount: "100",
			validator: Y,
		});
	});

	it("stake: one proposal when the staking balance covers it", () => {
		const drafts = buildProposalInputs(
			form({ kind: "stake", amount: "50", validator: Y }),
			staking(),
		);
		expect(drafts.inputs).toHaveLength(1);
		expect(drafts.actions[0]).toMatchObject({
			type: "tokenDelegate",
			wei: 5000000000,
			nonce: NONCE,
		});
		expect(
			buildAction(
				form({ kind: "stake", amount: "50", validator: Y }),
				staking(),
			).also,
		).toEqual([]);
	});

	it("return to spot and move to another validator make their two steps", () => {
		const back = proposals(
			form({ kind: "returnToSpot", amount: "100", validator: X }),
		) as [Proposal, Proposal];
		expect(back.map((p) => p.payload.action.type)).toEqual([
			"tokenDelegate",
			"cWithdraw",
		]);
		expect(judgeMove(...back).move).toMatchObject({
			kind: "return",
			amount: "100",
			validator: X,
		});
		const across = proposals(
			form({ kind: "moveStake", amount: "100", validator: X, toValidator: Y }),
		) as [Proposal, Proposal];
		expect(judgeMove(...across).move).toMatchObject({
			kind: "switch",
			amount: "100",
			validator: X,
			to: Y,
		});
	});

	it("nothing is built before the staking balance is read, or with errors in the form", () => {
		const unread = buildProposalInputs(
			form({ kind: "stake", amount: "100", validator: Y }),
			ctx(),
		);
		expect(unread.inputs).toBeNull();
		expect(unread.actions).toEqual([]);
		expect(codes(unread.issues)).toEqual(["staking.unread"]);
		const noAmount = buildProposalInputs(
			form({ kind: "stake", amount: "", validator: Y }),
			staking(),
		);
		expect(noAmount.inputs).toBeNull();
		expect(codes(noAmount.issues)).toEqual(["field.required"]);
		// the finaliser is asked for like everywhere
		const noFinaliser = buildProposalInputs(
			form({ kind: "stake", amount: "100", validator: Y, finaliser: "" }),
			staking(),
		);
		expect(noFinaliser.inputs).toBeNull();
		expect(noFinaliser.actions).toHaveLength(2);
		expect(codes(noFinaliser.issues)).toEqual(["finaliser.required"]);
	});

	it("a warning does not stop the proposals", () => {
		// adding to the stake with X locks all of it again: said, not refused
		const drafts = buildProposalInputs(
			form({ kind: "stake", amount: "100", validator: X }),
			staking(),
		);
		expect(codes(drafts.issues)).toEqual(["stake.relocks"]);
		expect(drafts.inputs).toHaveLength(2);
	});

	it("uses the proposal's number as the clock when the page gives none", () => {
		const locked: StakingRead = {
			...STAKING,
			delegations: [{ validator: X, amount: "1000", lockedUntil: NONCE + 1 }],
		};
		const f = form({ kind: "returnToSpot", amount: "100", validator: X });
		// a locked stake is no reason against proposing, whichever clock is used
		expect(
			buildProposalInputs(f, ctx({ staking: locked })).inputs,
		).toHaveLength(2);
	});

	it("their type is not known before the plan, and none is numbered after the sends on record", () => {
		for (const kind of ["stake", "returnToSpot", "moveStake"] as const)
			expect(actionTypeOf({ kind, raw: "" })).toBeNull();
	});

	it("puts an issue under the field it is about", () => {
		const at = (path: string) =>
			fieldOf({ code: "x", severity: "error", message: "", path });
		expect(at("action.validator")).toBe("validator");
		expect(at("action.toValidator")).toBe("toValidator");
		expect(at("action.amount")).toBe("amount");
	});

	it("a move comes back as the form that names its end", () => {
		const cases: ActionForm[] = [
			form({ kind: "stake", amount: "100", validator: Y }),
			form({ kind: "returnToSpot", amount: "100", validator: X }),
			form({ kind: "moveStake", amount: "100", validator: X, toValidator: Y }),
		];
		for (const f of cases) {
			const [first, second] = proposals(f) as [Proposal, Proposal];
			const move = judgeMove(first, second).move;
			if (!move) throw new Error("no move");
			expect(formFromMove(move, "testnet")).toEqual({
				chain: "hyperevm",
				kind: f.kind,
				amount: f.amount,
				validator: f.validator,
				toValidator: f.toValidator,
			});
		}
	});

	it("proposed again from its first step a move is the whole move; from its second, only what is left", () => {
		const whole: ActionForm[] = [
			form({ kind: "stake", amount: "100", validator: Y }),
			form({ kind: "returnToSpot", amount: "100", validator: X }),
			form({ kind: "moveStake", amount: "100", validator: X, toValidator: Y }),
		];
		// what is left of each once its first step was carried out
		const left: Partial<ActionForm>[] = [
			{ kind: "stake", amount: "100", validator: Y },
			{ kind: "returnToSpot", amount: "100" },
			// never the move again: that would unstake from X a second time
			{ kind: "stake", amount: "100", validator: Y },
		];
		whole.forEach((f, i) => {
			const [first, second] = proposals(f) as [Proposal, Proposal];
			expect(formFromProposal(first, second).kind).toBe(f.kind);
			expect(formFromProposal(second, first)).toEqual({
				chain: "hyperevm",
				...left[i],
			});
			// without the other step at hand a step is only itself
			expect(formFromProposal(second, null)).toEqual({
				chain: "hyperevm",
				...left[i],
			});
		});
	});

	it("what is left of a move to another validator is one stake, once the unstake has landed", () => {
		const [first, second] = proposals(
			form({ kind: "moveStake", amount: "100", validator: X, toValidator: Y }),
		) as [Proposal, Proposal];
		// step 1 was carried out: 100 sits unstaked in the staking balance
		const after: StakingRead = {
			...STAKING,
			summary: STAKING.summary
				? { ...STAKING.summary, undelegated: "100" }
				: null,
		};
		const again = buildProposalInputs(
			form(formFromProposal(second, first)),
			ctx({ staking: after }),
		);
		expect(again.actions.map((a) => a.type)).toEqual(["tokenDelegate"]);
		expect(again.actions[0]).toMatchObject({
			validator: Y,
			isUndelegate: false,
		});
	});

	it("a single stake or return comes back as its form; the other two steps stay as they are", () => {
		const stake: PlainObject = {
			type: "tokenDelegate",
			...HEAD,
			validator: Y,
			wei: 10000000000,
			isUndelegate: false,
			nonce: NONCE,
		};
		expect(formFromAction(stake, "testnet")).toEqual({
			chain: "hyperevm",
			kind: "stake",
			amount: "100",
			validator: Y,
		});
		expect(
			formFromAction(
				{ type: "cWithdraw", ...HEAD, wei: 2000000, nonce: NONCE },
				"testnet",
			),
		).toEqual({ chain: "hyperevm", kind: "returnToSpot", amount: "0.02" });
		for (const alone of [
			{ ...stake, isUndelegate: true },
			{ type: "cDeposit", ...HEAD, wei: 2000000, nonce: NONCE },
		] as PlainObject[])
			expect(formFromAction(alone, "testnet").kind).toBe("raw");
	});
});
