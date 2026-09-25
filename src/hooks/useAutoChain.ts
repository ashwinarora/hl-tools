import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useReducer, useRef } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useWalletClient } from "wagmi";
import {
	claimFaucet,
	decideChainKind,
	dexForKind,
	fetchUsdcBalance,
	fetchUserProfile,
	isUserActivated,
	pocketForKind,
	type SendKind,
	sendFromGeneratedWallet,
	sendFromUserWallet,
	TRANSFER_FEE_BUFFER,
	userDestinationDex,
} from "#/lib/hlActions";
import { useWalletStore } from "#/store/walletStore";

// --- Types ---

export type SubStep = "claim-faucet" | "drain-testnet" | "forward-mainnet";

export type WalletStepStatus =
	| "pending"
	| "in-progress"
	| "completed"
	| "error";

export interface WalletStep {
	index: number;
	address: `0x${string}`;
	privateKey: `0x${string}`;
	status: WalletStepStatus;
	currentSubStep: SubStep | null;
	completedSubSteps: SubStep[];
	error: string | null;
}

export type ChainStatus =
	| "idle"
	| "seeding"
	| "running"
	| "completed"
	| "error"
	| "aborted";

export interface ChainState {
	status: ChainStatus;
	wallets: WalletStep[];
	currentWalletIndex: number;
	totalTestnetCollected: number;
	inputAmount: number;
	error: string | null;
	chainKind: SendKind | null;
}

// --- Reducer ---

type ChainAction =
	| { type: "START"; inputAmount: number }
	| { type: "SET_KIND"; kind: SendKind }
	| { type: "SEED_START" }
	| { type: "SEED_COMPLETE" }
	| {
			type: "ADD_WALLET";
			wallet: Omit<
				WalletStep,
				"status" | "currentSubStep" | "completedSubSteps" | "error"
			>;
	  }
	| { type: "SET_SUBSTEP"; index: number; subStep: SubStep }
	| { type: "COMPLETE_SUBSTEP"; index: number; subStep: SubStep }
	| { type: "WALLET_COMPLETE"; index: number }
	| { type: "WALLET_ERROR"; index: number; error: string }
	| { type: "COLLECT_TESTNET"; amount: number }
	| { type: "CHAIN_COMPLETE" }
	| { type: "CHAIN_ERROR"; error: string }
	| { type: "CHAIN_ABORT" }
	| { type: "RESET" };

const initialState: ChainState = {
	status: "idle",
	wallets: [],
	currentWalletIndex: 0,
	totalTestnetCollected: 0,
	inputAmount: 0,
	error: null,
	chainKind: null,
};

function chainReducer(state: ChainState, action: ChainAction): ChainState {
	switch (action.type) {
		case "START":
			return {
				...initialState,
				status: "seeding",
				inputAmount: action.inputAmount,
			};
		case "SET_KIND":
			return { ...state, chainKind: action.kind };
		case "SEED_START":
			return { ...state, status: "seeding" };
		case "SEED_COMPLETE":
			return { ...state, status: "running" };
		case "ADD_WALLET":
			return {
				...state,
				wallets: [
					...state.wallets,
					{
						...action.wallet,
						status: "pending",
						currentSubStep: null,
						completedSubSteps: [],
						error: null,
					},
				],
			};
		case "SET_SUBSTEP":
			return {
				...state,
				currentWalletIndex: action.index,
				wallets: state.wallets.map((w) =>
					w.index === action.index
						? {
								...w,
								status: "in-progress",
								currentSubStep: action.subStep,
								error: null,
							}
						: w,
				),
			};
		case "COMPLETE_SUBSTEP":
			return {
				...state,
				wallets: state.wallets.map((w) =>
					w.index === action.index
						? {
								...w,
								completedSubSteps: [...w.completedSubSteps, action.subStep],
								currentSubStep: null,
							}
						: w,
				),
			};
		case "WALLET_COMPLETE":
			return {
				...state,
				wallets: state.wallets.map((w) =>
					w.index === action.index
						? { ...w, status: "completed", currentSubStep: null }
						: w,
				),
			};
		case "WALLET_ERROR":
			return {
				...state,
				status: "error",
				wallets: state.wallets.map((w) =>
					w.index === action.index
						? { ...w, status: "error", error: action.error }
						: w,
				),
			};
		case "COLLECT_TESTNET":
			return {
				...state,
				totalTestnetCollected: state.totalTestnetCollected + action.amount,
			};
		case "CHAIN_COMPLETE":
			return { ...state, status: "completed" };
		case "CHAIN_ERROR":
			return { ...state, status: "error", error: action.error };
		case "CHAIN_ABORT":
			// Flip any in-progress wallet to error so the drain buttons unblock
			// (canDrain in AutoMode checks status !== "in-progress"). Preserves
			// completed wallets and their balances so the user can drain them.
			return {
				...state,
				status: "aborted",
				wallets: state.wallets.map((w) =>
					w.status === "in-progress"
						? {
								...w,
								status: "error",
								currentSubStep: null,
								error: "Aborted by user",
							}
						: w,
				),
			};
		case "RESET":
			return initialState;
		default:
			return state;
	}
}

// --- Helpers ---

function generateWallet() {
	const privateKey = generatePrivateKey();
	const account = privateKeyToAccount(privateKey);
	return { privateKey, address: account.address as `0x${string}` };
}

async function waitForBalance(
	address: `0x${string}`,
	isTestnet: boolean,
	pocket: "perp" | "spot",
	minBalance = 0.5,
	maxRetries = 15,
): Promise<number> {
	for (let i = 0; i < maxRetries; i++) {
		const bal = await fetchUsdcBalance(address, isTestnet, pocket);
		if (bal >= minBalance) return bal;
		await new Promise((r) => setTimeout(r, 2000));
	}
	throw new Error(
		`Balance did not appear for ${address} after ${maxRetries * 2}s`,
	);
}

// --- Hook ---

export function useAutoChain() {
	const [state, dispatch] = useReducer(chainReducer, initialState);
	const { data: walletClient } = useWalletClient();
	const { address: userAddress } = useAccount();
	const queryClient = useQueryClient();
	const abortRef = useRef(false);
	const runningRef = useRef(false);

	// Force the balance-polling hook to refetch the given wallet on demand.
	// Used after each sub-step so row balances catch up to on-chain state
	// without waiting for the next 3s poll tick.
	const invalidateWalletBalance = useCallback(
		(address: `0x${string}`) => {
			queryClient.invalidateQueries({
				queryKey: ["wallet-balance", address],
			});
		},
		[queryClient],
	);

	const start = useCallback(
		async (inputAmount: number) => {
			if (!walletClient || !userAddress) return;
			if (runningRef.current) return;
			runningRef.current = true;
			abortRef.current = false;

			const N = inputAmount;
			let currentIdx = 0;
			dispatch({ type: "START", inputAmount: N });

			try {
				// Preflight: decide which mainnet pocket funds the chain.
				const profile = await fetchUserProfile(userAddress, false);
				const kind = decideChainKind(profile, N + 1);
				if (kind === null) {
					const have = Math.max(
						profile.perpsWithdrawable,
						profile.spotUsdc,
					).toFixed(2);
					const pocket =
						profile.abstraction === "unifiedAccount" ||
						profile.abstraction === "portfolioMargin"
							? "spot"
							: "spot or perps";
					dispatch({
						type: "CHAIN_ERROR",
						error: `Insufficient USDC — need $${N + 1} in your ${pocket}. You have $${have}.`,
					});
					return;
				}
				dispatch({ type: "SET_KIND", kind });
				const mainnetPocket = pocketForKind(kind);
				const chainDex = dexForKind(kind);
				// Testnet drain destination depends on user's testnet mode.
				const userTestnetProfile = await fetchUserProfile(userAddress, true)
					.then((p) => p)
					.catch(() => null);
				const userTestnetDestDex = userDestinationDex(
					userTestnetProfile?.abstraction ?? "disabled",
					"",
				);
				const userMainnetDestDex = userDestinationDex(
					profile.abstraction,
					chainDex,
				);
				// Whether the user is activated on testnet — decides if we need to
				// reserve $1 on the first drain-testnet. After the first successful
				// drain, the user is activated so subsequent drains skip the reserve.
				let userTestnetActivated = await isUserActivated(
					userAddress,
					true,
				).catch(() => false);

				// Generate wallet #1
				const wallet1 = generateWallet();
				useWalletStore
					.getState()
					.addAutoWallet(wallet1.privateKey, wallet1.address);
				dispatch({
					type: "ADD_WALLET",
					wallet: {
						index: 0,
						address: wallet1.address,
						privateKey: wallet1.privateKey,
					},
				});

				// Seed: user signs for $N USDC to wallet #1. Hyperliquid charges an
				// additional $1 activation fee on top (wallet #1 is fresh), so total
				// wallet outflow is $N + $1. Recipient receives exactly $N.
				dispatch({ type: "SEED_START" });
				await sendFromUserWallet(
					walletClient,
					wallet1.address,
					String(N),
					chainDex,
					chainDex,
					false,
				);
				dispatch({ type: "SEED_COMPLETE" });

				// Wait for wallet #1 to receive mainnet balance in the seeded pocket
				await waitForBalance(wallet1.address, false, mainnetPocket);

				let currentWallet = wallet1;

				for (let i = 0; i < N; i++) {
					currentIdx = i;
					if (abortRef.current) break;

					// Claim faucet (money always lands in the generated wallet's perps)
					dispatch({ type: "SET_SUBSTEP", index: i, subStep: "claim-faucet" });
					await claimFaucet(currentWallet.address);
					dispatch({
						type: "COMPLETE_SUBSTEP",
						index: i,
						subStep: "claim-faucet",
					});
					invalidateWalletBalance(currentWallet.address);

					if (abortRef.current) break;

					// Wait for testnet perps balance then drain to user. Reserve $1
					// only if the user isn't yet activated on testnet; after the first
					// successful drain, they will be, so subsequent drains send full.
					dispatch({ type: "SET_SUBSTEP", index: i, subStep: "drain-testnet" });
					const testnetBal = await waitForBalance(
						currentWallet.address,
						true,
						"perp",
					);
					const drainReserve = userTestnetActivated ? 0 : TRANSFER_FEE_BUFFER;
					const drainAmount = (testnetBal - drainReserve).toFixed(2);
					await sendFromGeneratedWallet(
						currentWallet.privateKey,
						userAddress,
						drainAmount,
						true,
						"", // faucet money is in generated wallet's testnet perps
						userTestnetDestDex,
					);
					userTestnetActivated = true;
					dispatch({
						type: "COMPLETE_SUBSTEP",
						index: i,
						subStep: "drain-testnet",
					});
					dispatch({ type: "COLLECT_TESTNET", amount: Math.round(testnetBal) });
					invalidateWalletBalance(currentWallet.address);

					if (abortRef.current) break;

					// Forward mainnet from the pocket that matches chain kind
					dispatch({
						type: "SET_SUBSTEP",
						index: i,
						subStep: "forward-mainnet",
					});
					const mainnetBal = await fetchUsdcBalance(
						currentWallet.address,
						false,
						mainnetPocket,
					);

					if (i < N - 1) {
						// Chain hop: next wallet is fresh — reserve $1 for its activation
						// fee, forward the rest. Generated wallet ends with $0.
						const forwardAmount = (mainnetBal - TRANSFER_FEE_BUFFER).toFixed(2);
						const nextWallet = generateWallet();
						useWalletStore
							.getState()
							.addAutoWallet(nextWallet.privateKey, nextWallet.address);
						dispatch({
							type: "ADD_WALLET",
							wallet: {
								index: i + 1,
								address: nextWallet.address,
								privateKey: nextWallet.privateKey,
							},
						});
						await sendFromGeneratedWallet(
							currentWallet.privateKey,
							nextWallet.address,
							forwardAmount,
							false,
							chainDex,
							chainDex,
						);
						dispatch({
							type: "COMPLETE_SUBSTEP",
							index: i,
							subStep: "forward-mainnet",
						});
						dispatch({ type: "WALLET_COMPLETE", index: i });
						invalidateWalletBalance(currentWallet.address);
						invalidateWalletBalance(nextWallet.address);

						// Wait for next wallet to receive
						await waitForBalance(nextWallet.address, false, mainnetPocket);
						currentWallet = nextWallet;
					} else {
						// Last hop: user is already activated on mainnet (they seeded us),
						// so no activation fee applies. Send the full remaining balance.
						const forwardAmount = mainnetBal.toFixed(2);
						await sendFromGeneratedWallet(
							currentWallet.privateKey,
							userAddress,
							forwardAmount,
							false,
							chainDex,
							userMainnetDestDex,
						);
						dispatch({
							type: "COMPLETE_SUBSTEP",
							index: i,
							subStep: "forward-mainnet",
						});
						dispatch({ type: "WALLET_COMPLETE", index: i });
						invalidateWalletBalance(currentWallet.address);
					}
				}

				if (abortRef.current) {
					// abort() already dispatched, but re-dispatch is idempotent and
					// defends against a race where abortRef flipped after abort()'s
					// dispatch but before we got here.
					dispatch({ type: "CHAIN_ABORT" });
				} else {
					dispatch({ type: "CHAIN_COMPLETE" });
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				const isAbort =
					abortRef.current ||
					(err instanceof Error &&
						(err.name === "AbortError" || msg.includes("aborted")));
				if (isAbort) {
					dispatch({ type: "CHAIN_ABORT" });
				} else {
					dispatch({ type: "WALLET_ERROR", index: currentIdx, error: msg });
				}
			} finally {
				runningRef.current = false;
			}
		},
		[walletClient, userAddress, invalidateWalletBalance],
	);

	const abort = useCallback(() => {
		abortRef.current = true;
		// Dispatch immediately so the UI reacts in the same tick without
		// waiting for the in-flight await to unwind. The loop's next check
		// (or the post-loop guard) will also dispatch — idempotent.
		dispatch({ type: "CHAIN_ABORT" });
	}, []);

	// Remove any auto-origin wallets from persistent storage that hold no funds
	// on either network. Called after a chain finishes so the wallet list stays
	// clean, and before a full reset so non-empty wallets survive (users can
	// still drain them from the manual wallet table view).
	const cleanupEmpty = useCallback(async () => {
		const { wallets, removeIfEmpty } = useWalletStore.getState();
		const autoWallets = wallets.filter((w) => w.origin === "auto");
		await Promise.all(
			autoWallets.map(async (w) => {
				try {
					const [mainPerp, mainSpot, testPerp, testSpot] = await Promise.all([
						fetchUsdcBalance(w.address, false, "perp"),
						fetchUsdcBalance(w.address, false, "spot"),
						fetchUsdcBalance(w.address, true, "perp"),
						fetchUsdcBalance(w.address, true, "spot"),
					]);
					removeIfEmpty(w.address, {
						mainnet: mainPerp + mainSpot,
						testnet: testPerp + testSpot,
					});
				} catch {
					// If the check fails, err on the side of keeping the wallet.
				}
			}),
		);
	}, []);

	const reset = useCallback(async () => {
		await cleanupEmpty();
		abortRef.current = false;
		runningRef.current = false;
		dispatch({ type: "RESET" });
	}, [cleanupEmpty]);

	// Query all auto-origin wallets' balances live (bypassing cache) and return
	// the subset that hold any funds. Used to power the Reset confirmation.
	// The `index` matches Wallet #N as displayed in the AutoModeProgress rows.
	const computeWalletsAtRisk = useCallback(async (): Promise<
		Array<{
			index: number;
			address: `0x${string}`;
			mainnet: number;
			testnet: number;
		}>
	> => {
		const { wallets } = useWalletStore.getState();
		const autoWallets = wallets.filter((w) => w.origin === "auto");
		const results = await Promise.all(
			autoWallets.map(async (w, i) => {
				try {
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
				} catch {
					// If the check fails, treat as "unknown but keep" — return zeros
					// so the wallet isn't flagged as at risk but also stays in store.
					return {
						index: i + 1,
						address: w.address,
						mainnet: 0,
						testnet: 0,
					};
				}
			}),
		);
		return results.filter((r) => r.mainnet >= 0.005 || r.testnet >= 0.005);
	}, []);

	// Force-delete ALL auto-origin wallets from the store (regardless of
	// balance) and reset the reducer. Called only after the user explicitly
	// confirms the ResetConfirmDialog.
	const forceReset = useCallback(() => {
		const { wallets, removeWallet } = useWalletStore.getState();
		for (const w of wallets) {
			if (w.origin === "auto") {
				removeWallet(w.address);
			}
		}
		abortRef.current = false;
		runningRef.current = false;
		dispatch({ type: "RESET" });
	}, []);

	return {
		state,
		start,
		abort,
		reset,
		cleanupEmpty,
		computeWalletsAtRisk,
		forceReset,
	};
}
