import { describe, expect, it } from "vitest";
import { REGISTER, registerStep } from "./register";

describe("an account registering itself after a conversion", () => {
	it("waits while the relay is looking, and is done when it says so", () => {
		expect(registerStep({ status: "pending", reason: null }, 1)).toEqual({
			kind: "wait",
		});
		expect(registerStep({ status: "done", reason: null }, 1)).toEqual({
			kind: "done",
		});
	});

	it("asks again, twice at most, when the relay looked a moment too early", () => {
		const early = { status: "rejected", reason: "not_multisig" } as const;
		expect(registerStep(early, 1)).toEqual({
			kind: "retry",
			afterMs: REGISTER.retryAfterMs,
		});
		expect(registerStep(early, 2).kind).toBe("retry");
		expect(registerStep(early, 3)).toEqual({ kind: "failed" });
		expect(REGISTER.attempts).toBe(3);
	});

	it("asks again when the relay's own look-up failed", () => {
		expect(
			registerStep({ status: "failed", reason: "lookup_failed" }, 1).kind,
		).toBe("retry");
	});

	it("takes any other refusal, and a request the relay would not take, as final", () => {
		expect(
			registerStep({ status: "rejected", reason: "not_a_signer" }, 1),
		).toEqual({ kind: "failed" });
		expect(registerStep(null, 1)).toEqual({ kind: "failed" });
	});
});
