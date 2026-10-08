import { walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { describe, expect, it } from "vitest";
import { SIGNER_WALLET_GROUPS } from "./signerWallets";

describe("the multisig signer's wallet list", () => {
	it("never includes RainbowKit's generic WalletConnect entry", () => {
		// That entry starts an AppKit modal whose analytics send the page URL
		// (treasury address, proposal digest) to a third party on every load.
		const wallets = SIGNER_WALLET_GROUPS.flatMap((g) => g.wallets);
		expect(wallets.length).toBeGreaterThan(0);
		expect(wallets).not.toContain(walletConnectWallet);
		const ids = wallets.map(
			(wallet) => wallet({ projectId: "test", appName: "test" }).id,
		);
		expect(ids).not.toContain("walletConnect");
		expect(new Set(ids).size).toBe(ids.length);
	});
});
