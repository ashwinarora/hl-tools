import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiAdapter } from "#/lib/wagmiConfig";

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

export default function TanStackQueryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { queryClient } = getContext();

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
