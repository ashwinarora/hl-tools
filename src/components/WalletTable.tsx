import {
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { Button } from "#/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import {
	claimFaucet,
	decideChainKind,
	dexForKind,
	fetchBalance,
	fetchUserProfile,
	isUnifiedLike,
	sendFromGeneratedWallet,
	sendFromUserWallet,
	TRANSFER_FEE_BUFFER,
} from "#/lib/hlActions";
import { type GeneratedWallet, useWalletStore } from "#/store/walletStore";

type BalanceMap = Record<
	string,
	{ mainnet: number | null; testnet: number | null }
>;

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
	const [balances, setBalances] = useState<BalanceMap>({});
	const [loading, setLoading] = useState<Record<string, string>>({});
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

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

	const refreshBalances = useCallback(async () => {
		const updates: BalanceMap = {};
		await Promise.all(
			wallets.map(async (w) => {
				const [mainnet, testnet] = await Promise.all([
					fetchBalance(w.address, false).catch(() => null),
					fetchBalance(w.address, true).catch(() => null),
				]);
				updates[w.address] = { mainnet, testnet };
			}),
		);
		setBalances((prev) => ({ ...prev, ...updates }));
	}, [wallets]);

	const handleReceive = async (addr: `0x${string}`) => {
		if (!walletClient || !userAddress) return;
		setWalletLoading(addr, "receive");
		setRowErrors((prev) => {
			const next = { ...prev };
			delete next[addr];
			return next;
		});
		try {
			const profile = await fetchUserProfile(userAddress, false);
			const kind = decideChainKind(profile, 2);
			if (kind === null) {
				setRowErrors((prev) => ({
					...prev,
					[addr]: `Not enough USDC — need $2. You have $${Math.max(profile.spotUsdc, profile.perpsWithdrawable).toFixed(2)}.`,
				}));
				return;
			}
			const dex = dexForKind(kind);
			await sendFromUserWallet(walletClient, addr, "2", dex, dex, false);
		} catch (e) {
			console.error("Receive failed:", e);
			setRowErrors((prev) => ({
				...prev,
				[addr]: e instanceof Error ? e.message : String(e),
			}));
		} finally {
			setWalletLoading(addr, null);
		}
	};

	const handleClaimFaucet = async (addr: `0x${string}`) => {
		setWalletLoading(addr, "faucet");
		try {
			await claimFaucet(addr);
		} catch (e) {
			console.error("Faucet claim failed:", e);
		} finally {
			setWalletLoading(addr, null);
		}
	};

	const handleSend = async (wallet: GeneratedWallet, isTestnet: boolean) => {
		if (!userAddress) return;
		const key = isTestnet ? "sendTestnet" : "sendMainnet";
		setWalletLoading(wallet.address, key);
		try {
			const bal = isTestnet
				? balances[wallet.address]?.testnet
				: balances[wallet.address]?.mainnet;
			if (!bal || bal <= 0) return;
			const amount = (bal - TRANSFER_FEE_BUFFER).toFixed(2);
			if (Number.parseFloat(amount) <= 0) return;
			// Wallet's mainnet/testnet money is in its perps (faucet, or usd-kind seed).
			// Destination follows the user's mode: unified/PM users can only receive on spot.
			const userProfile = await fetchUserProfile(userAddress, isTestnet).catch(
				() => null,
			);
			const destDex =
				userProfile && isUnifiedLike(userProfile.abstraction) ? "spot" : "";
			await sendFromGeneratedWallet(
				wallet.privateKey,
				userAddress,
				amount,
				isTestnet,
				"",
				destDex,
			);
		} catch (e) {
			console.error(`Send ${isTestnet ? "testnet" : "mainnet"} failed:`, e);
		} finally {
			setWalletLoading(wallet.address, null);
		}
	};

	const columns = [
		columnHelper.accessor("address", {
			header: "Address",
			cell: ({ getValue }) => {
				const addr = getValue();
				return (
					<button
						type="button"
						className="flex items-center gap-1 font-mono text-xs"
						onClick={() => navigator.clipboard.writeText(addr)}
						title="Copy address"
					>
						{truncateAddress(addr)}
						<Copy className="h-3 w-3 text-muted-foreground" />
					</button>
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
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<Button
						size="xs"
						variant="outline"
						disabled={loading[row.original.address] === "receive"}
						onClick={() => handleReceive(row.original.address)}
					>
						{loading[row.original.address] === "receive" ? "..." : "Receive $2"}
					</Button>
					{rowErrors[row.original.address] && (
						<span className="max-w-40 text-[10px] leading-tight text-destructive">
							{rowErrors[row.original.address]}
						</span>
					)}
				</div>
			),
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
					{loading[row.original.address] === "sendTestnet" ? "..." : "Send"}
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
					{loading[row.original.address] === "sendMainnet" ? "..." : "Send"}
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
					onClick={() => removeWallet(row.original.address)}
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
				<Button size="sm" onClick={addWallet}>
					<Plus className="h-4 w-4" />
					Add Wallet
				</Button>
				{wallets.length > 0 && (
					<Button size="sm" variant="outline" onClick={refreshBalances}>
						<RefreshCw className="h-4 w-4" />
						Refresh
					</Button>
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
		</div>
	);
}
