import { useCallback, useReducer, useRef } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useWalletClient } from "wagmi";
import {
	claimFaucet,
	decideChainKind,
	dexForKind,
	fetchUsdcBalance,
	fetchUserProfile,
	pocketForKind,
	type SendKind,
	sendFromGeneratedWallet,
	sendFromUserWallet,
	TRANSFER_FEE_BUFFER,
	userDestinationDex,
} from "#/lib/hlActions";

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
	| "error";

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
	const abortRef = useRef(false);
	const runningRef = useRef(false);

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

				// Generate wallet #1
				const wallet1 = generateWallet();
				dispatch({
					type: "ADD_WALLET",
					wallet: {
						index: 0,
						address: wallet1.address,
						privateKey: wallet1.privateKey,
					},
				});

				// Seed: user sends N+1 USDC to wallet #1 via sendAsset
				dispatch({ type: "SEED_START" });
				await sendFromUserWallet(
					walletClient,
					wallet1.address,
					String(N + 1),
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

					if (abortRef.current) break;

					// Wait for testnet perps balance then drain via usdSend
					dispatch({ type: "SET_SUBSTEP", index: i, subStep: "drain-testnet" });
					const testnetBal = await waitForBalance(
						currentWallet.address,
						true,
						"perp",
					);
					const drainAmount = (testnetBal - TRANSFER_FEE_BUFFER).toFixed(2);
					await sendFromGeneratedWallet(
						currentWallet.privateKey,
						userAddress,
						drainAmount,
						true,
						"", // faucet money is in generated wallet's testnet perps
						userTestnetDestDex,
					);
					dispatch({
						type: "COMPLETE_SUBSTEP",
						index: i,
						subStep: "drain-testnet",
					});
					dispatch({ type: "COLLECT_TESTNET", amount: Math.round(testnetBal) });

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
					const forwardAmount = (mainnetBal - TRANSFER_FEE_BUFFER).toFixed(2);

					if (i < N - 1) {
						// Generate next wallet and forward within the chain pocket
						const nextWallet = generateWallet();
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

						// Wait for next wallet to receive
						await waitForBalance(nextWallet.address, false, mainnetPocket);
						currentWallet = nextWallet;
					} else {
						// Last wallet: send mainnet back to user, honoring their mode.
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
					}
				}

				if (!abortRef.current) {
					dispatch({ type: "CHAIN_COMPLETE" });
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				dispatch({ type: "WALLET_ERROR", index: currentIdx, error: msg });
			} finally {
				runningRef.current = false;
			}
		},
		[walletClient, userAddress],
	);

	const abort = useCallback(() => {
		abortRef.current = true;
	}, []);

	const reset = useCallback(() => {
		abortRef.current = false;
		runningRef.current = false;
		dispatch({ type: "RESET" });
	}, []);

	return { state, start, abort, reset };
}
