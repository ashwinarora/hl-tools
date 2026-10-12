import type { Address } from "@hl-tools/core";
import { slotKey } from "../model/relay/wallets";

/**
 * Whether this build has a relay at all. Both values come from the build's
 * environment, so the answer is the same on the server and in the browser;
 * without them the signer is the link-and-file tool it was before the relay
 * existed, and none of the relay code is ever loaded.
 */
export interface RelayConfig {
	readonly url: string;
	/** A publishable key: it identifies the project, it grants nothing by itself. */
	readonly key: string;
}

/**
 * How every relay client is set up for sign-in. A client is made for one
 * wallet and keeps its session in that wallet's own slot (`slotKey`), so the
 * session a client holds can only ever be that wallet's. `storage` is given
 * by tests; the browser's `localStorage` is the default.
 */
export function relayAuthOptions(
	wallet: Address,
	storage?: {
		getItem(key: string): string | null;
		setItem(key: string, value: string): void;
		removeItem(key: string): void;
	},
) {
	return {
		persistSession: true,
		// The provider starts and stops token renewal itself: only the wallet
		// that is connected is ever renewed, and nothing after the section is left.
		autoRefreshToken: false,
		// sign-in is a wallet signature; nothing ever arrives in the URL
		detectSessionInUrl: false,
		storageKey: slotKey(wallet),
		...(storage ? { storage } : {}),
	};
}

export function relayConfig(
	env: {
		readonly VITE_SUPABASE_URL?: string;
		readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
	} = import.meta.env,
): RelayConfig | null {
	const url = env.VITE_SUPABASE_URL?.trim();
	const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
	return url && key ? { url, key } : null;
}
