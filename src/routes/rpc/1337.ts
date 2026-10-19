import { createFileRoute } from "@tanstack/react-router";
import { signingRpcResponse } from "#/lib/signingRpc";

/**
 * The signing network's link (chain 1337), the one `VITE_CHAIN_1337_RPC_URL`
 * names in production. Wallets keep the link they added, so this path never
 * changes. Nothing is logged and nothing is kept (see src/lib/signingRpc.ts).
 */
export const Route = createFileRoute("/rpc/1337")({
	server: {
		handlers: {
			ANY: ({ request }) => signingRpcResponse(request),
		},
	},
});
