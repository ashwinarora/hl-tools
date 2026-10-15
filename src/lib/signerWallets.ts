import type { Wallet } from "@rainbow-me/rainbowkit";
import { injectedWallet, safeWallet } from "@rainbow-me/rainbowkit/wallets";

/**
 * How many wallets in this browser announce themselves (EIP-6963), asked at
 * the moment of the call: a wallet answers the request event synchronously.
 */
function announcedWallets(): number {
	if (typeof window === "undefined") return 0;
	let n = 0;
	const count = () => {
		n++;
	};
	window.addEventListener("eip6963:announceProvider", count);
	window.dispatchEvent(new Event("eip6963:requestProvider"));
	window.removeEventListener("eip6963:announceProvider", count);
	return n;
}

const injected = (): boolean =>
	typeof window !== "undefined" &&
	typeof (window as { ethereum?: unknown }).ethereum !== "undefined";

/**
 * True when there is something to connect to here: a wallet that announces
 * itself, one that only injects, or a Safe app's frame around the page.
 * A caller that already knows how many wallets announced themselves (wagmi
 * keeps count) passes it, so that nothing is asked again on every render.
 */
export function walletInBrowser(announced?: number): boolean {
	if (typeof window === "undefined") return false;
	return (
		injected() ||
		window.parent !== window ||
		(announced ?? announcedWallets()) > 0
	);
}

/** Said in place of an empty picker: it offers no QR code to a phone wallet. */
export const NO_WALLET =
	"No wallet was found in this browser. Install a wallet extension, or open this page in your wallet's own browser.";

/**
 * RainbowKit's "Browser Wallet", offered only where it is the one way in: a
 * wallet that injects without announcing itself (some in-wallet browsers).
 * Next to a wallet that announced itself it is a second door to the same
 * wallet and reads like one the signer does not have; with no wallet at all
 * it opens a prompt nobody can answer (both seen by the audit, 2026-10-12).
 */
export const browserWallet = (): Wallet => ({
	...injectedWallet(),
	installed: injected() && announcedWallets() === 0,
});

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
		wallets: [browserWallet, safeWallet],
	},
];
