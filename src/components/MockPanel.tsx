import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "#/components/ui/button";
import { useMockLedger } from "#/mocks/ledger";

function truncate(addr: string) {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function useMSWActive(): boolean {
	const [active, setActive] = useState(false);
	useEffect(() => {
		if (typeof window === "undefined") return;
		const check = () =>
			setActive(!!(window as unknown as { __mswActive?: boolean }).__mswActive);
		check();
		const id = window.setInterval(check, 250);
		return () => window.clearInterval(id);
	}, []);
	return active;
}

export default function MockPanel() {
	const mswActive = useMSWActive();
	const [collapsed, setCollapsed] = useState(false);
	const [seedAmount, setSeedAmount] = useState("10");
	const { address } = useAccount();
	const mainnet = useMockLedger((s) => s.mainnet);
	const testnet = useMockLedger((s) => s.testnet);
	const config = useMockLedger((s) => s.config);
	const setDelays = useMockLedger((s) => s.setDelays);
	const setFaucet = useMockLedger((s) => s.setFaucet);
	const credit = useMockLedger((s) => s.credit);
	const setActivated = useMockLedger((s) => s.setActivated);
	const setAbstraction = useMockLedger((s) => s.setAbstraction);
	const resetAll = useMockLedger((s) => s.resetAll);

	if (!mswActive) return null;

	const mainnetRows = Array.from(mainnet.entries());
	const testnetRows = Array.from(testnet.entries());

	function seedUser() {
		if (!address) return;
		const amt = Number.parseFloat(seedAmount);
		if (!Number.isFinite(amt) || amt <= 0) return;
		credit("mainnet", address, "perp", amt);
		setActivated("mainnet", address);
	}

	return (
		<div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-amber-500/40 bg-background/95 shadow-lg backdrop-blur">
			<button
				type="button"
				className="flex w-full cursor-pointer items-center justify-between border-b border-border p-2 text-xs font-semibold text-amber-500"
				onClick={() => setCollapsed((c) => !c)}
			>
				<span>⚡ Mock Panel {collapsed ? "▸" : "▾"}</span>
				<span className="text-[10px] text-muted-foreground">
					MSW intercepting
				</span>
			</button>
			{!collapsed && (
				<div className="space-y-3 p-3 text-xs">
					{/* Seed user */}
					<div>
						<div className="mb-1 font-medium">Seed connected user</div>
						{address ? (
							<div className="flex gap-1">
								<input
									type="text"
									value={seedAmount}
									onChange={(e) => setSeedAmount(e.target.value)}
									className="w-16 rounded border bg-transparent px-1 py-0.5"
								/>
								<Button size="xs" variant="outline" onClick={seedUser}>
									Credit mainnet perp
								</Button>
							</div>
						) : (
							<div className="text-muted-foreground">
								Connect a wallet to seed
							</div>
						)}
					</div>

					{/* Delays */}
					<div>
						<div className="mb-1 font-medium">Delays (ms)</div>
						<div className="grid grid-cols-3 gap-1">
							{(["send", "faucet", "info"] as const).map((k) => (
								<label key={k} className="flex flex-col">
									<span className="text-[10px] text-muted-foreground">{k}</span>
									<input
										type="number"
										value={config.delays[k]}
										onChange={(e) => setDelays({ [k]: Number(e.target.value) })}
										className="rounded border bg-transparent px-1 py-0.5"
									/>
								</label>
							))}
						</div>
					</div>

					{/* Faucet controls */}
					<div>
						<div className="mb-1 font-medium">Faucet</div>
						<div className="flex items-center gap-2">
							<label className="flex items-center gap-1">
								<input
									type="checkbox"
									checked={config.faucet.forceFailure}
									onChange={(e) =>
										setFaucet({ forceFailure: e.target.checked })
									}
								/>
								<span>Force fail</span>
							</label>
							<label className="flex items-center gap-1">
								<span>Amount:</span>
								<input
									type="number"
									value={config.faucet.amount}
									onChange={(e) =>
										setFaucet({ amount: Number(e.target.value) })
									}
									className="w-16 rounded border bg-transparent px-1 py-0.5"
								/>
							</label>
						</div>
					</div>

					{/* User abstraction */}
					{address && (
						<div>
							<div className="mb-1 font-medium">User abstraction (testnet)</div>
							<select
								value={
									testnet.get(address.toLowerCase() as `0x${string}`)
										?.abstraction ?? "disabled"
								}
								onChange={(e) =>
									setAbstraction(
										"testnet",
										address,
										e.target.value as
											| "disabled"
											| "unifiedAccount"
											| "portfolioMargin",
									)
								}
								className="w-full rounded border bg-transparent px-1 py-0.5"
							>
								<option value="disabled">Standard</option>
								<option value="unifiedAccount">Unified</option>
								<option value="portfolioMargin">Portfolio Margin</option>
							</select>
						</div>
					)}

					{/* Ledger snapshot */}
					<div>
						<div className="mb-1 font-medium">
							Ledger — mainnet ({mainnetRows.length})
						</div>
						<div className="max-h-24 overflow-y-auto rounded border border-border bg-muted/30 p-1 font-mono text-[10px]">
							{mainnetRows.length === 0 ? (
								<span className="text-muted-foreground">empty</span>
							) : (
								mainnetRows.map(([addr, s]) => (
									<div key={addr}>
										{truncate(addr)} p={s.perp.toFixed(2)} s={s.spot.toFixed(2)}{" "}
										{s.activated ? "✓" : "○"}
									</div>
								))
							)}
						</div>
					</div>
					<div>
						<div className="mb-1 font-medium">
							Ledger — testnet ({testnetRows.length})
						</div>
						<div className="max-h-24 overflow-y-auto rounded border border-border bg-muted/30 p-1 font-mono text-[10px]">
							{testnetRows.length === 0 ? (
								<span className="text-muted-foreground">empty</span>
							) : (
								testnetRows.map(([addr, s]) => (
									<div key={addr}>
										{truncate(addr)} p={s.perp.toFixed(2)} s={s.spot.toFixed(2)}{" "}
										{s.activated ? "✓" : "○"}
									</div>
								))
							)}
						</div>
					</div>

					<Button
						size="xs"
						variant="destructive"
						onClick={resetAll}
						className="w-full"
					>
						Reset ledger
					</Button>
				</div>
			)}
		</div>
	);
}
