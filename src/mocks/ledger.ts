import { create } from "zustand";

// A dev-only in-memory mock of Hyperliquid's on-chain state. Consumed by
// `src/mocks/handlers.ts` (MSW handlers) and displayed by `MockPanel.tsx`.
// Not touched in production — only loaded when the `?mock=1` bootstrap fires.

export type Network = "mainnet" | "testnet";

export type Abstraction = "disabled" | "unifiedAccount" | "portfolioMargin";

export interface AddressState {
	perp: number;
	spot: number;
	// Once true, sending to this address costs no activation fee.
	activated: boolean;
	// Only used for the "user" (the Rabby-connected address). Fresh generated
	// wallets always default to "disabled" — Hyperliquid does the same.
	abstraction: Abstraction;
	// Append-only ledger events surfaced by `userNonFundingLedgerUpdates`.
	events: LedgerEvent[];
}

export interface LedgerEvent {
	time: number;
	hash: string;
	delta: SendDelta | DepositDelta | AccountClassTransferDelta;
}

export interface SendDelta {
	type: "send";
	user: `0x${string}`;
	destination: `0x${string}`;
	sourceDex: string;
	destinationDex: string;
	token: string;
	amount: string;
	usdcValue: string;
	fee: string;
	nativeTokenFee: string;
	nonce: number;
	feeToken: string;
}

export interface DepositDelta {
	type: "deposit";
	usdc: string;
}

export interface AccountClassTransferDelta {
	type: "accountClassTransfer";
	usdc: string;
	toPerp: boolean;
}

export interface Delays {
	// milliseconds
	send: number;
	faucet: number;
	info: number;
}

export interface FaucetConfig {
	forceFailure: boolean;
	amount: number;
}

interface LedgerState {
	mainnet: Map<`0x${string}`, AddressState>;
	testnet: Map<`0x${string}`, AddressState>;
	config: {
		delays: Delays;
		faucet: FaucetConfig;
	};
}

interface LedgerActions {
	getOrCreate: (network: Network, address: `0x${string}`) => AddressState;
	credit: (
		network: Network,
		address: `0x${string}`,
		pocket: "perp" | "spot",
		amount: number,
	) => void;
	debit: (
		network: Network,
		address: `0x${string}`,
		pocket: "perp" | "spot",
		amount: number,
	) => void;
	setActivated: (network: Network, address: `0x${string}`) => void;
	setAbstraction: (
		network: Network,
		address: `0x${string}`,
		abstraction: Abstraction,
	) => void;
	appendEvent: (
		network: Network,
		address: `0x${string}`,
		event: LedgerEvent,
	) => void;
	setDelays: (partial: Partial<Delays>) => void;
	setFaucet: (partial: Partial<FaucetConfig>) => void;
	resetAll: () => void;
}

const emptyState = (abstraction: Abstraction = "disabled"): AddressState => ({
	perp: 0,
	spot: 0,
	activated: false,
	abstraction,
	events: [],
});

const initialState: LedgerState = {
	mainnet: new Map(),
	testnet: new Map(),
	config: {
		delays: { send: 2500, faucet: 3000, info: 50 },
		faucet: { forceFailure: false, amount: 999 },
	},
};

export const useMockLedger = create<LedgerState & LedgerActions>()(
	(set, get) => ({
		...initialState,
		getOrCreate: (network, address) => {
			const key = address.toLowerCase() as `0x${string}`;
			const map = get()[network];
			const existing = map.get(key);
			if (existing) return existing;
			const fresh = emptyState();
			// Immutable copy so subscribers re-render.
			const nextMap = new Map(map);
			nextMap.set(key, fresh);
			set({ [network]: nextMap } as Partial<LedgerState>);
			return fresh;
		},
		credit: (network, address, pocket, amount) => {
			set((state) => {
				const key = address.toLowerCase() as `0x${string}`;
				const map = new Map(state[network]);
				const prev = map.get(key) ?? emptyState();
				map.set(key, { ...prev, [pocket]: prev[pocket] + amount });
				return { [network]: map } as Partial<LedgerState>;
			});
		},
		debit: (network, address, pocket, amount) => {
			set((state) => {
				const key = address.toLowerCase() as `0x${string}`;
				const map = new Map(state[network]);
				const prev = map.get(key) ?? emptyState();
				map.set(key, {
					...prev,
					[pocket]: Math.max(0, prev[pocket] - amount),
				});
				return { [network]: map } as Partial<LedgerState>;
			});
		},
		setActivated: (network, address) => {
			set((state) => {
				const key = address.toLowerCase() as `0x${string}`;
				const map = new Map(state[network]);
				const prev = map.get(key) ?? emptyState();
				map.set(key, { ...prev, activated: true });
				return { [network]: map } as Partial<LedgerState>;
			});
		},
		setAbstraction: (network, address, abstraction) => {
			set((state) => {
				const key = address.toLowerCase() as `0x${string}`;
				const map = new Map(state[network]);
				const prev = map.get(key) ?? emptyState();
				map.set(key, { ...prev, abstraction });
				return { [network]: map } as Partial<LedgerState>;
			});
		},
		appendEvent: (network, address, event) => {
			set((state) => {
				const key = address.toLowerCase() as `0x${string}`;
				const map = new Map(state[network]);
				const prev = map.get(key) ?? emptyState();
				map.set(key, { ...prev, events: [...prev.events, event] });
				return { [network]: map } as Partial<LedgerState>;
			});
		},
		setDelays: (partial) => {
			set((state) => ({
				config: {
					...state.config,
					delays: { ...state.config.delays, ...partial },
				},
			}));
		},
		setFaucet: (partial) => {
			set((state) => ({
				config: {
					...state.config,
					faucet: { ...state.config.faucet, ...partial },
				},
			}));
		},
		resetAll: () => {
			set(initialState);
		},
	}),
);

// Convenience: apply a send action atomically to a network's ledger, mirroring
// Hyperliquid's real semantics — sender pays amount + $1 fee (if destination
// is fresh), recipient receives full amount, destination becomes activated.
export function applySend(
	network: Network,
	from: `0x${string}`,
	to: `0x${string}`,
	sourcePocket: "perp" | "spot",
	destPocket: "perp" | "spot",
	amount: number,
	nonce: number,
): { ok: true; fee: number } | { ok: false; error: string } {
	const l = useMockLedger.getState();
	const fromState = l.getOrCreate(network, from);
	const toKey = to.toLowerCase() as `0x${string}`;
	const toState = l[network].get(toKey);
	const destinationExists = !!toState && toState.activated;
	const fee = destinationExists ? 0 : 1;

	// Check sender has enough for amount + fee.
	if (fromState[sourcePocket] < amount + fee) {
		return {
			ok: false,
			error: `Insufficient balance: have ${fromState[sourcePocket]}, need ${amount + fee}`,
		};
	}

	l.debit(network, from, sourcePocket, amount + fee);
	l.credit(network, to, destPocket, amount);
	l.setActivated(network, to);
	// The sender is always already activated (they'd have nothing to send
	// otherwise).
	l.setActivated(network, from);

	const eventBase = {
		time: Date.now(),
		hash: `0x${nonce.toString(16).padStart(64, "0")}` as `0x${string}`,
	};
	const delta: SendDelta = {
		type: "send",
		user: from,
		destination: to,
		sourceDex: sourcePocket === "perp" ? "" : "spot",
		destinationDex: destPocket === "perp" ? "" : "spot",
		token: "USDC",
		amount: amount.toFixed(6),
		usdcValue: amount.toFixed(6),
		fee: fee.toFixed(1),
		nativeTokenFee: "0.0",
		nonce,
		feeToken: fee > 0 ? "USDC" : "",
	};
	l.appendEvent(network, from, { ...eventBase, delta });
	l.appendEvent(network, to, { ...eventBase, delta });
	return { ok: true, fee };
}
