import { createMiddleware, createStart } from "@tanstack/react-start";
import {
	configuredOrigins,
	makeNonce,
	securityHeaders,
} from "./lib/securityHeaders";

const ORIGINS = configuredOrigins([
	import.meta.env.VITE_SUPABASE_URL,
	import.meta.env.VITE_CHAIN_1337_RPC_URL,
]);

/**
 * Every response leaves with the site's security headers. The nonce made here
 * is the one the router writes on its scripts (`getRouter` reads it from the
 * request's context), so the policy and the page agree.
 */
const secured = createMiddleware().server(async ({ next }) => {
	const nonce = makeNonce();
	const result = await next({ context: { nonce } });
	const response = result.response;
	const html = (response.headers.get("content-type") ?? "").startsWith(
		"text/html",
	);
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(
		securityHeaders({
			nonce,
			csp: import.meta.env.PROD,
			html,
			origins: ORIGINS,
		}),
	))
		headers.set(name, value);
	return {
		...result,
		response: new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		}),
	};
});

export const startInstance = createStart(() => ({
	requestMiddleware: [secured],
}));
