import { describe, expect, it } from "vitest";
import { RELAY_COPY } from "./copy";
import { signInNotice } from "./signInNotice";

const refused = {
	code: "relay.signin_rejected",
	severity: "error" as const,
	message:
		"The sharing service did not accept the sign-in message: Signed Ethereum message is using a Domain that does not match the one in URI which is not allowed on this server",
	fix: "Check that this device's date and time are set automatically, then sign in again.",
};

describe("what a sign-in that did not finish says", () => {
	it("is one plain line, with the exact reason kept for Details", () => {
		const n = signInNotice(refused, false);
		expect(n).toEqual({
			tone: "error",
			title: "Sign-in didn't go through. Please try again.",
			details: refused.message,
		});
		// the line never carries the server's words, nor advice that may not apply
		expect(n.title).not.toMatch(/sharing service|Ethereum|date and time/);
	});

	it("says a decline in the wallet calmly, with nothing to unfold", () => {
		expect(
			signInNotice(
				{
					code: "relay.signin_wallet",
					severity: "warning",
					message: "You declined in the wallet.",
				},
				true,
			),
		).toEqual({
			tone: "info",
			title: RELAY_COPY.signInCancelled,
			details: null,
		});
	});

	it("tells someone who tried too often to wait", () => {
		const n = signInNotice(
			{
				code: "relay.signin_rate_limited",
				severity: "warning",
				message: "Too many sign-ins.",
			},
			false,
		);
		expect(n.title).toBe(RELAY_COPY.signInTooMany);
		expect(n.details).toBeNull();
	});

	it("gives any other failure the same plain line", () => {
		for (const code of [
			"relay.signin_mismatch",
			"relay.signin_origin",
			"relay.error",
			"relay.unreachable",
		]) {
			const n = signInNotice(
				{ code, severity: "error", message: "something exact" },
				false,
			);
			expect(n.title).toBe(RELAY_COPY.signInFailed);
			expect(n.details).toBe("something exact");
		}
	});
});
