/**
 * Networks and their endpoints.
 *
 * Every value that crosses the network boundary (asset IDs, token indexes,
 * spot pair indexes, addresses on an RPC) is tagged with the `Network` it was
 * observed on. See `identity.ts` for the branded types that enforce this at
 * compile time.
 */

export const NETWORKS = ["mainnet", "testnet"] as const;
export type Network = (typeof NETWORKS)[number];

export interface NetworkConfig<N extends Network = Network> {
	readonly network: N;
	readonly label: string;
	/** HyperCore REST base (info + exchange). */
	readonly apiUrl: string;
	/** HyperCore WebSocket endpoint. */
	readonly wsUrl: string;
	/** Default public HyperEVM JSON-RPC endpoint. */
	readonly evmRpcUrl: string;
	/** HyperEVM chain ID. */
	readonly evmChainId: number;
	/** `hyperliquidChain` field value in user-signed actions. */
	readonly hyperliquidChain: "Mainnet" | "Testnet";
	/** Phantom-agent `source` field for L1 actions. */
	readonly l1Source: "a" | "b";
	/** Block explorer for HyperEVM transactions. */
	readonly evmExplorerTx: (hash: string) => string;
	/** JSON-RPC-style explorer API (userDetails, txDetails, blockDetails); every request weighs 40. */
	readonly coreExplorerApiUrl: string;
	/** HyperCore explorer for addresses. */
	readonly coreExplorerAddress: (address: string) => string;
}

export const NETWORK_CONFIG: { readonly [N in Network]: NetworkConfig<N> } = {
	mainnet: {
		network: "mainnet",
		label: "Mainnet",
		apiUrl: "https://api.hyperliquid.xyz",
		wsUrl: "wss://api.hyperliquid.xyz/ws",
		evmRpcUrl: "https://rpc.hyperliquid.xyz/evm",
		evmChainId: 999,
		hyperliquidChain: "Mainnet",
		l1Source: "a",
		evmExplorerTx: (hash) => `https://hyperevmscan.io/tx/${hash}`,
		coreExplorerApiUrl: "https://rpc.hyperliquid.xyz/explorer",
		coreExplorerAddress: (address) =>
			`https://app.hyperliquid.xyz/explorer/address/${address}`,
	},
	testnet: {
		network: "testnet",
		label: "Testnet",
		apiUrl: "https://api.hyperliquid-testnet.xyz",
		wsUrl: "wss://api.hyperliquid-testnet.xyz/ws",
		evmRpcUrl: "https://rpc.hyperliquid-testnet.xyz/evm",
		evmChainId: 998,
		hyperliquidChain: "Testnet",
		l1Source: "b",
		evmExplorerTx: (hash) => `https://testnet.purrsec.com/tx/${hash}`,
		coreExplorerApiUrl: "https://rpc.hyperliquid-testnet.xyz/explorer",
		coreExplorerAddress: (address) =>
			`https://app.hyperliquid-testnet.xyz/explorer/address/${address}`,
	},
};

export function isNetwork(value: unknown): value is Network {
	return value === "mainnet" || value === "testnet";
}

export function networkConfig<N extends Network>(network: N): NetworkConfig<N> {
	return NETWORK_CONFIG[network] as NetworkConfig<N>;
}

/** Map an EVM chain ID back to a network, or `null` if it isn't HyperEVM. */
export function networkForChainId(chainId: number): Network | null {
	if (chainId === 999) return "mainnet";
	if (chainId === 998) return "testnet";
	return null;
}

/** Map `hyperliquidChain` ("Mainnet"/"Testnet") to a network. */
export function networkForHyperliquidChain(value: unknown): Network | null {
	if (value === "Mainnet") return "mainnet";
	if (value === "Testnet") return "testnet";
	return null;
}

export class NetworkMismatchError extends Error {
	readonly expected: Network;
	readonly actual: Network;
	constructor(expected: Network, actual: Network, what: string) {
		super(
			`${what} belongs to ${actual} but was used in a ${expected} context. Identifiers never carry across networks — resolve it again on ${expected}.`,
		);
		this.name = "NetworkMismatchError";
		this.expected = expected;
		this.actual = actual;
	}
}

/** Runtime guard complementing the compile-time brand. */
export function assertNetwork<N extends Network>(
	expected: N,
	value: { readonly network: Network },
	what = "Value",
): asserts value is { readonly network: N } {
	if (value.network !== expected) {
		throw new NetworkMismatchError(expected, value.network, what);
	}
}
