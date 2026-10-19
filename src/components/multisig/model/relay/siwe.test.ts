import { parseSiweMessage } from "viem/siwe";
import { describe, expect, it } from "vitest";
import { ACCOUNTS, NOW } from "#/test/keys";
import {
	buildSignInMessage,
	SIGN_IN_STATEMENT,
	SIGN_IN_VALID_MS,
	signInOriginProblem,
} from "./siwe";

const account = ACCOUNTS[1] as (typeof ACCOUNTS)[number];
const input = {
	address: account.address,
	chainId: 998,
	origin: "http://localhost:3000",
	nonce: "abcdef0123456789",
	now: NOW,
};

describe("buildSignInMessage", () => {
	it("is an EIP-4361 message for the page's own origin, valid for five minutes", () => {
		const fields = parseSiweMessage(buildSignInMessage(input));
		expect(fields.address).toBe(account.address);
		expect(fields.domain).toBe("localhost:3000");
		expect(fields.uri).toBe("http://localhost:3000");
		expect(fields.chainId).toBe(998);
		expect(fields.version).toBe("1");
		expect(fields.nonce).toBe("abcdef0123456789");
		expect(fields.statement).toBe(SIGN_IN_STATEMENT);
		expect(fields.issuedAt?.getTime()).toBe(NOW);
		expect(fields.expirationTime?.getTime()).toBe(NOW + SIGN_IN_VALID_MS);
		expect(SIGN_IN_VALID_MS).toBe(300_000);
	});

	it("starts with the domain line a wallet shows", () => {
		expect(buildSignInMessage(input).split("\n")[0]).toBe(
			"localhost:3000 wants you to sign in with your Ethereum account:",
		);
	});

	it("uses the origin only: a path or a query never reaches the message", () => {
		const fields = parseSiweMessage(
			buildSignInMessage({
				...input,
				origin: "https://hltools.tech/multisig/proposal?digest=0xabc",
			}),
		);
		expect(fields.uri).toBe("https://hltools.tech");
		expect(fields.domain).toBe("hltools.tech");
	});

	it("writes the address checksummed even when given lowercase", () => {
		const message = buildSignInMessage({
			...input,
			address: account.address.toLowerCase() as `0x${string}`,
		});
		expect(message).toContain(account.address);
	});

	it("says in plain words that it moves nothing, on one line", () => {
		expect(SIGN_IN_STATEMENT).toMatch(/cannot move funds/);
		expect(SIGN_IN_STATEMENT).not.toContain("\n");
	});
});

describe("signInOriginProblem", () => {
	it("accepts localhost over http and a named host over https", () => {
		expect(signInOriginProblem("http://localhost:3000")).toBeNull();
		expect(signInOriginProblem("https://hltools.tech")).toBeNull();
	});

	it("sends an IP address to localhost: Supabase refuses an IP as the message domain", () => {
		expect(signInOriginProblem("http://127.0.0.1:3000")).toBe(
			"Sign-in needs a named address. Open this page as http://localhost:3000 instead of 127.0.0.1:3000.",
		);
		expect(signInOriginProblem("http://192.168.1.20")).toMatch(
			/Open this page as http:\/\/localhost instead of 192\.168\.1\.20/,
		);
		expect(signInOriginProblem("http://[::1]:3000")).toMatch(/named address/);
	});

	it("wants https anywhere but localhost", () => {
		expect(signInOriginProblem("http://hltools.tech")).toBe(
			"Sign-in needs https on this address.",
		);
	});

	it("survives an origin that is not a URL", () => {
		expect(signInOriginProblem("null")).toBe(
			"This page has no usable address to sign in from.",
		);
	});
});
