/**
 * The connected wallet as the core's `TypedDataSigner`: it only ever signs
 * EIP-712 typed data the wallet itself displays. No key is held by the page.
 *
 * A proposal names the chain its signers sign under, so `signerFor` first
 * brings the wallet onto that chain (wallets refuse typed data for a chain
 * they are not on) and only then hands out a signer.
 */
import { type Hex, type TypedDataSigner, viemSigner } from "@hl-tools/core";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { chainIdToNumber, chainLabel } from "./model/chains";
import { describeWalletError } from "./model/walletErrors";

export type SignerResult =
	| { readonly ok: true; readonly signer: TypedDataSigner }
	| { readonly ok: false; readonly error: string };

export interface WalletSigner {
	readonly address: `0x${string}` | null;
	readonly chainId: number | null;
	readonly connected: boolean;
	/** A wallet request is in flight; buttons that open the wallet stay disabled. */
	readonly busy: boolean;
	/** Switch the wallet to the chain `hex` names if needed, then return a signer. */
	signerFor(hex: Hex): Promise<SignerResult>;
	/** Run one wallet flow at a time, with a transient "waiting" toast. */
	run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined>;
}

export function useWalletSigner(): WalletSigner {
	const config = useConfig();
	const { address, chainId, isConnected } = useAccount();
	const { switchChainAsync } = useSwitchChain();
	const busyRef = useRef(false);
	const [busy, setBusy] = useState(false);

	const signerFor = useCallback(
		async (hex: Hex): Promise<SignerResult> => {
			const want = chainIdToNumber(hex);
			if (want === null)
				return { ok: false, error: `${hex} is not a chain id.` };
			const label = chainLabel(want);
			try {
				if (chainId !== want)
					await switchChainAsync({ chainId: want as never });
				// a client for the chain the wallet is on now, not the one captured at render
				const client = await getWalletClient(config, {
					chainId: want as never,
				});
				return {
					ok: true,
					signer: viemSigner({
						signTypedData: async (args) => {
							try {
								return await client.signTypedData({
									account: client.account,
									...args,
								} as never);
							} catch (e) {
								// the core reports this text as the reason the signer failed
								throw new Error(describeWalletError(e, label).message);
							}
						},
					}),
				};
			} catch (e) {
				return { ok: false, error: describeWalletError(e, label).message };
			}
		},
		[chainId, config, switchChainAsync],
	);

	const run = useCallback(
		async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
			// a second click while the wallet is open would queue a second popup
			if (busyRef.current) return undefined;
			busyRef.current = true;
			setBusy(true);
			const id = toast.loading(label);
			try {
				return await fn();
			} finally {
				toast.dismiss(id);
				busyRef.current = false;
				setBusy(false);
			}
		},
		[],
	);

	return {
		// lowercase, as every address in the hub; wallets report the checksummed form
		address: address ? (address.toLowerCase() as `0x${string}`) : null,
		chainId: chainId ?? null,
		connected: isConnected,
		busy,
		signerFor,
		run,
	};
}
