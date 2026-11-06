/**
 * Ashdex, the trading site that holds a treasury's API wallet key: this page
 * never makes or holds one. Ashdex makes the key in the trader's browser and
 * links here with its address filled in; once the signers approved it, a
 * link goes back. Both links carry only what Hyperliquid lists for anyone:
 * the network, the treasury, the API wallet's address and name.
 *
 * Ashdex has one site per network. Neither address set at build time: no
 * link to it anywhere.
 */
import type { Network } from "@hl-tools/core";

export interface AshdexEnv {
	readonly VITE_ASHDEX_URL?: string;
	readonly VITE_ASHDEX_TESTNET_URL?: string;
}

/** Ashdex's site for this network, or null when this build names none. */
export function ashdexOrigin(
	network: Network,
	env: AshdexEnv = import.meta.env,
): string | null {
	const raw = (
		network === "testnet" ? env.VITE_ASHDEX_TESTNET_URL : env.VITE_ASHDEX_URL
	)?.trim();
	if (!raw) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return url.origin;
	} catch {
		return null;
	}
}

/**
 * Ashdex's page for trading as a treasury: with an API wallet, the one to
 * trade with (Ashdex says so when this browser does not hold its key);
 * without one, the page that makes a key for the treasury.
 */
export function ashdexTreasuryLink(
	origin: string,
	at: {
		readonly network: Network;
		readonly treasury: string;
		readonly agent?: string;
	},
): string {
	const url = new URL("/treasury", origin);
	url.searchParams.set("network", at.network);
	url.searchParams.set("treasury", at.treasury.toLowerCase());
	if (at.agent) url.searchParams.set("agent", at.agent.toLowerCase());
	return url.toString();
}

/**
 * Whether an API wallet's name is one Ashdex gave it ("ashdex 1a2b"): only
 * those get a link to Ashdex, so a bot's API wallet is not sent there.
 */
export function isAshdexName(name: string): boolean {
	return /^ashdex(\s|$)/i.test(name);
}

/** Every sentence about Ashdex. */
export const ASHDEX = {
	trade: "Trade in Ashdex",
	make: "Make a trading key in Ashdex",
	makeHint:
		"Ashdex makes a new key in your browser and brings you back here with its address filled in. The key stays in Ashdex.",
	approved:
		"This API wallet is approved. Whoever holds its key in Ashdex can trade for the treasury there until it expires.",
	expired: "Expired. To trade again, make a new key in Ashdex and approve it.",
} as const;
