/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_WALLETCONNECT_PROJECT_ID: string;
	/** The multisig relay. Both absent: the Multisig Signer runs without it. */
	readonly VITE_SUPABASE_URL?: string;
	readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
	/** The signing network's link (chain 1337). Absent: no vault forms in the Multisig Signer. */
	readonly VITE_CHAIN_1337_RPC_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
