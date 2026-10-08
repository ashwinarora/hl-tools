import { describe, expect, it } from "vitest";
import { prepareInnerAction, riskFlags } from "../../src/multisig/index.ts";
import { USER_SIGNED_SPECS } from "../../src/rules/signing.ts";
import { A, B, codes, NONCE, ORDER, RECIPIENT, usdSend } from "./_helpers.ts";

const prep = (
	action: unknown,
	nonce = NONCE,
	network: "testnet" | "mainnet" = "testnet",
) => prepareInnerAction(action, network, nonce);

describe("prepareInnerAction: shape", () => {
	it("canon.not-object: a non-object is rejected", () => {
		expect(codes(prep("order").issues)).toEqual(["action.not_object"]);
		expect(codes(prep([ORDER]).issues)).toEqual(["action.not_object"]);
		expect(codes(prep(null).issues)).toEqual(["action.not_object"]);
	});
	it("canon.no-type: a missing or non-string type is rejected", () => {
		expect(codes(prep({ orders: [] }).issues)).toEqual(["action.no_type"]);
		expect(codes(prep({ type: 7 }).issues)).toEqual(["action.no_type"]);
	});
	it("canon.type-multiSig: an envelope cannot be nested", () => {
		const r = prep({ type: "multiSig", signatures: [], payload: {} });
		expect(codes(r.issues)).toEqual(["action.nested_envelope"]);
		expect(r.action).toBeNull();
	});
	it("canon.float-lexeme: floats anywhere are rejected", () => {
		const r = prep({ type: "spotDeploy", x: { y: 1.5 } });
		expect(codes(r.issues)).toEqual(["action.float"]);
	});
	it("canon.unsupported-value: functions and undefined are not JSON", () => {
		expect(codes(prep({ type: "x", f: () => 1 }).issues)).toEqual([
			"action.invalid",
		]);
	});
	it("canon.integer-like-key: keys that parse as integers are rejected at any depth", () => {
		const r = prep({ type: "x", nested: { "12": true } });
		expect(codes(r.issues)).toEqual(["action.integer_key"]);
		expect(r.issues[0]?.message).toContain("nested.12");
		expect(codes(prep({ type: "x", list: [{ "0": 1 }] }).issues)).toEqual([
			"action.integer_key",
		]);
		const top = prep({ type: "x", "7": 1 });
		expect(codes(top.issues)).toEqual(["action.integer_key"]);
		expect(top.issues[0]?.message).toContain("(7)");
	});
});

describe("prepareInnerAction: L1 canonicalisation", () => {
	it("canon.key-order-rewritten: fields are re-emitted in the SDK order with a normalisation warning", () => {
		const r = prep({
			grouping: "na",
			orders: [
				{
					t: { limit: { tif: "Gtc" } },
					r: false,
					s: "0.001",
					p: "50000",
					b: true,
					a: 3,
				},
			],
			type: "order",
		});
		expect(r.kind).toBe("l1");
		expect(r.action).toEqual(ORDER);
		expect(Object.keys(r.action ?? {})).toEqual(["type", "orders", "grouping"]);
		expect(r.issues.every((i) => i.severity !== "error")).toBe(true);
		expect(codes(r.issues)).toContain("field.order");
	});
	it("canon.trailing-zero-price: '50000.0' becomes '50000'", () => {
		const r = prep({
			...ORDER,
			orders: [{ ...(ORDER.orders as object[])[0], p: "50000.0" }],
		});
		expect((r.action?.orders as { p: string }[])[0]?.p).toBe("50000");
		const i = r.issues.find((x) => x.code === "decimal.not_canonical");
		expect(i?.severity).toBe("warning");
		expect(i?.message).toMatch(/^Normalised:/);
	});
	it("canon.numeric-price: a number price becomes a string", () => {
		const r = prep({
			...ORDER,
			orders: [{ ...(ORDER.orders as object[])[0], p: 50000 }],
		});
		expect((r.action?.orders as { p: string }[])[0]?.p).toBe("50000");
		expect(
			r.issues.find((x) => x.code === "decimal.not_string")?.severity,
		).toBe("warning");
	});
	it("canon.must-omit-field: cancel's top-level `f: false` is dropped with a normalisation warning", () => {
		const r = prep({ type: "cancel", cancels: [{ a: 3, o: 1 }], f: false });
		expect(r.action).toEqual({ type: "cancel", cancels: [{ a: 3, o: 1 }] });
		expect(r.issues.find((i) => i.code === "field.must_omit")?.severity).toBe(
			"warning",
		);
		// an unknown key on a known shape stays an error even if it looks harmless
		const bad = prep({ type: "cancel", cancels: [{ a: 3, o: 1, f: false }] });
		expect(bad.action).toBeNull();
		expect(codes(bad.issues)).toEqual(["field.unknown"]);
	});
	it("canon.uppercase-address-in-action: vaultTransfer address is lowercased", () => {
		const r = prep({
			type: "vaultTransfer",
			vaultAddress: A.toUpperCase().replace("0X", "0x"),
			isDeposit: true,
			usd: 1,
		});
		expect(r.action?.vaultAddress).toBe(A);
		expect(r.issues.find((x) => x.code === "address.uppercase")?.severity).toBe(
			"warning",
		);
	});
	it("canon.unknown-key-known-type: an unknown key on a known shape is an error", () => {
		const r = prep({ ...ORDER, extra: 1 });
		expect(r.action).toBeNull();
		expect(
			r.issues.some(
				(i) => i.code === "field.unknown" && i.severity === "error",
			),
		).toBe(true);
	});
	it("canon.missing-field: a missing required field is an error", () => {
		const r = prep({
			type: "order",
			orders: [{ a: 3, b: true, p: "1", s: "1", r: false }],
			grouping: "na",
		});
		expect(r.action).toBeNull();
		expect(codes(r.issues)).toContain("field.missing");
	});
	it("canon.empty-orders-array: an empty orders array is an error", () => {
		const r = prep({ type: "order", orders: [], grouping: "na" });
		expect(r.action).toBeNull();
		expect(codes(r.issues)).toContain("array.empty");
	});
	it("canon.unknown-type-passthrough: unknown types are kept verbatim with an info issue", () => {
		const action = {
			type: "spotDeploy",
			registerToken2: { spec: { name: "X", szDecimals: 2, weiDecimals: 8 } },
		};
		const r = prep(action);
		expect(r.kind).toBe("l1");
		expect(r.action).toEqual(action);
		expect(r.issues.map((i) => [i.code, i.severity])).toEqual([
			["action.unknown_shape", "info"],
		]);
	});
	it("canon.bigint-kept: integers above 2^53 survive as bigint", () => {
		const r = prep({ type: "x", wei: (1n << 60n) + 1n });
		expect(r.action?.wei).toBe((1n << 60n) + 1n);
	});
	it("canon.noop-known-shape: a canonical order passes with no issues", () => {
		const r = prep(ORDER);
		expect(r.issues).toEqual([]);
		expect(r.action).toEqual(ORDER);
	});
});

describe("prepareInnerAction: kind inference", () => {
	it("kind.user-signed-from-spec: every spec type is user-signed; order is l1; unknown is l1", () => {
		for (const spec of USER_SIGNED_SPECS) {
			const r = prep({ type: spec.actionType });
			expect(r.kind, spec.actionType).toBe("user-signed");
		}
		expect(prep(ORDER).kind).toBe("l1");
		expect(prep({ type: "somethingNew" }).kind).toBe("l1");
	});
});

describe("prepareInnerAction: user-signed strictness", () => {
	it("us.valid-usdSend: canonical object in spec order with lowercase addresses", () => {
		const r = prep({
			...usdSend(),
			destination: RECIPIENT.toUpperCase().replace("0X", "0x"),
		});
		expect(r.kind).toBe("user-signed");
		expect(r.spec?.actionType).toBe("usdSend");
		expect(Object.keys(r.action ?? {})).toEqual([
			"type",
			"signatureChainId",
			"hyperliquidChain",
			"destination",
			"amount",
			"time",
		]);
		// destination is typed `string` in the struct, so case is kept as given (it is signed verbatim)
		expect(r.action?.destination).toBe(
			RECIPIENT.toUpperCase().replace("0X", "0x"),
		);
		expect(r.issues).toEqual([]);
	});
	it("us.address-field-lowercased: address-typed fields (approveAgent.agentAddress) are lowercased with a warning", () => {
		const r = prep({
			type: "approveAgent",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			agentAddress: B.toUpperCase().replace("0X", "0x"),
			agentName: "x",
			nonce: NONCE,
		});
		expect(r.action?.agentAddress).toBe(B);
		expect(codes(r.issues)).toEqual(["address.uppercase"]);
	});
	it("us.missing-signatureChainId / us.non-hex-signatureChainId", () => {
		const { signatureChainId: _, ...rest } = usdSend();
		expect(codes(prep(rest).issues)).toContain("usersigned.signatureChainId");
		expect(
			codes(prep({ ...usdSend(), signatureChainId: "66eee" }).issues),
		).toContain("usersigned.signatureChainId");
		expect(
			codes(prep({ ...usdSend(), signatureChainId: 0x66eee }).issues),
		).toContain("usersigned.signatureChainId");
	});
	it("us.signatureChainId-lowercased: '0x66EEE' is normalised", () => {
		expect(
			prep({ ...usdSend(), signatureChainId: "0x66EEE" }).action
				?.signatureChainId,
		).toBe("0x66eee");
	});
	it("us.hyperliquidChain-vs-network: Mainnet on testnet is a network mismatch; missing is an error", () => {
		expect(
			codes(prep({ ...usdSend(), hyperliquidChain: "Mainnet" }).issues),
		).toContain("network.mismatch");
		expect(
			codes(prep(usdSend(NONCE, "mainnet"), NONCE, "mainnet").issues),
		).toEqual([]);
		const { hyperliquidChain: _, ...rest } = usdSend();
		expect(codes(prep(rest).issues)).toContain("usersigned.hyperliquidChain");
		expect(codes(prep({ ...usdSend(), hyperliquidChain: 1 }).issues)).toContain(
			"usersigned.hyperliquidChain",
		);
	});
	it("us.time-field-ne-nonce: usdSend.time must equal the proposal nonce", () => {
		const r = prep(usdSend(NONCE - 1));
		expect(codes(r.issues)).toEqual(["nonce.mismatch"]);
		expect(r.action).toBeNull();
	});
	it("us.nonce-field-ne-nonce: approveAgent.nonce must equal the proposal nonce", () => {
		const r = prep({
			type: "approveAgent",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			agentAddress: B,
			agentName: "x",
			nonce: NONCE + 1,
		});
		expect(codes(r.issues)).toEqual(["nonce.mismatch"]);
	});
	it("us.extra-key: unsigned keys are errors", () => {
		const r = prep({ ...usdSend(), memo: "hi" });
		expect(codes(r.issues)).toEqual(["usersigned.extra"]);
	});
	it("us.missing-field: a missing struct field is an error", () => {
		const { amount: _, ...rest } = usdSend();
		expect(codes(prep(rest).issues)).toEqual(["field.missing"]);
	});
	it("us.field-types: string, bool, uint and bytes fields are type-checked", () => {
		expect(codes(prep({ ...usdSend(), amount: 5 }).issues)).toEqual([
			"field.type",
		]);
		expect(
			codes(
				prep({
					type: "usdClassTransfer",
					signatureChainId: "0x66eee",
					hyperliquidChain: "Testnet",
					amount: "1",
					toPerp: "yes",
					nonce: NONCE,
				}).issues,
			),
		).toEqual(["field.type"]);
		expect(codes(prep({ ...usdSend(), time: String(NONCE) }).issues)).toEqual([
			"field.type",
		]);
		expect(codes(prep({ ...usdSend(), time: -1 }).issues)).toEqual([
			"field.type",
		]);
		expect(codes(prep({ ...usdSend(), time: 1.5 }).issues)).toEqual([
			"action.float",
		]);
		const evm = {
			type: "sendToEvmWithData",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			token: "USDC:0x1",
			amount: "1",
			sourceDex: "",
			destinationRecipient: A,
			addressEncoding: "evm",
			destinationChainId: 998,
			gasLimit: 1,
			data: "zz",
			nonce: NONCE,
		};
		expect(codes(prep(evm).issues)).toEqual(["field.type"]);
		expect(prep({ ...evm, data: "0xAB" }).action?.data).toBe("0xab");
	});
	it("us.address-field-not-string: a non-string address field is invalid", () => {
		const r = prep({
			type: "approveAgent",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			agentAddress: 5,
			agentName: "x",
			nonce: NONCE,
		});
		expect(codes(r.issues)).toEqual(["address.invalid"]);
	});
	it("us.unsupported-eip712-type: a spec with a type the preparer does not model is rejected, not guessed", () => {
		const spec = {
			...USER_SIGNED_SPECS[0],
			fields: [
				{ name: "hyperliquidChain", type: "string" },
				{ name: "x", type: "uint256[]" },
				{ name: "time", type: "uint64" },
			],
		} as (typeof USER_SIGNED_SPECS)[number];
		const r = prepareInnerAction(
			{
				type: spec.actionType,
				signatureChainId: "0x66eee",
				hyperliquidChain: "Testnet",
				x: 1,
				time: NONCE,
			},
			"testnet",
			NONCE,
			{ spec },
		);
		expect(codes(r.issues)).toEqual(["field.type"]);
		expect(r.issues[0]?.message).toContain("uint256[]");
		// a spec override for a different type is ignored
		expect(
			prepareInnerAction(usdSend(), "testnet", NONCE, {
				spec: { ...spec, actionType: "spotSend" },
			}).issues,
		).toEqual([]);
	});
	it("us.bool-field-kept: usdClassTransfer.toPerp is carried through", () => {
		const r = prep({
			type: "usdClassTransfer",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			amount: "1",
			toPerp: true,
			nonce: NONCE,
		});
		expect(r.action?.toPerp).toBe(true);
		expect(r.issues).toEqual([]);
	});
	it("us.approveAgent-agentName-absent-or-null: normalised to '' with an info issue", () => {
		const base = {
			type: "approveAgent",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			agentAddress: B,
			nonce: NONCE,
		};
		for (const action of [base, { ...base, agentName: null }]) {
			const r = prep(action);
			expect(r.action?.agentName).toBe("");
			expect(codes(r.issues)).toEqual(["approveAgent.agentName"]);
		}
	});
	it("us.convert-signers-not-string: signers must be a JSON string", () => {
		const r = prep({
			type: "convertToMultiSigUser",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			signers: { authorizedUsers: [A], threshold: 1 },
			nonce: NONCE,
		});
		expect(codes(r.issues)).toEqual(["field.type"]);
	});
	it("us.convert-signers-normalised: the signers string is re-emitted sorted and lowercase", () => {
		// A sorts after B, so [A, B] is unsorted input.
		const r = prep({
			type: "convertToMultiSigUser",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			signers: JSON.stringify({
				authorizedUsers: [A.toUpperCase().replace("0X", "0x"), B],
				threshold: 1,
			}),
			nonce: NONCE,
		});
		expect(r.action?.signers).toBe(
			JSON.stringify({ authorizedUsers: [B, A], threshold: 1 }),
		);
		expect(codes(r.issues).sort()).toEqual([
			"address.uppercase",
			"signers.unsorted",
		]);
		expect(r.issues[0]?.path).toMatch(/^action\.signers/);
	});
	it("us.convert-signers-invalid-json: blocks the proposal", () => {
		const r = prep({
			type: "convertToMultiSigUser",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			signers: "{nope",
			nonce: NONCE,
		});
		expect(r.action).toBeNull();
		expect(codes(r.issues)).toEqual(["signers.not_json"]);
	});
	it("us.convert-revert: 'null' is kept as the revert sentinel", () => {
		const r = prep({
			type: "convertToMultiSigUser",
			signatureChainId: "0x66eee",
			hyperliquidChain: "Testnet",
			signers: "null",
			nonce: NONCE,
		});
		expect(r.action?.signers).toBe("null");
		expect(r.flags).toEqual(["destructive"]);
	});
});

describe("risk flags", () => {
	it("flag.per-action-type", () => {
		expect(riskFlags({ type: "approveAgent" })).toEqual(["agent_bypass"]);
		expect(
			riskFlags({ type: "convertToMultiSigUser", signers: "null" }),
		).toEqual(["destructive"]);
		expect(
			riskFlags({
				type: "convertToMultiSigUser",
				signers: JSON.stringify({ authorizedUsers: [A], threshold: 1 }),
			}),
		).toEqual(["policy_change"]);
		for (const t of ["usdSend", "spotSend", "withdraw3", "sendAsset"])
			expect(riskFlags({ type: t })).toEqual(["funds_out"]);
		expect(riskFlags({ type: "sendToEvmWithData" })).toEqual([
			"funds_out",
			"evm_warning",
		]);
		expect(riskFlags({ type: "evmUserModify" })).toEqual(["evm_warning"]);
		expect(riskFlags({ type: "order" })).toEqual([]);
		expect(riskFlags({ type: 5 })).toEqual([]);
		expect(prep(ORDER).flags).toEqual([]);
		expect(prep(usdSend()).flags).toEqual(["funds_out"]);
	});
});
