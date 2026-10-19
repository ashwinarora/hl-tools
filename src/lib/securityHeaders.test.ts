import { describe, expect, it } from "vitest";
import {
	configuredOrigins,
	contentSecurityPolicy,
	makeNonce,
	securityHeaders,
} from "./securityHeaders";

const directives = (csp: string) =>
	new Map(
		csp.split("; ").map((d) => {
			const [name, ...values] = d.split(" ");
			return [name, values] as const;
		}),
	);

describe("the site's security headers", () => {
	it("makes a fresh nonce for every response", () => {
		const a = makeNonce();
		expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
		expect(makeNonce()).not.toBe(a);
	});

	it("lets only the site's own scripts and this response's inline ones run", () => {
		const d = directives(contentSecurityPolicy("abc123"));
		expect(d.get("script-src")).toEqual(["'self'", "'nonce-abc123'"]);
		expect(d.get("script-src")).not.toContain("'unsafe-inline'");
		expect(d.get("script-src")).not.toContain("'unsafe-eval'");
		expect(d.get("object-src")).toEqual(["'none'"]);
		expect(d.get("base-uri")).toEqual(["'self'"]);
		expect(d.get("frame-ancestors")).toEqual(["'none'"]);
	});

	it("loads fonts and styles from the site only", () => {
		const d = directives(contentSecurityPolicy("n"));
		expect(d.get("font-src")).toEqual(["'self'", "data:"]);
		expect(d.get("style-src")?.[0]).toBe("'self'");
		expect(d.get("style-src")?.join(" ")).not.toMatch(/googleapis|https:/);
	});

	it("keeps connections open for the tools that probe any endpoint", () => {
		expect(directives(contentSecurityPolicy("n")).get("connect-src")).toEqual([
			"'self'",
			"https:",
			"wss:",
		]);
	});

	it("sends the policy in production only, the rest always", () => {
		const prod = securityHeaders({ nonce: "n", csp: true, html: true });
		expect(prod["content-security-policy"]).toContain("'nonce-n'");
		expect(prod["strict-transport-security"]).toBe(
			"max-age=31536000; includeSubDomains",
		);
		expect(prod["x-frame-options"]).toBe("DENY");
		expect(prod["x-content-type-options"]).toBe("nosniff");
		expect(prod["referrer-policy"]).toBe("strict-origin-when-cross-origin");
		expect(prod["cache-control"]).toBe("private, no-cache");
		const dev = securityHeaders({ nonce: "n", csp: false, html: true });
		expect(dev["content-security-policy"]).toBeUndefined();
		expect(dev["x-frame-options"]).toBe("DENY");
	});

	it("leaves the caching of anything but a page to its own headers", () => {
		expect(
			securityHeaders({ nonce: "n", csp: true, html: false })["cache-control"],
		).toBeUndefined();
	});

	it("names the configured service exactly, so a local build can reach it", () => {
		expect(
			configuredOrigins([
				"http://127.0.0.1:54321",
				"https://abc.supabase.co/",
				"http://localhost:3337/rpc",
				undefined,
				"not a url",
				"ftp://x.y",
			]),
		).toEqual([
			"http://127.0.0.1:54321",
			"ws://127.0.0.1:54321",
			"https://abc.supabase.co",
			"wss://abc.supabase.co",
			"http://localhost:3337",
			"ws://localhost:3337",
		]);
		const d = directives(
			contentSecurityPolicy("n", [
				"http://127.0.0.1:54321",
				"ws://127.0.0.1:54321",
			]),
		);
		expect(d.get("connect-src")).toEqual([
			"'self'",
			"https:",
			"wss:",
			"http://127.0.0.1:54321",
			"ws://127.0.0.1:54321",
		]);
	});
});
