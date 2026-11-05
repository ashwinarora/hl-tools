import { createFileRoute, redirect } from "@tanstack/react-router";

// The faucet miner's guide moved into the docs; keep old links (and their search standing) working.
export const Route = createFileRoute("/faucet-miner/how-to-use")({
	beforeLoad: () => {
		throw redirect({
			to: "/docs/$",
			params: { _splat: "faucet" },
			statusCode: 301,
		});
	},
});
