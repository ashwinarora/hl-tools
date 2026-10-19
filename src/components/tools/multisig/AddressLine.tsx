import { type Network, networkConfig } from "@hl-tools/core";
import { ArrowUpRight } from "lucide-react";
import { CopyButton } from "#/components/hub/CopyButton";
import { cn } from "#/lib/utils";

/** `0x1234…abcd` for narrow layouts. */
export function short(address: string): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * An address with copy and explorer link. Shows the full address from `sm`
 * up and the short form below it, so tables of addresses fit a phone.
 */
export function AddressLine({
	address,
	network,
	label,
	className,
	explorer = true,
}: {
	address: string;
	network: Network;
	label?: string;
	className?: string;
	explorer?: boolean;
}) {
	return (
		<span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
			{label && <span className="text-xs text-muted-foreground">{label}</span>}
			<span className="hidden min-w-0 break-all font-mono text-[12.5px] sm:inline">
				{address}
			</span>
			<span className="font-mono text-[12.5px] sm:hidden" title={address}>
				{short(address)}
			</span>
			<CopyButton value={address} size="xs" />
			{explorer && (
				<a
					href={networkConfig(network).coreExplorerAddress(address)}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center text-muted-foreground hover:text-foreground"
					title="Open in the HyperCore explorer"
				>
					<ArrowUpRight className="size-3.5" aria-hidden />
					<span className="sr-only">Open in explorer</span>
				</a>
			)}
		</span>
	);
}
