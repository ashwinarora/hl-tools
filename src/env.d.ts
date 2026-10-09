/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_WALLETCONNECT_PROJECT_ID: string;
	/** The multisig relay. Both absent: the Multisig Signer runs without it. */
	readonly VITE_SUPABASE_URL?: string;
	readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
