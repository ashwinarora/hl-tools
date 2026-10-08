import { describe, expect, it } from "vitest";
import {
	explainExchangeError,
	MULTISIG_ERROR_IDS,
} from "../../src/multisig/index.ts";
import { ERROR_CATALOG } from "../../src/rules/errors.ts";

const err = (response: unknown, status = 200) =>
	explainExchangeError({ status: "err", response }, status);

describe("explainExchangeError: every recorded string", () => {
	const cases: [string, string, Record<string, string>][] = [
		["Multi-sig required", "multisig-required", {}],
		["Multi-sig threshold not met", "multisig-threshold", {}],
		["Invalid multi-sig inner signer", "multisig-inner-signer", {}],
		["Invalid multi-sig outer signer", "multisig-outer-signer", {}],
		[
			"Multi-sig outer signer must be an L1 user.",
			"multisig-leader-not-user",
			{},
		],
		["Invalid multi-sig user", "multisig-not-multisig", {}],
		["Invalid multi-sig threshold", "multisig-threshold-invalid", {}],
		[
			"Multi-sig authorized user must exist on L1",
			"multisig-signer-missing",
			{},
		],
		["Cannot register self as multi-sig authorized user", "multisig-self", {}],
		["Too many multi-sig signers", "multisig-too-many", {}],
		["Nonce mismatch.", "nonce-mismatch", {}],
		[
			"Invalid nonce: nonce too low 1791140676851 < 1791227196699",
			"nonce-low",
			{ nonce: "1791140676851", minimum: "1791227196699" },
		],
		[
			"Invalid nonce: nonce too high 1791572677029 > 1791486156858",
			"nonce-high",
			{ nonce: "1791572677029", maximum: "1791486156858" },
		],
		[
			"Invalid nonce: duplicate nonce 1791399877207",
			"nonce-duplicate",
			{ nonce: "1791399877207" },
		],
		["Action already expired", "expired", {}],
		[
			"Mainnet and testnet require different signature.",
			"network-signature",
			{},
		],
		["Unexpected error (code=148)", "revert-shape", {}],
		[
			"Must deposit before performing actions. User: 0x008d90fc2bebe284380f32bd9632f6922b701bc5",
			"must-deposit",
			{ address: "0x008d90fc2bebe284380f32bd9632f6922b701bc5" },
		],
		[
			"Vault not registered: 0x1111111111111111111111111111111111111111",
			"vault-unregistered",
			{ vault: "0x1111111111111111111111111111111111111111" },
		],
		[
			"Cannot set scheduled cancel time until enough volume traded. Required: $1000000. Traded: $167.22.",
			"unknown",
			{},
		],
		[
			"L1 error: User or API Wallet 0x0123456789012345678901234567890123456789 does not exist.",
			"signer-missing",
			{ address: "0x0123456789012345678901234567890123456789" },
		],
	];
	for (const [message, id, details] of cases) {
		it(`${id}: ${message}`, () => {
			const e = err(message);
			expect(e.id).toBe(id);
			expect(e.source).toBe("status");
			expect(e.message).toBe(message);
			expect(e.details).toEqual(details);
			expect(e.cause.length).toBeGreaterThan(0);
		});
	}
	it("multi-sig fix overrides are appended where the generic fix would mislead", () => {
		expect(
			err(
				"Must deposit before performing actions. User: 0x0123456789012345678901234567890123456789",
			).fix,
		).toContain("API wallet");
		expect(err("Action already expired").fix).toContain("inner signature");
		expect(
			err(
				"L1 error: User or API Wallet 0x0123456789012345678901234567890123456789 does not exist.",
			).fix,
		).toContain("envelope");
		expect(
			explainExchangeError(
				"Failed to deserialize the JSON body into the target type",
				422,
			).fix,
		).toContain("payload action");
	});
	it("every catalogue example maps to its own entry (first match wins, so order matters)", () => {
		for (const entry of ERROR_CATALOG) {
			expect(err(entry.example).id, entry.example).toBe(entry.id);
		}
	});
	it("MULTISIG_ERROR_IDS lists the multi-sig and nonce entries", () => {
		expect(MULTISIG_ERROR_IDS).toEqual(
			expect.arrayContaining([
				"multisig-required",
				"multisig-threshold",
				"multisig-inner-signer",
				"multisig-outer-signer",
				"multisig-leader-not-user",
				"multisig-not-multisig",
				"multisig-threshold-invalid",
				"multisig-signer-missing",
				"multisig-self",
				"multisig-too-many",
				"nonce-mismatch",
				"nonce-low",
				"nonce-high",
				"nonce-duplicate",
				"nonce",
				"network-signature",
				"revert-shape",
				"vault-unregistered",
			]),
		);
	});
});

describe("explainExchangeError: response shapes", () => {
	it("ok", () => {
		expect(
			explainExchangeError(
				{ status: "ok", response: { type: "default" } },
				200,
			),
		).toEqual({
			id: "ok",
			message: "",
			cause: "The action was accepted.",
			fix: "",
			details: {},
			source: "none",
		});
		expect(
			explainExchangeError(
				{
					status: "ok",
					response: {
						type: "order",
						data: { statuses: [{ resting: { oid: 1 } }] },
					},
				},
				200,
			).id,
		).toBe("ok");
	});
	it("per-order statuses inside status ok", () => {
		const e = explainExchangeError(
			{
				status: "ok",
				response: {
					type: "order",
					data: {
						statuses: [
							{ resting: { oid: 1 } },
							{ error: "Price must be divisible by tick size." },
							{ error: "x" },
						],
					},
				},
			},
			200,
		);
		expect(e.source).toBe("order-status");
		expect(e.id).not.toBe("ok");
		expect(e.message).toBe("Price must be divisible by tick size.");
		expect(e.details).toMatchObject({ index: "1", failed: "2", total: "3" });
	});
	it("HTTP 422 text body and non-200 object body", () => {
		const e = explainExchangeError(
			"Failed to deserialize the JSON body into the target type: missing field `type`",
			422,
		);
		expect(e.id).toBe("deserialize");
		expect(e.source).toBe("http");
		expect(e.cause).toContain("HTTP 422");
		const o = explainExchangeError({ anything: 1 }, 500);
		expect(o.id).toBe("unknown");
		expect(o.cause).toContain("HTTP 500");
		expect(o.message).toBe('{"anything":1}');
		expect(explainExchangeError("weird", 418).cause).toBe(
			"Not in the error catalogue.",
		);
	});
	it("odd bodies never throw", () => {
		expect(explainExchangeError(null, 200).id).toBe("unknown");
		expect(explainExchangeError(undefined, 200).id).toBe("unknown");
		expect(explainExchangeError(5, 200).id).toBe("unknown");
		expect(explainExchangeError([1], 200).id).toBe("unknown");
		expect(explainExchangeError({ status: "maybe" }, 200).id).toBe("unknown");
		expect(
			explainExchangeError({ status: "err", response: { nested: 1n } }, 200)
				.message,
		).toBe('{"nested":"1n"}');
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(explainExchangeError(circular, 500).id).toBe("unknown");
		expect(explainExchangeError(() => 1, 500).message).toBe(String(() => 1));
		expect(
			explainExchangeError(
				{ status: "ok", response: { data: { statuses: "x" } } },
				200,
			).id,
		).toBe("ok");
		expect(
			explainExchangeError(
				{
					status: "ok",
					response: { data: { statuses: [null, 5, { error: 7 }] } },
				},
				200,
			).id,
		).toBe("ok");
	});
});
