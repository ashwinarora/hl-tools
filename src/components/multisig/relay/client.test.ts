import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { onSessionEnded, watchFetch } from "./client";

const A = "0x00000000000000000000000000000000000000a1" as Address;
const B = "0x00000000000000000000000000000000000000b2" as Address;

const answer = (status: number, body: unknown, json = true) =>
	(async () =>
		new Response(json ? JSON.stringify(body) : String(body), {
			status,
			headers: { "content-type": json ? "application/json" : "text/html" },
		})) as unknown as typeof fetch;

const ended = {
	code: "relay.session_ended",
	message: "relay.session_ended",
	details: "This session has ended: it was signed out, or it has run out.",
	hint: "Sign in again.",
};

describe("hearing that the relay has ended a wallet's session", () => {
	it("tells whose session it was, and hands the answer on untouched", async () => {
		const heard: Address[] = [];
		const stop = onSessionEnded((w) => heard.push(w));
		const res = await watchFetch(
			A,
			answer(401, ended),
		)("http://relay/rest/v1/x");
		expect(heard).toEqual([A]);
		// the caller still reads the body itself
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual(ended);
		// each wallet's client reports its own wallet
		await watchFetch(B, answer(401, ended))("http://relay/rest/v1/x");
		expect(heard).toEqual([A, B]);
		stop();
		await watchFetch(A, answer(401, ended))("http://relay/rest/v1/x");
		expect(heard).toEqual([A, B]);
	});

	it("says nothing for any other answer", async () => {
		const heard: Address[] = [];
		const stop = onSessionEnded((w) => heard.push(w));
		for (const other of [
			answer(200, [{ address: "0x1" }]),
			// an expired token: the client renews that by itself
			answer(401, { code: "PGRST301", message: "JWT expired" }),
			// the same words under another status are somebody else's
			answer(403, ended),
			answer(401, "<html>bad gateway</html>", false),
			answer(401, null),
			answer(500, { message: "relay.session_ended" }),
		]) {
			const res = await watchFetch(A, other)("http://relay/rest/v1/x");
			expect(res).toBeInstanceOf(Response);
		}
		expect(heard).toEqual([]);
		stop();
	});

	it("lets a failed request fail as it would have", async () => {
		const down = (async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;
		await expect(watchFetch(A, down)("http://relay/rest/v1/x")).rejects.toThrow(
			"Failed to fetch",
		);
	});
});
