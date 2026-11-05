import { createFileRoute, redirect } from "@tanstack/react-router";

// The glossary moved into the docs; keep old links (and their search standing) working.
export const Route = createFileRoute("/multisig/glossary")({
	beforeLoad: () => {
		throw redirect({
			to: "/docs/$",
			params: { _splat: "reference/glossary" },
			statusCode: 301,
		});
	},
});
