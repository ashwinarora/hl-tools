import { createFileRoute, redirect } from "@tanstack/react-router";

// The faucet miner guide moved under /faucet-miner; keep old links working.
export const Route = createFileRoute("/how-to-use")({
	beforeLoad: () => {
		throw redirect({ to: "/faucet-miner/how-to-use", statusCode: 301 });
	},
});
