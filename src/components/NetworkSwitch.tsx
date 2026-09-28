import { NETWORKS, type Network } from "@hl-tools/core";
import { useEffect } from "react";
import { cn } from "#/lib/utils";
import { useNetworkStore } from "#/store/networkStore";

/**
 * Global mainnet/testnet switch. The active segment is styled from
 * <html data-network>, which an inline script sets before hydration, so the
 * persisted choice renders correctly on first paint.
 */
export default function NetworkSwitch({
	compact = false,
}: {
	compact?: boolean;
}) {
	const network = useNetworkStore((s) => s.network);
	const setNetwork = useNetworkStore((s) => s.setNetwork);

	useEffect(() => {
		document.documentElement.setAttribute("data-network", network);
	}, [network]);

	return (
		<div
			role="radiogroup"
			aria-label="Network"
			className="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5"
		>
			{NETWORKS.map((n: Network) => (
				<button
					key={n}
					type="button"
					role="radio"
					aria-checked={network === n}
					data-net-seg={n}
					onClick={() => setNetwork(n)}
					className={cn(
						"net-seg inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
						compact ? "px-1.5" : "px-2.5",
					)}
				>
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
