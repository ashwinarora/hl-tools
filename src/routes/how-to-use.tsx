import { createFileRoute, redirect } from "@tanstack/react-router";

// The faucet miner's guide, at its oldest address; it now lives in the docs.
export const Route = createFileRoute("/how-to-use")({
	beforeLoad: () => {
		throw redirect({
			to: "/docs/$",
			params: { _splat: "faucet" },
			statusCode: 301,
		});
	},
});
