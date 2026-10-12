import { NETWORKS, type Network } from "@hl-tools/core";
import { useEffect } from "react";
import { radioGroupKeyDown } from "#/lib/radioGroup";
import { cn } from "#/lib/utils";
import { useNetworkHint } from "#/store/networkHintStore";
import { useNetworkHydrated, useNetworkStore } from "#/store/networkStore";

/**
 * Global mainnet/testnet switch. The active segment is styled from
 * <html data-network>, which an inline script sets before hydration, so the
 * persisted choice renders correctly on first paint. What it tells a screen
 * reader waits for the stored choice: until then neither segment is announced
 * as chosen, because the server cannot know which one is.
 */
export default function NetworkSwitch({
	compact = false,
}: {
	compact?: boolean;
}) {
	const network = useNetworkStore((s) => s.network);
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const pendingOn = useNetworkHint((s) => s.pendingOn);
	const restored = useNetworkHydrated();

	useEffect(() => {
		document.documentElement.setAttribute("data-network", network);
	}, [network]);

	return (
		<div
			role="radiogroup"
			aria-label="Network"
			aria-busy={!restored}
			className="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5"
			onKeyDown={(e) => radioGroupKeyDown(e, NETWORKS, network, setNetwork)}
		>
			{NETWORKS.map((n: Network) => (
				// biome-ignore lint/a11y/useSemanticElements: ARIA radio pattern on buttons keeps the segmented-control styling
				<button
					key={n}
					type="button"
					role="radio"
					aria-checked={restored && network === n}
					tabIndex={network === n ? 0 : -1}
					data-net-seg={n}
					onClick={() => setNetwork(n)}
					className={cn(
						"net-seg relative inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
						compact ? "px-1.5" : "px-2.5",
					)}
				>
					{pendingOn === n && network !== n && (
						<span
							className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-warning"
							title={`Something needs you on ${n}`}
						>
							<span className="sr-only">Something needs you on {n}.</span>
						</span>
					)}
					<span
						className={cn(
							"size-1.5 rounded-full",
							n === "mainnet" ? "bg-mainnet" : "bg-testnet",
						)}
						aria-hidden
					/>
					{compact ? (
						<>
							<span className="sm:hidden" aria-hidden>
								{n === "mainnet" ? "Main" : "Test"}
							</span>
							<span className="sr-only sm:not-sr-only">
								{n === "mainnet" ? "Mainnet" : "Testnet"}
							</span>
						</>
					) : (
						<span>{n === "mainnet" ? "Mainnet" : "Testnet"}</span>
					)}
				</button>
			))}
		</div>
	);
}
