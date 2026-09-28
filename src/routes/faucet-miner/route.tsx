import { createFileRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import WalletProviders from "#/integrations/wallet/WalletProviders";

// Dev-only: Vite replaces `import.meta.env.DEV` with `false` in production, so
// the MockPanel chunk and MSW are never emitted there.
const MockPanel = import.meta.env.DEV
	? lazy(() => import("#/components/MockPanel"))
	: null;

export const Route = createFileRoute("/faucet-miner")({
	head: () => ({ meta: [{ title: "Testnet Faucet Miner — hl-tools" }] }),
	component: FaucetLayout,
});

/**
 * Optional MSW harness (`?mock=1` or localStorage.mock = "1"), scoped to the
 * faucet miner and stopped on leave so read-only tools never see mocked data.
 */
function useMocks() {
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		const params = new URLSearchParams(window.location.search);
		const active =
			params.get("mock") === "1" || window.localStorage.getItem("mock") === "1";
		if (!active) return;
		let cancelled = false;
		void import("#/mocks/browser").then((m) =>
			m.startMocks().then(() => {
				if (cancelled) m.stopMocks();
				else (window as unknown as { __mswActive: boolean }).__mswActive = true;
			}),
		);
		return () => {
			cancelled = true;
			void import("#/mocks/browser").then((m) => m.stopMocks());
		};
	}, []);
}

function FaucetLayout() {
	useMocks();
	return (
		<WalletProviders>
			<Outlet />
			{MockPanel && (
				<Suspense fallback={null}>
					<MockPanel />
				</Suspense>
			)}
		</WalletProviders>
	);
}
