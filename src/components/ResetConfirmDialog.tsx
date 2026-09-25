import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";

export interface WalletAtRisk {
	// 1-based position — chain wallet index for auto reset, store position
	// for the manual Delete All flow. Shown so users can cross-reference the
	// dialog against the wallet rows they're staring at.
	index: number;
	address: `0x${string}`;
	mainnet: number;
	testnet: number;
}

function truncateAddress(addr: string): string {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmt(v: number): string {
	return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ResetConfirmDialog({
	open,
	onOpenChange,
	walletsAtRisk,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	walletsAtRisk: WalletAtRisk[];
	onConfirm: () => void;
}) {
	const totalMainnet = walletsAtRisk.reduce((sum, w) => sum + w.mainnet, 0);
	const totalTestnet = walletsAtRisk.reduce((sum, w) => sum + w.testnet, 0);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="text-destructive">
						Delete these wallets forever?
					</DialogTitle>
					<DialogDescription>
						The private keys are about to be permanently deleted from your
						browser. If you haven&apos;t backed up the private keys, any funds
						still in them will become unrecoverable — Hyperliquid has no way to
						restore access.
					</DialogDescription>
				</DialogHeader>

				<div className="max-h-64 overflow-y-auto rounded-md border border-border">
					<table className="w-full text-xs">
						<thead className="bg-muted/50 text-muted-foreground">
							<tr>
								<th className="p-2 text-left font-medium">Wallet</th>
								<th className="p-2 text-left font-medium">Address</th>
								<th className="p-2 text-right font-medium">Mainnet</th>
								<th className="p-2 text-right font-medium">Testnet</th>
							</tr>
						</thead>
						<tbody>
							{walletsAtRisk.map((w) => (
								<tr key={w.address} className="border-t border-border">
									<td className="p-2 font-medium">#{w.index}</td>
									<td className="p-2 font-mono">
										{truncateAddress(w.address)}
									</td>
									<td className="p-2 text-right tabular-nums">
										{fmt(w.mainnet)}
									</td>
									<td className="p-2 text-right tabular-nums">
										{fmt(w.testnet)}
									</td>
								</tr>
							))}
						</tbody>
						<tfoot className="bg-muted/30 font-semibold">
							<tr className="border-t border-border">
								<td className="p-2" colSpan={2}>
									Total at risk
								</td>
								<td className="p-2 text-right tabular-nums">
									{fmt(totalMainnet)}
								</td>
								<td className="p-2 text-right tabular-nums">
									{fmt(totalTestnet)}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						size="sm"
						onClick={() => onOpenChange(false)}
						autoFocus
					>
						Go back and drain first
					</Button>
					<Button
						variant="destructive"
						size="sm"
						onClick={() => {
							onConfirm();
							onOpenChange(false);
						}}
					>
						I know — delete forever
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
