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

/** Where the browser keeps the relay session (one key, this origin only). */
export const RELAY_STORAGE_KEY = "hl-tools.relay";

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
