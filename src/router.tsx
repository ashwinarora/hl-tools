import {
	createRouter as createTanStackRouter,
	parseSearchWith,
	stringifySearchWith,
} from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

/**
 * This page's nonce, the one its security policy names (`src/start.ts`): from
 * the request on the server, from the page's own meta tag in the browser.
 */
function pageNonce(): string | undefined {
	if (typeof document !== "undefined")
		return (
			document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')
				?.content || undefined
		);
	try {
		return (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce;
	} catch {
		// asked outside a request (no global context yet): no nonce to give
		return undefined;
	}
}

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,

		context: getContext(),

		// Every search param this app uses is a string. The default codec
		// JSON-parses values, so ?q=100083061 arrived as a number and was then
		// re-serialised as ?q=%22100083061%22; keep values as typed instead.
		parseSearch: parseSearchWith((v) => v),
		stringifySearch: stringifySearchWith((v) => JSON.stringify(v)),

		// the router writes it on every script and tag it puts in the page
		ssr: { nonce: pageNonce() },

		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
