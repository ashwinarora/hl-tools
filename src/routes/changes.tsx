import { createFileRoute, redirect } from "@tanstack/react-router";
import { RULE_SOURCES_SPLAT } from "#/lib/docs/ruleSources";

// The rule sets moved into the docs; keep old links (and their search standing) working.
export const Route = createFileRoute("/changes")({
	beforeLoad: () => {
		throw redirect({
			to: "/docs/$",
			params: { _splat: RULE_SOURCES_SPLAT },
			statusCode: 301,
		});
	},
});
