import { injectedWallet, safeWallet } from "@rainbow-me/rainbowkit/wallets";

/**
 * The wallets the multisig signer's picker offers besides the installed ones
 * (EIP-6963), which RainbowKit detects and lists first: a wallet in the
 * browser that does not announce itself, and Safe (which only works inside a
 * Safe app's frame).
 *
 * The rule: no entry may reach a third party. The signer's pages contact
 * Hyperliquid and, when someone signs in, the relay, and nothing else.
 *
 * - RainbowKit's generic "WalletConnect" entry creates a Reown AppKit modal as
 *   soon as the wagmi configuration exists, and AppKit reports
 *   `window.location.href` to pulse.walletconnect.org on every page load. On
 *   these pages the URL names the treasury or the proposal, and for a moment
 *   after a link is opened it holds the whole proposal in its fragment.
 * - Its MetaMask and Rainbow entries fall back to a WalletConnect QR code when
 *   the extension is not installed: picking one opens a socket to
 *   relay.walletconnect.org, and because the choice is remembered, so does
 *   every later page load (found by the mainnet audit, 2026-10-12). With the
 *   extension installed they are listed anyway, as installed wallets.
 * - "Base Account" opens a pop-up to keys.coinbase.com that carries the
 *   site's origin.
 *
 * `signerWallets.test.ts` keeps all three kinds out.
 */
export const SIGNER_WALLET_GROUPS = [
	{
		groupName: "In this browser",
		wallets: [injectedWallet, safeWallet],
	},
];
