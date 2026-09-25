import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount, useWalletClient } from "wagmi";
import ResetConfirmDialog, {
	type WalletAtRisk,
} from "#/components/ResetConfirmDialog";
import { Button } from "#/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { useWalletBalances } from "#/hooks/useWalletBalances";
import {
	claimFaucet,
	decideChainKind,
	dexForKind,
	drainGeneratedWallet,
	fetchUsdcBalance,
	fetchUserProfile,
	sendFromUserWallet,
} from "#/lib/hlActions";
import { type GeneratedWallet, useWalletStore } from "#/store/walletStore";

function truncateAddress(addr: string) {
	return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmt(value: number | null): string {
	if (value === null) return "—";
	return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const columnHelper = createColumnHelper<GeneratedWallet>();

export default function WalletTable() {
	const { address: userAddress } = useAccount();
	const { data: walletClient } = useWalletClient();
	const { wallets, addWallet, removeWallet } = useWalletStore();
	const [loading, setLoading] = useState<Record<string, string>>({});
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [walletsAtRisk, setWalletsAtRisk] = useState<WalletAtRisk[]>([]);
	// Synchronous mutex per (address, action) — protects against rapid
	// double-clicks that could open two Rabby popups in sequence. React state
	// isn't a reliable guard because it doesn't commit until after the handler.
	const busyRef = useRef(new Set<string>());

	const addresses = useMemo(() => wallets.map((w) => w.address), [wallets]);
	const { balances, refresh } = useWalletBalances(addresses, true);

	const setWalletLoading = (addr: string, action: string | null) => {
		setLoading((prev) => {
			if (action === null) {
				const next = { ...prev };
				delete next[addr];
				return next;
			}
			return { ...prev, [addr]: action };
		});
	};

	const handleReceive = async (addr: `0x${string}`) => {
		if (!walletClient || !userAddress) return;
		const key = `${addr}:receive`;
		if (busyRef.current.has(key)) return;
		busyRef.current.add(key);
		setWalletLoading(addr, "receive");
		setRowErrors((prev) => {
			const next = { ...prev };
			delete next[addr];
			return next;
		});
		const toastId = toast.loading("Activating wallet", {
			description: `Signing $1 send to ${truncateAddress(addr)}…`,
		});
		try {
			const profile = await fetchUserProfile(userAddress, false);
			const kind = decideChainKind(profile, 2);
			if (kind === null) {
				const msg = `Not enough USDC — need $2 total ($1 sent + $1 activation fee). You have $${Math.max(profile.spotUsdc, profile.perpsWithdrawable).toFixed(2)}.`;
				setRowErrors((prev) => ({ ...prev, [addr]: msg }));
				toast.error("Insufficient balance", { id: toastId, description: msg });
				return;
			}
			const dex = dexForKind(kind);
			await sendFromUserWallet(walletClient, addr, "1", dex, dex, false);
			toast.success("Wallet activated", {
				id: toastId,
				description: `${truncateAddress(addr)} received $1 (+ $1 activation fee).`,
			});
		} catch (e) {
			console.error("Receive failed:", e);
			const msg = e instanceof Error ? e.message : String(e);
			setRowErrors((prev) => ({ ...prev, [addr]: msg }));
			toast.error("Activation failed", { id: toastId, description: msg });
		} finally {
			setWalletLoading(addr, null);
			busyRef.current.delete(`${addr}:receive`);
		}
	};

	const handleClaimFaucet = async (addr: `0x${string}`) => {
		const key = `${addr}:faucet`;
		if (busyRef.current.has(key)) return;
		busyRef.current.add(key);
		setWalletLoading(addr, "faucet");
		const toastId = toast.loading("Claiming faucet", {
			description: `Requesting testnet USDC for ${truncateAddress(addr)}…`,
		});
		try {
			const res = await claimFaucet(addr);
			// Hyperliquid returns a plain string on failure (e.g. "Cannot claim
			// drip because user 0x… does not exist on mainnet.") and an empty
			// body on success.
			if (typeof res === "string") {
				toast.error("Faucet claim failed", { id: toastId, description: res });
			} else {
				toast.success("Faucet claimed", {
					id: toastId,
					description: `Testnet USDC will land in ${truncateAddress(addr)} shortly.`,
				});
			}
		} catch (e) {
			console.error("Faucet claim failed:", e);
			toast.error("Faucet claim failed", {
				id: toastId,
				description: e instanceof Error ? e.message : String(e),
			});
		} finally {
			setWalletLoading(addr, null);
			busyRef.current.delete(key);
		}
	};

	const handleSend = async (wallet: GeneratedWallet, isTestnet: boolean) => {
		if (!userAddress) return;
		const action = isTestnet ? "sendTestnet" : "sendMainnet";
		const mutexKey = `${wallet.address}:${action}`;
		if (busyRef.current.has(mutexKey)) return;
		busyRef.current.add(mutexKey);
		setWalletLoading(wallet.address, action);
		const network = isTestnet ? "testnet" : "mainnet";
		const toastId = toast.loading(`Draining ${network}`, {
			description: `Checking ${truncateAddress(wallet.address)}…`,
		});
		try {
			// Preflight the balance so we can tell the user WHY the send won't
			// happen rather than silently no-op.
			const [perp, spot] = await Promise.all([
				fetchUsdcBalance(wallet.address, isTestnet, "perp"),
				fetchUsdcBalance(wallet.address, isTestnet, "spot"),
			]);
			if (perp <= 0 && spot <= 0) {
				toast.info("Nothing to drain", {
					id: toastId,
					description: `${truncateAddress(wallet.address)} holds $0.00 on ${network}.`,
				});
				return;
			}
			const sent = await drainGeneratedWallet(
				wallet.privateKey,
				userAddress,
				isTestnet,
			);
			if (sent) {
				toast.success(`Drained ${network}`, {
					id: toastId,
					description: `${truncateAddress(wallet.address)} → your wallet.`,
				});
			} else {
				toast.info("Nothing to drain", {
					id: toastId,
					description: "Balance was too low after reserving activation fee.",
				});
			}
			refresh();
		} catch (e) {
			console.error(`Send ${network} failed:`, e);
			toast.error(`Drain ${network} failed`, {
				id: toastId,
				description: e instanceof Error ? e.message : String(e),
			});
		} finally {
			setWalletLoading(wallet.address, null);
			busyRef.current.delete(mutexKey);
		}
	};

	const handleRefresh = async () => {
		const toastId = toast.loading("Refreshing balances", {
			description: `${wallets.length} wallet${wallets.length === 1 ? "" : "s"}…`,
		});
		try {
			await refresh();
			toast.success("Balances refreshed", { id: toastId });
		} catch (e) {
			toast.error("Refresh failed", {
				id: toastId,
				description: e instanceof Error ? e.message : String(e),
			});
		}
	};

	// Delete all wallets (both origins) with a confirmation modal identical to
	// the auto-mode Reset flow. Queries live balances so the user sees exactly
	// what will become unrecoverable.
	const handleDeleteAllClick = async () => {
		const toastId = toast.loading("Checking balances", {
			description: "Scanning wallets for residual funds…",
		});
		try {
			const results = await Promise.all(
				wallets.map(async (w, i) => {
					const [mainPerp, mainSpot, testPerp, testSpot] = await Promise.all([
						fetchUsdcBalance(w.address, false, "perp"),
						fetchUsdcBalance(w.address, false, "spot"),
						fetchUsdcBalance(w.address, true, "perp"),
						fetchUsdcBalance(w.address, true, "spot"),
					]);
					return {
						index: i + 1,
						address: w.address,
						mainnet: mainPerp + mainSpot,
						testnet: testPerp + testSpot,
					};
				}),
			);
			const risky = results.filter(
				(r) => r.mainnet >= 0.005 || r.testnet >= 0.005,
			);
			if (risky.length === 0) {
				const count = wallets.length;
				for (const w of wallets) removeWallet(w.address);
				toast.success("All wallets removed", {
					id: toastId,
					description: `Deleted ${count} wallet${count === 1 ? "" : "s"} — all balances were $0.`,
				});
				return;
			}
			toast.warning("Confirmation needed", {
				id: toastId,
				description: `${risky.length} wallet${risky.length === 1 ? "" : "s"} still hold${risky.length === 1 ? "s" : ""} funds.`,
			});
			setWalletsAtRisk(risky);
			setDeleteDialogOpen(true);
		} catch (e) {
			toast.error("Balance check failed", {
				id: toastId,
				description: e instanceof Error ? e.message : String(e),
			});
		}
	};

	const handleForceDeleteAll = () => {
		const count = wallets.length;
		for (const w of wallets) removeWallet(w.address);
		toast.warning("All wallets deleted forever", {
			description: `${count} wallet${count === 1 ? "" : "s"} removed. Private keys are gone.`,
		});
	};

	const columns = [
		columnHelper.accessor("address", {
			header: "Address",
			cell: ({ getValue, row }) => {
				const addr = getValue();
				const origin = row.original.origin;
				return (
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="flex items-center gap-1 font-mono text-xs"
							onClick={() => {
								navigator.clipboard.writeText(addr);
								toast.success("Address copied", {
									description: addr,
								});
							}}
							title="Copy address"
						>
							{truncateAddress(addr)}
							<Copy className="h-3 w-3 text-muted-foreground" />
						</button>
						<span
							className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
								origin === "auto"
									? "bg-primary/10 text-primary"
									: "bg-muted text-muted-foreground"
							}`}
						>
							{origin}
						</span>
					</div>
				);
			},
		}),
		columnHelper.display({
			id: "mainnetBalance",
			header: "Mainnet Bal",
			cell: ({ row }) => (
				<span className="text-xs tabular-nums">
					{fmt(balances[row.original.address]?.mainnet ?? null)}
				</span>
			),
		}),
		columnHelper.display({
			id: "receive",
			header: "Activate",
			cell: ({ row }) => {
				if (row.original.origin === "auto") {
					return <span className="text-[10px] text-muted-foreground">—</span>;
				}
				return (
					<div className="flex flex-col gap-1">
						<Button
							size="xs"
							variant="outline"
							disabled={loading[row.original.address] === "receive"}
							onClick={() => handleReceive(row.original.address)}
						>
							{loading[row.original.address] === "receive"
								? "..."
								: "Receive $1"}
						</Button>
						{rowErrors[row.original.address] && (
							<span className="max-w-40 text-[10px] leading-tight text-destructive">
								{rowErrors[row.original.address]}
							</span>
						)}
					</div>
				);
			},
		}),
		columnHelper.display({
			id: "claimFaucet",
			header: "Faucet",
			cell: ({ row }) => (
				<Button
					size="xs"
					variant="outline"
					disabled={loading[row.original.address] === "faucet"}
					onClick={() => handleClaimFaucet(row.original.address)}
				>
					{loading[row.original.address] === "faucet" ? "..." : "Claim"}
				</Button>
			),
		}),
		columnHelper.display({
			id: "testnetBalance",
			header: "Testnet Bal",
			cell: ({ row }) => (
				<span className="text-xs tabular-nums">
					{fmt(balances[row.original.address]?.testnet ?? null)}
				</span>
			),
		}),
		columnHelper.display({
			id: "sendTestnet",
			header: "Drain Testnet",
			cell: ({ row }) => (
				<Button
					size="xs"
					variant="outline"
					disabled={loading[row.original.address] === "sendTestnet"}
					onClick={() => handleSend(row.original, true)}
				>
					{loading[row.original.address] === "sendTestnet" ? "..." : "Drain"}
				</Button>
			),
		}),
		columnHelper.display({
			id: "sendMainnet",
			header: "Drain Mainnet",
			cell: ({ row }) => (
				<Button
					size="xs"
					variant="outline"
					disabled={loading[row.original.address] === "sendMainnet"}
					onClick={() => handleSend(row.original, false)}
				>
					{loading[row.original.address] === "sendMainnet" ? "..." : "Drain"}
				</Button>
			),
		}),
		columnHelper.display({
			id: "delete",
			header: "",
			cell: ({ row }) => (
				<Button
					size="icon-xs"
					variant="ghost"
					onClick={() => {
						const addr = row.original.address;
						removeWallet(addr);
						toast.info("Wallet deleted", {
							description: `${truncateAddress(addr)} removed from browser storage.`,
						});
					}}
					title="Delete wallet"
				>
					<Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
				</Button>
			),
		}),
	];

	const table = useReactTable({
		data: wallets,
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Button
					size="sm"
					onClick={() => {
						addWallet();
						toast.info("Wallet generated", {
							description:
								"A new manual wallet was added. Click 'Receive $1' to activate it.",
						});
					}}
				>
					<Plus className="h-4 w-4" />
					Add Wallet
				</Button>
				{wallets.length > 0 && (
					<>
						<Button size="sm" variant="outline" onClick={handleRefresh}>
							<RefreshCw className="h-4 w-4" />
							Refresh all balances
						</Button>
						<Button
							size="sm"
							variant="destructive"
							onClick={handleDeleteAllClick}
						>
							<Trash2 className="h-4 w-4" />
							Delete all wallets
						</Button>
					</>
				)}
			</div>

			{wallets.length > 0 && (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							{table.getHeaderGroups().map((hg) => (
								<TableRow key={hg.id}>
									{hg.headers.map((header) => (
										<TableHead key={header.id} className="text-xs">
											{header.isPlaceholder
												? null
												: flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
										</TableHead>
									))}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{table.getRowModel().rows.map((row) => (
								<TableRow key={row.id}>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id} className="py-2">
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<ResetConfirmDialog
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				walletsAtRisk={walletsAtRisk}
				onConfirm={handleForceDeleteAll}
			/>
		</div>
	);
}
