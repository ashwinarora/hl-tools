import { describe, expect, it } from "vitest";
import { isDuplicate, isUnreachable, relayIssue } from "./errors";

const pg = (code: string, message: string, details: string | null = null) => ({
	code,
	message,
	details,
	hint: null,
});

describe("relayIssue", () => {
	it.each([
		["relay.rate_limited", "A wallet may share 30 proposals an hour."],
		[
			"relay.busy",
			"Too many additions are waiting for a lookup. Try again in a few minutes.",
		],
		["relay.pending_cap", "This treasury already has 50 pending proposals."],
		["relay.treasury_frozen", null],
		["relay.proposal_closed", "This proposal was withdrawn."],
		["relay.proposal_expired", null],
		["relay.not_finaliser", null],
		["relay.not_proposer", null],
		["relay.finaliser_not_signer", null],
		["relay.document_mismatch", null],
		["relay.nonce_too_far", null],
	])("keeps the relay's own refusal %s, with its detail when it gives one", (code, detail) => {
		const i = relayIssue(pg("P0001", code, detail));
		expect(i.code).toBe(code);
		expect(i.severity).toBe("error");
		if (detail) expect(i.message).toBe(detail);
		else expect(i.message.length).toBeGreaterThan(10);
	});

	it("explains a row-level refusal as 'not in the signer copy'", () => {
		const i = relayIssue(
			pg(
				"42501",
				'new row violates row-level security policy for table "proposals"',
			),
		);
		expect(i.code).toBe("relay.not_allowed");
		expect(i.message).toMatch(/not in its copy of this treasury's signers/);
		expect(i.fix).toMatch(/re-checked/);
		expect(
			relayIssue(pg("42501", "permission denied for table proposals")).code,
		).toBe("relay.not_allowed");
	});

	it("maps the Postgres codes the relay can answer with", () => {
		expect(relayIssue(pg("23505", "duplicate key value")).code).toBe(
			"relay.duplicate",
		);
		expect(relayIssue(pg("23505", "duplicate key value")).severity).toBe(
			"info",
		);
		expect(
			relayIssue(pg("23503", "violates foreign key constraint")).code,
		).toBe("relay.unknown_proposal");
		expect(relayIssue(pg("23514", "violates check constraint")).code).toBe(
			"relay.invalid",
		);
		expect(relayIssue(pg("22P02", "invalid input value for enum")).code).toBe(
			"relay.invalid",
		);
		expect(relayIssue(pg("PGRST301", "JWT expired")).code).toBe(
			"relay.session_expired",
		);
		expect(relayIssue({ status: 401, message: "Unauthorized" }).code).toBe(
			"relay.session_expired",
		);
	});

	it("recognises a request that never arrived", () => {
		for (const e of [
			new TypeError("Failed to fetch"),
			new TypeError("fetch failed"),
			{ name: "AuthRetryableFetchError", message: "", status: 0 },
			{ message: "TypeError: NetworkError when attempting to fetch resource." },
			{ message: "Load failed" },
		]) {
			expect(isUnreachable(e)).toBe(true);
			const i = relayIssue(e);
			expect(i.code).toBe("relay.unreachable");
			expect(i.message).toBe(
				"The relay could not be reached. Links and files still work.",
			);
		}
		expect(isUnreachable(pg("42501", "permission denied"))).toBe(false);
		expect(isUnreachable(null)).toBe(false);
		expect(isUnreachable("Failed to fetch")).toBe(false);
	});

	it("explains sign-in failures", () => {
		const limited = relayIssue({
			name: "AuthApiError",
			status: 429,
			message: "Request rate limit reached",
		});
		expect(limited.code).toBe("relay.signin_rate_limited");
		const rejected = relayIssue({
			name: "AuthApiError",
			status: 400,
			message: "Ethereum message was issued too long ago",
		});
		expect(rejected.code).toBe("relay.signin_rejected");
		expect(rejected.message).toContain("issued too long ago");
		expect(
			relayIssue({
				status: 400,
				message: "siwe: domain in first line of message is not valid",
			}).code,
		).toBe("relay.signin_rejected");
		expect(
			relayIssue({
				status: 400,
				message: "Signature does not match address in message",
			}).code,
		).toBe("relay.signin_rejected");
	});

	it("never throws, whatever it is given", () => {
		expect(relayIssue(undefined).code).toBe("relay.error");
		expect(relayIssue(null).code).toBe("relay.error");
		expect(relayIssue("boom").message).toBe(
			"The relay answered with an error: boom",
		);
		expect(relayIssue({}).message).toBe("The relay answered with an error.");
		expect(relayIssue(pg("XX000", "internal error")).message).toBe(
			"The relay answered with an error: internal error",
		);
	});
});

describe("isDuplicate", () => {
	it("is the unique-violation code and nothing else", () => {
		expect(isDuplicate(pg("23505", "duplicate"))).toBe(true);
		expect(isDuplicate(pg("23503", "fk"))).toBe(false);
		expect(isDuplicate(null)).toBe(false);
		expect(isDuplicate("23505")).toBe(false);
	});
});
