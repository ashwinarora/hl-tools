/**
 * The one place the Supabase client is loaded (src/lib/boundaries.test.ts
 * holds everything else to that). It is imported on demand, in the browser,
 * the first time somebody signs in or returns with a stored session; a
 * visitor who only uses links and files never downloads it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { RELAY_STORAGE_KEY, type RelayConfig } from "./config";

export type RelayClient = SupabaseClient;

let loading: Promise<RelayClient> | null = null;

export function getRelayClient(config: RelayConfig): Promise<RelayClient> {
	loading ??= import("@supabase/supabase-js").then(({ createClient }) =>
		createClient(config.url, config.key, {
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				// sign-in is a wallet signature; nothing ever arrives in the URL
				detectSessionInUrl: false,
				storageKey: RELAY_STORAGE_KEY,
			},
		}),
	);
	return loading;
}

/** True when a session was left in this browser; read without loading the client. */
export function hasStoredSession(): boolean {
	try {
		return window.localStorage.getItem(RELAY_STORAGE_KEY) !== null;
	} catch {
		return false;
	}
}
