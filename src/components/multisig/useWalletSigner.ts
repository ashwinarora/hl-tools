/**
 * The connected wallet as the core's `TypedDataSigner`: it only ever signs
 * EIP-712 typed data the wallet itself displays. No key is held by the page.
 *
 * A proposal names the chain its signers sign under, so `signerFor` first
 * brings the wallet onto that chain (wallets refuse typed data for a chain
 * they are not on) and only then hands out a signer.
 */
import { type Hex, type TypedDataSigner, viemSigner } from "@hl-tools/core";
import { useCallback } from "react";
import { toast } from "sonner";
import { getTypesForEIP712Domain, serializeTypedData } from "viem";
import { type Config, useAccount, useConfig, useSwitchChain } from "wagmi";
import { getAccount, getWalletClient } from "wagmi/actions";
import { useNetworkStore } from "#/store/networkStore";
import { useWalletBusy } from "#/store/walletBusyStore";
import { chainIdToNumber, chainLabel } from "./model/chains";
import {
	addSigningNetwork as addNetwork,
	chainAfterSigning,
	goToSigningNetwork,
	SIGNING_CHAIN_ID,
	signingNetwork,
	type WalletProvider,
} from "./model/signingNetwork";
import { describeWalletError } from "./model/walletErrors";

export type SignerResult =
	| { readonly ok: true; readonly signer: TypedDataSigner }
	| {
			readonly ok: false;
			readonly error: string;
			/** The wallet does not have the signing network: the page offers to add it. */
			readonly needsNetwork?: true;
	  };

export interface WalletSigner {
	readonly address: `0x${string}` | null;
	readonly chainId: number | null;
	readonly connected: boolean;
	/** A wallet request is in flight; buttons that open the wallet stay disabled. */
	readonly busy: boolean;
	/** Switch the wallet to the chain `hex` names if needed, then return a signer. */
	signerFor(hex: Hex): Promise<SignerResult>;
	/**
	 * Ask the wallet to add the signing network (one approval in the wallet)
	 * and go to it. Only a build that has that network can.
	 */
	addSigningNetwork(): Promise<
		{ readonly ok: true } | { readonly ok: false; readonly error: string }
	>;
	/** Run one wallet flow at a time, with a transient "waiting" toast. */
	run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined>;
}

/** The chain the wallet is on now, asked of the wallet itself; what wagmi last heard when it cannot say. */
async function liveChain(config: Config): Promise<number | null> {
	const { connector, chainId } = getAccount(config);
	try {
		return connector ? await connector.getChainId() : (chainId ?? null);
	} catch {
		return chainId ?? null;
	}
}

/** Best effort: a wallet that will not switch back is left where it is. */
async function leaveSigningNetwork(config: Config, to: number): Promise<void> {
	if ((await liveChain(config)) !== SIGNING_CHAIN_ID) return;
	const provider = await providerOf(config);
	await provider
		?.request({
			method: "wallet_switchEthereumChain",
			params: [{ chainId: `0x${to.toString(16)}` }],
		})
		.catch(() => undefined);
}

/** The connected wallet itself (EIP-1193), for what wagmi will not ask it. */
async function providerOf(config: Config): Promise<WalletProvider | null> {
	const { connector } = getAccount(config);
	try {
		return connector
			? ((await connector.getProvider()) as WalletProvider)
			: null;
	} catch {
		return null;
	}
}

/**
 * A signer for a code. wagmi only switches to chains it was configured with,
 * and the signing network is deliberately not one of them (the page itself
 * never talks to it), so the wallet is asked directly: go to the signing
 * network, then sign the typed data as it stands.
 */
async function codeSigner(config: Config): Promise<SignerResult> {
	const provider = await providerOf(config);
	const { address } = getAccount(config);
	if (!provider || !address)
		return { ok: false, error: "Connect a wallet to sign." };
	const there = await goToSigningNetwork(provider);
	if (!there.ok)
		return there.why === "missing"
			? { ok: false, error: there.message, needsNetwork: true }
			: { ok: false, error: there.message };
	return {
		ok: true,
		signer: viemSigner({
			signTypedData: async (args) => {
				try {
					const typed = args as unknown as Parameters<
						typeof serializeTypedData
					>[0];
					return (await provider.request({
						method: "eth_signTypedData_v4",
						params: [
							address,
							serializeTypedData({
								...typed,
								types: {
									EIP712Domain: getTypesForEIP712Domain({
										domain: typed.domain,
									}),
									...typed.types,
								},
							} as never),
						],
					})) as Hex;
				} catch (e) {
					throw new Error(
						describeWalletError(e, chainLabel(SIGNING_CHAIN_ID)).message,
					);
				}
			},
		}),
	};
}

export function useWalletSigner(): WalletSigner {
	const config = useConfig();
	const { address, chainId, isConnected } = useAccount();
	const { switchChainAsync } = useSwitchChain();
	// shared with every other button that opens the wallet (the rail's sign-in included)
	const busy = useWalletBusy((b) => b.busy);

	const signerFor = useCallback(
		async (hex: Hex): Promise<SignerResult> => {
			const want = chainIdToNumber(hex);
			if (want === null)
				return { ok: false, error: `${hex} is not a chain id.` };
			if (want === SIGNING_CHAIN_ID) return codeSigner(config);
			const label = chainLabel(want);
			try {
				// Asked of the wallet at this moment. The chain known when the page
				// last rendered is stale inside one click that signs under two
				// chains: the second switch would be skipped.
				if ((await liveChain(config)) !== want)
					await switchChainAsync({ chainId: want as never });
				// a client for the chain the wallet is on now
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
		[config, switchChainAsync],
	);

	const addSigningNetwork = useCallback(async () => {
		const net = signingNetwork();
		const provider = await providerOf(config);
		if (!net || !provider)
			return { ok: false as const, error: "Connect a wallet first." };
		const there = await addNetwork(provider, net);
		return there.ok
			? { ok: true as const }
			: { ok: false as const, error: there.message };
	}, [config]);

	const run = useCallback(
		async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
			// a second click while the wallet is open would queue a second popup
			if (!useWalletBusy.getState().begin()) return undefined;
			const id = toast.loading(label);
			const before = await liveChain(config);
			try {
				return await fn();
			} finally {
				// A wallet that is on the signing network when the click is over
				// goes back to where it was (chainAfterSigning): nothing lives on
				// that network, and a wallet left there shows an empty account.
				await leaveSigningNetwork(
					config,
					chainAfterSigning(before, useNetworkStore.getState().network),
				);
				toast.dismiss(id);
				useWalletBusy.getState().end();
			}
		},
		[config],
	);

	return {
		// lowercase, as every address in the hub; wallets report the checksummed form
		address: address ? (address.toLowerCase() as `0x${string}`) : null,
		chainId: chainId ?? null,
		connected: isConnected,
		busy,
		signerFor,
		addSigningNetwork,
		run,
	};
}
