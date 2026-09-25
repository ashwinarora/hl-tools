import { useMemo } from "react";
import { Button } from "#/components/ui/button";
import { useWalletBalances } from "#/hooks/useWalletBalances";
import { useWalletStore } from "#/store/walletStore";

function fmt(v: number): string {
	return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Surfaces auto-origin wallets left over from a previous session (usually
// after an aborted or crashed chain). Rendered only above the AutoModeForm
// when the chain is idle; hidden otherwise (per user preference).
export default function RecoveryBanner({
	onSwitchToManual,
}: {
	onSwitchToManual: () => void;
}) {
	const wallets = useWalletStore((s) => s.wallets);
	const autoWallets = useMemo(
		() => wallets.filter((w) => w.origin === "auto"),
		[wallets],
	);
	const autoAddresses = useMemo(
		() => autoWallets.map((w) => w.address),
		[autoWallets],
	);
	const { balances } = useWalletBalances(autoAddresses, true);

	if (autoWallets.length === 0) return null;

	// A null balance is either "still loading" or "the last fetch errored".
	// Treat those as possibly-holds-funds — the alternative is telling users
	// their wallets are safe to delete when we haven't actually confirmed
	// they're empty.
	const anyPending = autoAddresses.some(
		(addr) =>
			balances[addr]?.mainnet == null || balances[addr]?.testnet == null,
	);
	const totalMainnet = autoAddresses.reduce(
		(sum, addr) => sum + (balances[addr]?.mainnet ?? 0),
		0,
	);
	const totalTestnet = autoAddresses.reduce(
		(sum, addr) => sum + (balances[addr]?.testnet ?? 0),
		0,
	);
	const hasFunds = anyPending || totalMainnet >= 0.005 || totalTestnet >= 0.005;

	let body: string;
	if (anyPending) {
		body =
			"Checking balances — recover in Manual mode or wait for the check to complete.";
	} else if (hasFunds) {
		body = `Funds held: ${fmt(totalMainnet)} mainnet, ${fmt(totalTestnet)} testnet. Recover before they're lost.`;
	} else {
		body =
			"Balances appear to be zero — you can safely delete them in Manual mode.";
	}

	return (
		<div
			className={`mb-3 rounded-lg border p-3.5 text-xs ${
				hasFunds
					? "border-red-500/70 bg-red-500/15 text-red-200 shadow-[0_0_0_1px_rgba(239,68,68,0.15)]"
					: "border-amber-500/60 bg-amber-500/10 text-amber-200"
			}`}
		>
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-semibold">
						⚠ You have {autoWallets.length} wallet
						{autoWallets.length === 1 ? "" : "s"} from a previous session.
					</p>
					<p className="mt-1 text-[13px] opacity-95">{body}</p>
				</div>
				<Button
					size="xs"
					variant={hasFunds ? "destructive" : "outline"}
					onClick={onSwitchToManual}
				>
					View & recover →
				</Button>
			</div>
		</div>
	);
}
