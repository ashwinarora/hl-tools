import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { isUnreachable } from "../model/relay/errors";
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

describe("a relay that does not answer", () => {
	// a fetch that waits until its signal ends it, as the browser's does
	const never = ((_: unknown, init?: RequestInit) =>
		new Promise((_, reject) => {
			init?.signal?.addEventListener("abort", () =>
				reject(init.signal?.reason),
			);
		})) as unknown as typeof fetch;

	it("gives up after the time limit, as a request that got no answer", async () => {
		const failed = await watchFetch(
			A,
			never,
			20,
		)("http://relay/rest/v1/x").then(
			() => null,
			(e: unknown) => e,
		);
		expect(failed).toBeInstanceOf(TypeError);
		expect(isUnreachable(failed)).toBe(true);
	});

	it("leaves a request the caller stopped as the caller stopped it", async () => {
		const stop = new AbortController();
		const asked = watchFetch(
			A,
			never,
			10_000,
		)("http://relay/rest/v1/x", {
			signal: stop.signal,
		});
		stop.abort(new DOMException("stopped", "AbortError"));
		await expect(asked).rejects.toMatchObject({ name: "AbortError" });
	});

	it("keeps the limit on a caller's request where the browser has no AbortSignal.any", async () => {
		const any = AbortSignal.any;
		Object.defineProperty(AbortSignal, "any", {
			value: undefined,
			configurable: true,
		});
		try {
			const failed = await watchFetch(
				A,
				never,
				20,
			)("http://relay/rest/v1/x", {
				signal: new AbortController().signal,
			}).then(
				() => null,
				(e: unknown) => e,
			);
			expect(failed).toBeInstanceOf(TypeError);
			expect(isUnreachable(failed)).toBe(true);
			// and the caller's own stop still stops it
			const stop = new AbortController();
			const asked = watchFetch(
				A,
				never,
				10_000,
			)("http://relay/rest/v1/x", { signal: stop.signal });
			stop.abort(new DOMException("stopped", "AbortError"));
			await expect(asked).rejects.toMatchObject({ name: "AbortError" });
		} finally {
			Object.defineProperty(AbortSignal, "any", {
				value: any,
				configurable: true,
			});
		}
	});

	it("hands on an answer that came in time, with the limit on its signal", async () => {
		let seen: AbortSignal | null | undefined;
		const quick = (async (_: unknown, init?: RequestInit) => {
			seen = init?.signal;
			return new Response("[]", { status: 200 });
		}) as unknown as typeof fetch;
		const res = await watchFetch(A, quick, 50)("http://relay/rest/v1/x");
		expect(res.status).toBe(200);
		expect(seen).toBeInstanceOf(AbortSignal);
	});
});
