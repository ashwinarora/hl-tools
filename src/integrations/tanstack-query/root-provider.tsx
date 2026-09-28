import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let context:
	| {
			queryClient: QueryClient;
	  }
	| undefined;

export function getContext() {
	if (context) {
		return context;
	}

	const queryClient = new QueryClient();

	context = {
		queryClient,
	};

	return context;
}

/**
 * App-wide providers. Deliberately no wallet stack here: wagmi, RainbowKit
 * and WalletConnect are mounted only under /faucet-miner (see
 * src/integrations/wallet), so read-only tool pages make no wallet,
 * telemetry or third-party RPC requests.
 */
export default function TanStackQueryProvider({
	children,
}: {
	children: ReactNode;
}) {
	const { queryClient } = getContext();
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
