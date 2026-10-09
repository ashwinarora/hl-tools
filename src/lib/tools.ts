import { type RuleSetMeta, ruleSet } from "@hl-tools/core";
import {
	Boxes,
	Droplets,
	FileSearch,
	FileSignature,
	GitCompareArrows,
	type LucideIcon,
	Network,
	PenLine,
	Radio,
	UsersRound,
	Workflow,
} from "lucide-react";

export type ToolId =
	| "assets"
	| "signing"
	| "corewriter"
	| "trace"
	| "orders"
	| "websocket"
	| "rpc"
	| "multisig"
	| "multisig-sign"
	| "faucet";

export interface ToolSample {
	readonly id: string;
	readonly label: string;
}

export interface ToolDef {
	readonly id: ToolId;
	readonly path:
		| "/tools/assets"
		| "/tools/signing"
		| "/tools/corewriter"
		| "/tools/trace"
		| "/tools/orders"
		| "/tools/websocket"
		| "/tools/rpc"
		| "/tools/multisig"
		| "/multisig"
		| "/faucet-miner";
	readonly title: string;
	readonly short: string;
	readonly description: string;
	/** The exact error or question the tool answers. */
	readonly answers: string;
	readonly icon: LucideIcon;
	readonly ruleSets: readonly string[];
	/** Primary source the tool relies on. */
	readonly primarySource: { readonly label: string; readonly url: string };
	readonly sample: ToolSample | null;
	readonly flagship?: boolean;
	readonly writes?: boolean;
}

const DOCS = "https://hyperliquid.gitbook.io/hyperliquid-docs";

export const TOOLS: readonly ToolDef[] = [
	{
		id: "assets",
		path: "/tools/assets",
		title: "Asset Resolver",
		short: "Assets",
		description:
			"Every identity a symbol maps to — perp, spot, HIP-3, HIP-4 — with asset IDs, token and pair indexes, decimals and copyable snippets, side by side across networks.",
		answers: "Why does @107 mean HYPE on mainnet but nothing on testnet?",
		icon: Boxes,
		ruleSets: ["asset-ids", "precision"],
		primarySource: {
			label: "Asset IDs",
			url: `${DOCS}/for-developers/api/asset-ids`,
		},
		sample: { id: "hype", label: "HYPE" },
	},
	{
		id: "signing",
		path: "/tools/signing",
		title: "Signing Inspector",
		short: "Signing",
		description:
			"Reproduce exactly what gets hashed: signing family, canonical MsgPack bytes, action hash, EIP-712 typed data and the recovered signer. Compare two payloads byte by byte.",
		answers: "L1 error: User or API Wallet 0x… does not exist.",
		icon: PenLine,
		ruleSets: ["signing"],
		primarySource: {
			label: "Signing",
			url: `${DOCS}/for-developers/api/signing`,
		},
		sample: { id: "order", label: "Order (Python SDK vector)" },
	},
	{
		id: "corewriter",
		path: "/tools/corewriter",
		title: "CoreWriter Workbench",
		short: "CoreWriter",
		description:
			"Decode or build raw CoreWriter action bytes, see raw integers next to human units, generate cast and Solidity, and query every read precompile live.",
		answers: "What does 0x01000001… actually tell HyperCore to do?",
		icon: Workflow,
		ruleSets: ["corewriter", "precompiles"],
		primarySource: {
			label: "Interacting with HyperCore",
			url: `${DOCS}/for-developers/hyperevm/interacting-with-hypercore`,
		},
		sample: { id: "limit-order", label: "Limit order bytes" },
	},
	{
		id: "trace",
		path: "/tools/trace",
		title: "Cross-layer Trace",
		short: "Trace",
		description:
			"Follow a HyperEVM transaction into HyperCore: receipt, decoded CoreWriter actions, the expected Core effect and the observed Core state — each link labelled observed, inferred or unknown.",
		answers:
			"My EVM transaction succeeded — why did nothing happen on HyperCore?",
		icon: GitCompareArrows,
		ruleSets: ["corewriter", "hyperevm-rpc", "evm-core-transfers"],
		primarySource: {
			label: "Interaction timings",
			url: `${DOCS}/for-developers/hyperevm/interaction-timings`,
		},
		sample: { id: "limit-order", label: "Mainnet limit order tx" },
		flagship: true,
	},
	{
		id: "orders",
		path: "/tools/orders",
		title: "Order Composer & Failure Explainer",
		short: "Orders",
		description:
			"Compose order payloads from intent with a pre-flight precision linter, or paste an exchange response and get a field-by-field explanation with causes and fixes.",
		answers: "Price must be divisible by tick size.",
		icon: FileSearch,
		ruleSets: ["orders", "precision", "errors"],
		primarySource: {
			label: "Exchange endpoint",
			url: `${DOCS}/for-developers/api/exchange-endpoint`,
		},
		sample: { id: "tpsl", label: "Long with TP/SL" },
	},
	{
		id: "websocket",
		path: "/tools/websocket",
		title: "WebSocket Workbench",
		short: "WebSocket",
		description:
			"Subscribe to any channel, watch the ack, snapshot and live stream with freshness, record a session, simulate a disconnect and diff state before and after.",
		answers: "Did I miss messages while my socket was down?",
		icon: Radio,
		ruleSets: ["websocket", "rate-limits"],
		primarySource: {
			label: "WebSocket subscriptions",
			url: `${DOCS}/for-developers/api/websocket/subscriptions`,
		},
		sample: { id: "l2book", label: "BTC l2Book" },
	},
	{
		id: "rpc",
		path: "/tools/rpc",
		title: "RPC Capability Probe",
		short: "RPC",
		description:
			"Probe a HyperEVM JSON-RPC endpoint: chain ID, head, historical state, eth_getLogs range limits and HyperEVM-specific methods — with raw requests and a two-endpoint comparison.",
		answers:
			"Does this RPC return historical state or silently give me latest?",
		icon: Network,
		ruleSets: ["hyperevm-rpc"],
		primarySource: {
			label: "JSON-RPC",
			url: `${DOCS}/for-developers/hyperevm/json-rpc`,
		},
		sample: { id: "public", label: "Public mainnet vs testnet" },
	},
	{
		id: "multisig",
		path: "/tools/multisig",
		title: "Multisig Inspector",
		short: "Multisig",
		description:
			"Inspect a native multi-sig account — signers, threshold, approved API wallets, balances, health flags and recent actions — or decode a multi-sig request: the action in plain words, every signature attributed, readiness against the live signer set, and why a signature fails.",
		answers: 'Why does the chain say "Invalid multi-sig inner signer"?',
		icon: UsersRound,
		ruleSets: ["multisig", "signing", "errors", "rate-limits"],
		primarySource: {
			label: "Multi-sig",
			url: `${DOCS}/hypercore/multi-sig`,
		},
		sample: { id: "lab-treasury", label: "Lab treasury (testnet 2-of-3)" },
	},
	{
		id: "multisig-sign",
		path: "/multisig",
		title: "Multisig Signer",
		short: "Multisig",
		description:
			"Propose, sign and submit native multi-sig actions — USDC and spot sends, perps ↔ spot transfers, withdrawals, API-wallet approvals — with your own wallet. Pass a proposal on as a link or a file, or sign in and every signer of a treasury sees it live. Signatures are verified in your browser before anything is sent.",
		answers: "How do two of three signers get one usdSend onto the chain?",
		icon: FileSignature,
		ruleSets: ["multisig", "signing", "errors"],
		primarySource: {
			label: "Multi-sig",
			url: `${DOCS}/hypercore/multi-sig`,
		},
		sample: null,
		writes: true,
	},
	{
		id: "faucet",
		path: "/faucet-miner",
		title: "Testnet Faucet Miner",
		short: "Faucet miner",
		description:
			"Chain generated wallets through the testnet faucet to mine testnet USDC. It signs and sends — with your wallet, in your browser.",
		answers: "How do I get more than one faucet drip of testnet USDC?",
		icon: Droplets,
		ruleSets: ["faucet"],
		primarySource: {
			label: "Testnet faucet",
			url: `${DOCS}/onboarding/testnet-faucet`,
		},
		sample: null,
		writes: true,
	},
];

export function tool(id: ToolId): ToolDef {
	const t = TOOLS.find((x) => x.id === id);
	if (!t) throw new Error(`Unknown tool ${id}`);
	return t;
}

export function toolRuleSets(t: ToolDef): RuleSetMeta[] {
	return t.ruleSets.map(ruleSet);
}

/** Oldest verified date across a tool's rule sets. */
export function toolVerifiedAt(t: ToolDef): string | null {
	const dates = toolRuleSets(t).map((r) => r.verifiedAt);
	return dates.length ? (dates.sort()[0] ?? null) : null;
}
