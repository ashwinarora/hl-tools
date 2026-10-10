import {
	baseAccount,
	metaMaskWallet,
	rainbowWallet,
	safeWallet,
} from "@rainbow-me/rainbowkit/wallets";

/**
 * The wallets the multisig signer's picker offers besides the installed ones
 * (EIP-6963), which RainbowKit detects and lists first.
 *
 * This is RainbowKit's default list without its generic "WalletConnect" entry.
 * That entry creates a Reown AppKit modal as soon as the wagmi configuration
 * exists, and AppKit reports `window.location.href` to
 * pulse.walletconnect.org on every page load. On the signer's pages the URL
 * names the treasury (`?treasury=`) or the proposal (`?digest=`), and for a
 * moment after a link is opened it holds the whole proposal in its fragment.
 * `signerWallets.test.ts` keeps the entry out.
 */
export const SIGNER_WALLET_GROUPS = [
	{
		groupName: "Popular",
		wallets: [safeWallet, rainbowWallet, baseAccount, metaMaskWallet],
	},
];
