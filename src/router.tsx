import {
	createRouter as createTanStackRouter,
	parseSearchWith,
	stringifySearchWith,
} from "@tanstack/react-router";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,

		context: getContext(),

		// Every search param this app uses is a string. The default codec
		// JSON-parses values, so ?q=100083061 arrived as a number and was then
		// re-serialised as ?q=%22100083061%22; keep values as typed instead.
		parseSearch: parseSearchWith((v) => v),
		stringifySearch: stringifySearchWith((v) => JSON.stringify(v)),

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
