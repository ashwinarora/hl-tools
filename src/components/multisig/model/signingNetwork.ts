/**
 * The network a wallet has to be on to sign a code.
 *
 * Hyperliquid has two ways of signing. A send, a withdrawal or a stake is
 * typed data a wallet can show field by field, under an ordinary chain the
 * action names itself. A vault deposit belongs to the other family: what is
 * signed is a code that stands for the action, and its typed data says chain
 * 1337, which is no real network. Wallets refuse typed data for a chain they
 * are not on (measured in Rabby: "chainId should be same as current
 * chainId"), so a wallet has to hold a network with that number before it can
 * sign one.
 */
import {
	eip712Hashes,
	type Hex,
	innerDigest,
	L1_DOMAIN,
	type Network,
	type PlainObject,
	type ProposalPayload,
	signingFamilyFor,
} from "@hl-tools/core";
import { chainIdToNumber, chainLabel } from "./chains";
import { convertChain } from "./convert";
import { describeWalletError } from "./walletErrors";

/** The chain id inside every code signature: 1337. */
export const SIGNING_CHAIN_ID: number = L1_DOMAIN.chainId;
export const SIGNING_CHAIN_HEX = `0x${SIGNING_CHAIN_ID.toString(16)}` as Hex;

export interface SigningChain {
	readonly hex: Hex;
	readonly id: number;
	readonly label: string;
}

/**
 * The chain a wallet has to be on to give its signature on an action: the
 * one a readable action names for itself, the signing network for a code.
 * Null when a readable action names none this page can read. Worked out from
 * the action's own type, never from a proposal's unsigned part.
 */
export function signingChainOf(action: PlainObject): SigningChain | null {
	if (typeof action.type !== "string") return null;
	const family = signingFamilyFor(action.type);
	if (family === "l1")
		return {
			hex: SIGNING_CHAIN_HEX,
			id: SIGNING_CHAIN_ID,
			label: chainLabel(SIGNING_CHAIN_ID),
		};
	if (family !== "user-signed") return null;
	const id = chainIdToNumber(action.signatureChainId);
	return id === null
		? null
		: {
				hex: String(action.signatureChainId).toLowerCase() as Hex,
				id,
				label: chainLabel(id),
			};
}

/**
 * The chain the finaliser's own signature (the one around the signers') is
 * made under. It is always the readable kind. For a readable action it is
 * the action's own chain, as before. A code names no ordinary chain, so the
 * wallet stays where it was when that is a chain of this network, and goes
 * to this network's HyperEVM otherwise (the rule the wizard uses): a
 * finaliser who adds no signature of their own never needs the signing
 * network at all.
 */
export function envelopeChainOf(
	action: PlainObject,
	network: Network,
	walletChainId: number | null,
): SigningChain | null {
	const inner = signingChainOf(action);
	if (!inner || inner.id !== SIGNING_CHAIN_ID) return inner;
	const home = convertChain(walletChainId, network);
	return { hex: home.hex, id: home.id, label: chainLabel(home.id) };
}

/**
 * Where a wallet found on the signing network goes when a click is over:
 * back to the chain it was on when the click was made. A wallet that was
 * already on the signing network then (a page closed half-way left it
 * there) goes to this network's HyperEVM: nothing lives on the signing
 * network, and a wallet left there shows an empty account.
 */
export function chainAfterSigning(
	before: number | null,
	network: Network,
): number {
	return before !== null && before !== SIGNING_CHAIN_ID
		? before
		: convertChain(null, network).id;
}

// ------------------------------------------------------- which actions, and the code

/**
 * The one action of the code family this section signs: a vault deposit or
 * withdrawal by the account itself. `payload.vaultAddress` (acting for a
 * vault or sub-account) and an expiry are part of other uses of that family
 * and stay outside.
 */
export function isVaultAction(payload: ProposalPayload): boolean {
	return (
		payload.action.type === "vaultTransfer" &&
		payload.vaultAddress === null &&
		payload.expiresAfter === null
	);
}

export interface SigningCode {
	/** What the wallet shows as `connectionId`: the hash of the action, the account, the finaliser and the number. */
	readonly code: Hex;
	/** "a" on mainnet, "b" on testnet: the wallet shows it as `source`. */
	readonly source: string;
	/** What a wallet that shows only hashes shows instead (some hardware wallets). */
	readonly domainHash: Hex;
	readonly messageHash: Hex;
}

/** The code a wallet will show for a proposal of the code family; null for a readable one. */
export function signingCodeOf(payload: ProposalPayload): SigningCode | null {
	const d = innerDigest(payload);
	if (d.kind !== "l1" || !d.l1 || !d.typedData) return null;
	const hashes = eip712Hashes(d.typedData);
	return {
		code: d.l1.connectionId,
		source: String((d.typedData.message as { source?: unknown }).source ?? ""),
		domainHash: hashes.domainSeparator,
		messageHash: hashes.structHash,
	};
}

// ------------------------------------------------------------ the network itself

export interface SigningNetwork {
	/** The link a wallet is given for the network: it answers as chain 1337 (src/lib/signingRpc.ts). */
	readonly rpcUrl: string;
}

/** The signing network of this build; null when it was built without one (then no code can be signed here). */
export function signingNetwork(
	env: { readonly VITE_CHAIN_1337_RPC_URL?: string } = import.meta.env,
): SigningNetwork | null {
	const rpcUrl = env.VITE_CHAIN_1337_RPC_URL?.trim();
	return rpcUrl ? { rpcUrl } : null;
}

/**
 * How the network is named in the wallet. Wallets compare a network's name
 * and coin with public lists of chain ids, and 1337 is listed there as a
 * local test network: a name of our own would be shown with a warning that
 * it does not match. Under this name Rabby adds it with nothing but its
 * standing caution about custom networks, and moves onto it as it adds
 * (measured 2026-10-13).
 */
export const SIGNING_NETWORK_NAME = "Geth Testnet";

/** What `wallet_addEthereumChain` is asked with. */
export function addNetworkRequest(net: SigningNetwork) {
	return {
		chainId: SIGNING_CHAIN_HEX,
		chainName: SIGNING_NETWORK_NAME,
		nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
		rpcUrls: [net.rpcUrl],
	} as const;
}

/** The wallet, as far as this needs it (EIP-1193). */
export interface WalletProvider {
	request(args: {
		readonly method: string;
		readonly params?: readonly unknown[];
	}): Promise<unknown>;
}

/**
 * declined  the person said no in the wallet
 * missing   the wallet does not have the network (or would not go there): offer to add it
 * failed    the wallet answered, and is still somewhere else
 */
export type OnSigningNetwork =
	| { readonly ok: true; readonly switched: boolean }
	| {
			readonly ok: false;
			readonly why: "declined" | "missing" | "failed";
			readonly message: string;
	  };

const sameChain = (answer: unknown): boolean =>
	chainIdToNumber(answer) === SIGNING_CHAIN_ID;

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Some wallets answer a switch before they have switched: ask a few times. */
async function arrived(
	provider: WalletProvider,
	wait: (ms: number) => Promise<void>,
): Promise<boolean> {
	for (let i = 0; i < 8; i++) {
		if (
			sameChain(
				await provider.request({ method: "eth_chainId" }).catch(() => null),
			)
		)
			return true;
		await wait(150);
	}
	return false;
}

/**
 * Bring the wallet onto the signing network, adding nothing. A wallet that
 * does not have the network refuses in its own way (4902 by the standard;
 * Rabby answered -32603 "Unrecognized chain ID"), so every refusal that is
 * not the person's own no is read as "missing" and the page offers to add it.
 */
export async function goToSigningNetwork(
	provider: WalletProvider,
	wait: (ms: number) => Promise<void> = pause,
): Promise<OnSigningNetwork> {
	if (
		sameChain(
			await provider.request({ method: "eth_chainId" }).catch(() => null),
		)
	)
		return { ok: true, switched: false };
	try {
		await provider.request({
			method: "wallet_switchEthereumChain",
			params: [{ chainId: SIGNING_CHAIN_HEX }],
		});
	} catch (e) {
		return describeWalletError(e).kind === "rejected"
			? { ok: false, why: "declined", message: "You declined in the wallet." }
			: { ok: false, why: "missing", message: CODE_COPY.missing };
	}
	return (await arrived(provider, wait))
		? { ok: true, switched: true }
		: { ok: false, why: "failed", message: CODE_COPY.didNotSwitch };
}

/** Ask the wallet to add the signing network (one approval there), then go to it. */
export async function addSigningNetwork(
	provider: WalletProvider,
	net: SigningNetwork,
	wait: (ms: number) => Promise<void> = pause,
): Promise<OnSigningNetwork> {
	try {
		await provider.request({
			method: "wallet_addEthereumChain",
			params: [addNetworkRequest(net)],
		});
	} catch (e) {
		return describeWalletError(e).kind === "rejected"
			? { ok: false, why: "declined", message: "You declined in the wallet." }
			: { ok: false, why: "failed", message: CODE_COPY.wouldNotAdd(net) };
	}
	// most wallets switch as they add; one that only adds is asked to switch
	if (await arrived(provider, wait)) return { ok: true, switched: true };
	const there = await goToSigningNetwork(provider, wait);
	return there.ok || there.why !== "missing"
		? there
		: { ok: false, why: "failed", message: CODE_COPY.wouldNotAdd(net) };
}

// ----------------------------------------------------------------------- words

/** Every sentence about signing a code. Tested against the forbidden claims and the jargon list. */
export const CODE_COPY = {
	intro:
		"Your wallet cannot show this kind of action. It will show a code instead:",
	check:
		"This page worked that code out from the action above. Check that your wallet shows the same one.",
	asShown: (source: string) =>
		`In the wallet it is the field "connectionId", next to "source: ${source}".`,
	missing:
		"Your wallet does not have the signing network yet. Adding it takes one approval in the wallet, once. Nothing is ever sent on that network.",
	add: "Add the signing network",
	adding: "Waiting for the wallet…",
	didNotSwitch:
		"The wallet did not go to the signing network. Switch to it in the wallet, then sign again.",
	wouldNotAdd: (net: SigningNetwork) =>
		`The wallet would not add the signing network. Add a network with chain id ${SIGNING_CHAIN_ID} and this link in the wallet, then sign again: ${net.rpcUrl}`,
	absentHead: "A vault action: this copy of the app cannot sign it",
	absentBody:
		"A vault deposit or withdrawal is signed as a code, under a network the wallet has to hold. This copy of the app was set up without that network's link, so it can be read and checked here, not signed.",
	signedUnder:
		"Signed as a code under the signing network; nothing is sent on that network, and the wallet goes back to its own afterwards.",
} as const;
