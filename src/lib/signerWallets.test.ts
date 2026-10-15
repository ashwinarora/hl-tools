import { connectorsForWallets, type Wallet } from "@rainbow-me/rainbowkit";
import {
	baseAccount,
	metaMaskWallet,
	rainbowWallet,
	walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig, http } from "wagmi";
import { hyperEvm } from "wagmi/chains";
import {
	browserWallet,
	SIGNER_WALLET_GROUPS,
	walletInBrowser,
} from "./signerWallets";

/** Any of RainbowKit's wallet entries, with or without options. */
type Entry = (options: { projectId: string; appName: string }) => Wallet;

const make = (wallet: Entry) => wallet({ projectId: "test", appName: "test" });

/** A wallet entry that can show a WalletConnect QR code or deep link: it reaches WalletConnect's relay. */
const reachesWalletConnect = (w: Wallet): boolean =>
	w.qrCode !== undefined ||
	w.mobile?.getUri !== undefined ||
	w.desktop?.getUri !== undefined;

describe("the multisig signer's wallet list", () => {
	const wallets: readonly Entry[] = SIGNER_WALLET_GROUPS.flatMap(
		(g) => g.wallets,
	);

	it("never includes RainbowKit's generic WalletConnect entry", () => {
		// That entry starts an AppKit modal whose analytics send the page URL
		// (treasury address, proposal digest) to a third party on every load.
		expect(wallets.length).toBeGreaterThan(0);
		expect(wallets).not.toContain(walletConnectWallet);
		const ids = wallets.map((wallet) => make(wallet).id);
		expect(ids).not.toContain("walletConnect");
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("offers no wallet that falls back to WalletConnect when its extension is missing", () => {
		// what the audit found: picking MetaMask or Rainbow without the extension
		// opens a socket to relay.walletconnect.org, on that click and on every later load
		for (const wallet of wallets) {
			const w = make(wallet);
			expect(reachesWalletConnect(w), w.id).toBe(false);
		}
		// the check does see the two entries it is there for
		expect(reachesWalletConnect(make(metaMaskWallet))).toBe(true);
		expect(reachesWalletConnect(make(rainbowWallet))).toBe(true);
		expect(wallets).not.toContain(metaMaskWallet);
		expect(wallets).not.toContain(rainbowWallet);
	});

	it("offers no wallet that opens a third party's pop-up", () => {
		// "Base Account" opens keys.coinbase.com with the site's origin
		expect(wallets).not.toContain(baseAccount);
		const ids = wallets.map((wallet) => make(wallet).id);
		for (const id of ["baseAccount", "coinbase", "coinbaseWallet"])
			expect(ids).not.toContain(id);
	});
	it("creates no WalletConnect or Coinbase connector", () => {
		// what wagmi ends up with: a WalletConnect connector opens its relay socket when it is set up
		const types = (groups: Parameters<typeof connectorsForWallets>[0]) =>
			createConfig({
				chains: [hyperEvm],
				transports: { [hyperEvm.id]: http() },
				connectors: connectorsForWallets(groups, {
					projectId: "test",
					appName: "test",
				}),
				multiInjectedProviderDiscovery: false,
			}).connectors.map((c) => c.type);
		expect(types(SIGNER_WALLET_GROUPS)).toEqual(["injected", "safe"]);
		// the check does see the fallback it is there for
		expect(types([{ groupName: "x", wallets: [rainbowWallet] }])).toContain(
			"walletConnect",
		);
	});
});

describe("what there is to connect to in this browser", () => {
	afterEach(() => vi.unstubAllGlobals());

	/** A stand-in for `window`: with or without an injected provider, and wallets that announce themselves. */
	function browser(o: {
		injected?: boolean;
		announced?: number;
		framed?: boolean;
	}) {
		const w = new EventTarget() as EventTarget & Record<string, unknown>;
		if (o.injected) w.ethereum = {};
		w.parent = o.framed ? {} : w;
		w.addEventListener("eip6963:requestProvider", () => {
			for (let i = 0; i < (o.announced ?? 0); i++)
				w.dispatchEvent(new Event("eip6963:announceProvider"));
		});
		vi.stubGlobal("window", w);
	}

	it("finds nothing on the server and in a browser with no wallet", () => {
		expect(walletInBrowser()).toBe(false);
		browser({});
		expect(walletInBrowser()).toBe(false);
		// the picker then has no row to offer: a prompt nobody could answer
		expect(browserWallet().installed).toBe(false);
	});

	it("finds a wallet that announces itself, one that only injects, and a Safe app's frame", () => {
		browser({ injected: true, announced: 1 });
		expect(walletInBrowser()).toBe(true);
		browser({ injected: true });
		expect(walletInBrowser()).toBe(true);
		browser({ framed: true });
		expect(walletInBrowser()).toBe(true);
		// a caller that already has the count is believed, and nothing is asked
		browser({});
		expect(walletInBrowser(1)).toBe(true);
		expect(walletInBrowser(0)).toBe(false);
	});

	it('offers "Browser Wallet" only for a wallet that injects without announcing itself', () => {
		browser({ injected: true });
		expect(browserWallet().installed).toBe(true);
		// next to an announced wallet it would be a second door to the same one
		browser({ injected: true, announced: 2 });
		expect(browserWallet().installed).toBe(false);
		expect(browserWallet().id).toBe("injected");
	});
});
