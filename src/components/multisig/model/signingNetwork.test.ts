import { innerDigest, type ProposalPayload } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { makeProposal, TREASURY } from "#/test/keys";
import { HELP, HELP_JARGON } from "./help";
import { FORBIDDEN_CLAIMS } from "./relay/copy";
import {
	addNetworkRequest,
	addSigningNetwork,
	CODE_COPY,
	chainAfterSigning,
	envelopeChainOf,
	goToSigningNetwork,
	isVaultAction,
	SIGNING_CHAIN_HEX,
	SIGNING_CHAIN_ID,
	SIGNING_NETWORK_NAME,
	signingChainOf,
	signingCodeOf,
	signingNetwork,
	type WalletProvider,
} from "./signingNetwork";

const VAULT = "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0";
const DEPOSIT = {
	type: "vaultTransfer",
	vaultAddress: VAULT,
	isDeposit: true,
	usd: 5_000_000,
};
const NET = { rpcUrl: "http://localhost:3337/rpc" };
const noWait = async () => undefined;

/**
 * A wallet as far as this needs one. `has`: it holds network 1337. `chain`
 * moves when it switches. `on`: what it does instead for one method.
 */
function wallet(o: {
	chain?: string;
	has?: boolean;
	on?: Partial<Record<string, (params: unknown) => unknown>>;
	lazy?: number;
}) {
	const asked: string[] = [];
	let chain = o.chain ?? "0x3e6";
	let has = o.has ?? false;
	let lazy = o.lazy ?? 0;
	const provider: WalletProvider = {
		async request({ method, params }) {
			asked.push(method);
			const custom = o.on?.[method];
			if (custom) return custom(params);
			switch (method) {
				case "eth_chainId":
					// a wallet that answers a switch before it has switched
					if (lazy > 0 && chain === "0x539") {
						lazy -= 1;
						return "0x3e6";
					}
					return chain;
				case "wallet_switchEthereumChain":
					if (!has)
						throw Object.assign(new Error('Unrecognized chain ID "0x539".'), {
							code: -32603,
						});
					chain = (params as [{ chainId: string }])[0].chainId;
					return null;
				case "wallet_addEthereumChain":
					has = true;
					chain = "0x539";
					return null;
				default:
					throw new Error(`unexpected ${method}`);
			}
		},
	};
	return { provider, asked, where: () => chain };
}
const declined = () => {
	throw Object.assign(new Error("User rejected the request."), { code: 4001 });
};

const HEAD = { signatureChainId: "0x3E6", hyperliquidChain: "Testnet" };

describe("the chain a wallet has to be on to sign an action", () => {
	it("is the one a readable action names for itself", () => {
		expect(
			signingChainOf({ type: "sendAsset", ...HEAD, destination: "0x1" }),
		).toEqual({ hex: "0x3e6", id: 998, label: "HyperEVM testnet (998)" });
		expect(
			signingChainOf({ type: "tokenDelegate", signatureChainId: "0xa4b1" }),
		).toEqual({ hex: "0xa4b1", id: 42161, label: "Arbitrum One (42161)" });
	});
	it("is the signing network for a code, whatever the action says", () => {
		expect([SIGNING_CHAIN_ID, SIGNING_CHAIN_HEX]).toEqual([1337, "0x539"]);
		const signing = {
			hex: "0x539",
			id: 1337,
			label: "the signing network (1337)",
		};
		expect(
			signingChainOf({
				type: "vaultTransfer",
				vaultAddress: "0x1",
				isDeposit: true,
				usd: 5_000_000,
			}),
		).toEqual(signing);
		// a field somebody added to it changes nothing: the code is signed under 1337
		expect(
			signingChainOf({ type: "vaultTransfer", signatureChainId: "0x3e6" }),
		).toEqual(signing);
		expect(signingChainOf({ type: "order", orders: [] })).toEqual(signing);
	});
	it("is unknown for a readable action that names none, and for an envelope", () => {
		expect(signingChainOf({ type: "sendAsset" })).toBeNull();
		expect(
			signingChainOf({ type: "usdSend", signatureChainId: "998" }),
		).toBeNull();
		expect(
			signingChainOf({ type: "multiSig", signatureChainId: "0x3e6" }),
		).toBeNull();
		expect(signingChainOf({})).toBeNull();
	});
});

describe("the envelope's own chain", () => {
	it("is the action's chain for a readable action, as before", () => {
		expect(
			envelopeChainOf(
				{ type: "sendAsset", signatureChainId: "0x66eee" },
				"testnet",
				998,
			)?.id,
		).toBe(421614);
	});
	it("is never the signing network: the wallet's own chain when that is one of this network's, its HyperEVM otherwise", () => {
		expect(envelopeChainOf(DEPOSIT, "testnet", 998)?.hex).toBe("0x3e6");
		expect(envelopeChainOf(DEPOSIT, "testnet", 421614)?.hex).toBe("0x66eee");
		// left on the signing network, on Ethereum, on mainnet's chain, or not connected
		for (const elsewhere of [1337, 1, 999, null])
			expect(envelopeChainOf(DEPOSIT, "testnet", elsewhere)).toEqual({
				hex: "0x3e6",
				id: 998,
				label: "HyperEVM testnet (998)",
			});
		expect(envelopeChainOf(DEPOSIT, "mainnet", 42161)?.id).toBe(42161);
		expect(envelopeChainOf(DEPOSIT, "mainnet", 998)?.id).toBe(999);
		expect(envelopeChainOf({ type: "sendAsset" }, "testnet", 998)).toBeNull();
	});
});

describe("where the wallet goes when a click is over", () => {
	it("goes back to the chain it was on when the click was made", () => {
		expect(chainAfterSigning(998, "testnet")).toBe(998);
		// also one that is no chain of this network: it is the person's own
		expect(chainAfterSigning(1, "testnet")).toBe(1);
		expect(chainAfterSigning(42161, "testnet")).toBe(42161);
	});
	it("goes to this network's HyperEVM when it was already on the signing network, or unknown", () => {
		expect(chainAfterSigning(SIGNING_CHAIN_ID, "testnet")).toBe(998);
		expect(chainAfterSigning(SIGNING_CHAIN_ID, "mainnet")).toBe(999);
		expect(chainAfterSigning(null, "mainnet")).toBe(999);
	});
});

describe("which action of the code family is signed here, and its code", () => {
	const payload = (over: Partial<ProposalPayload> = {}): ProposalPayload => ({
		...makeProposal({ action: DEPOSIT }).payload,
		...over,
	});
	it("a vault deposit or withdrawal by the account itself, and nothing else", () => {
		expect(isVaultAction(payload())).toBe(true);
		expect(
			isVaultAction(payload({ action: { ...DEPOSIT, isDeposit: false } })),
		).toBe(true);
		// acting for a vault or a sub-account, or with an expiry: other uses of the family
		expect(isVaultAction(payload({ vaultAddress: TREASURY }))).toBe(false);
		expect(isVaultAction(payload({ expiresAfter: 1 }))).toBe(false);
		expect(isVaultAction(payload({ action: { type: "order" } }))).toBe(false);
		expect(isVaultAction(makeProposal().payload)).toBe(false);
	});
	it("shows the code the wallet will show: the hash the core signs, and the network's letter", () => {
		const p = payload();
		const d = innerDigest(p);
		const code = signingCodeOf(p);
		expect(code?.code).toBe(d.l1?.connectionId);
		expect(code?.code).toMatch(/^0x[0-9a-f]{64}$/);
		expect(code?.source).toBe("b");
		expect(code?.domainHash).toMatch(/^0x[0-9a-f]{64}$/);
		expect(code?.messageHash).toMatch(/^0x[0-9a-f]{64}$/);
		// another amount, finaliser or number is another code
		expect(
			signingCodeOf(payload({ action: { ...DEPOSIT, usd: 5_000_001 } }))?.code,
		).not.toBe(code?.code);
		expect(signingCodeOf(payload({ nonce: p.nonce + 1 }))?.code).not.toBe(
			code?.code,
		);
		expect(signingCodeOf(payload({ network: "mainnet" }))?.source).toBe("a");
		// a readable action has no code
		expect(signingCodeOf(makeProposal().payload)).toBeNull();
	});
});

describe("the signing network of a build", () => {
	it("is there only when the build was given its link", () => {
		expect(
			signingNetwork({
				VITE_CHAIN_1337_RPC_URL: " http://localhost:3337/rpc ",
			}),
		).toEqual(NET);
		expect(signingNetwork({})).toBeNull();
		expect(signingNetwork({ VITE_CHAIN_1337_RPC_URL: "  " })).toBeNull();
	});
	it("asks the wallet to add chain 1337 under a name wallets know for it", () => {
		expect(addNetworkRequest(NET)).toEqual({
			chainId: "0x539",
			chainName: SIGNING_NETWORK_NAME,
			nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
			rpcUrls: ["http://localhost:3337/rpc"],
		});
	});
});

describe("bringing a wallet onto the signing network", () => {
	it("asks for nothing when the wallet is there already", async () => {
		const w = wallet({ chain: "0x539", has: true });
		expect(await goToSigningNetwork(w.provider, noWait)).toEqual({
			ok: true,
			switched: false,
		});
		expect(w.asked).toEqual(["eth_chainId"]);
	});
	it("switches a wallet that has the network, and waits until it is there", async () => {
		const w = wallet({ has: true, lazy: 2 });
		expect(await goToSigningNetwork(w.provider, noWait)).toEqual({
			ok: true,
			switched: true,
		});
		expect(w.asked.filter((m) => m === "eth_chainId")).toHaveLength(4);
		expect(w.where()).toBe("0x539");
	});
	it("a wallet that does not have it is not an error: the page offers to add it", async () => {
		// Rabby's own answer, and the standard's
		for (const code of [-32603, 4902]) {
			const w = wallet({
				on: {
					wallet_switchEthereumChain: () => {
						throw Object.assign(new Error("Unrecognized chain ID"), { code });
					},
				},
			});
			expect(await goToSigningNetwork(w.provider, noWait)).toEqual({
				ok: false,
				why: "missing",
				message: CODE_COPY.missing,
			});
			expect(w.asked).not.toContain("wallet_addEthereumChain");
		}
	});
	it("a no in the wallet is a no", async () => {
		const w = wallet({
			has: true,
			on: { wallet_switchEthereumChain: declined },
		});
		expect(await goToSigningNetwork(w.provider, noWait)).toEqual({
			ok: false,
			why: "declined",
			message: "You declined in the wallet.",
		});
	});
	it("a wallet that says yes and stays where it was is told apart from one that lacks the network", async () => {
		const w = wallet({
			has: true,
			on: { wallet_switchEthereumChain: () => null },
		});
		expect(await goToSigningNetwork(w.provider, noWait)).toEqual({
			ok: false,
			why: "failed",
			message: CODE_COPY.didNotSwitch,
		});
		// and one that cannot even say which chain it is on is asked to switch all the same
		const mute = wallet({
			has: true,
			on: {
				eth_chainId: () => {
					throw new Error("no");
				},
			},
		});
		expect((await goToSigningNetwork(mute.provider, noWait)).ok).toBe(false);
		expect(mute.asked).toContain("wallet_switchEthereumChain");
	});
});

describe("adding the signing network to a wallet", () => {
	it("one request, and the wallet is on it", async () => {
		const w = wallet({});
		expect(await addSigningNetwork(w.provider, NET, noWait)).toEqual({
			ok: true,
			switched: true,
		});
		expect(w.asked[0]).toBe("wallet_addEthereumChain");
		expect(w.asked).not.toContain("wallet_switchEthereumChain");
	});
	it("a wallet that adds without switching is then asked to switch", async () => {
		let has = false;
		let chain = "0x3e6";
		const asked: string[] = [];
		const provider: WalletProvider = {
			async request({ method }) {
				asked.push(method);
				if (method === "eth_chainId") return chain;
				if (method === "wallet_addEthereumChain") {
					has = true;
					return null;
				}
				if (!has) throw Object.assign(new Error("unknown"), { code: 4902 });
				chain = "0x539";
				return null;
			},
		};
		expect(await addSigningNetwork(provider, NET, noWait)).toEqual({
			ok: true,
			switched: true,
		});
		expect(asked).toContain("wallet_switchEthereumChain");
	});
	it("a no is a no; a wallet that will not add it gets the two things to type in", async () => {
		const no = wallet({ on: { wallet_addEthereumChain: declined } });
		expect(await addSigningNetwork(no.provider, NET, noWait)).toMatchObject({
			ok: false,
			why: "declined",
		});
		const cannot = wallet({
			on: {
				wallet_addEthereumChain: () => {
					throw new Error("Method not supported");
				},
			},
		});
		const said = await addSigningNetwork(cannot.provider, NET, noWait);
		expect(said).toEqual({
			ok: false,
			why: "failed",
			message:
				"The wallet would not add the signing network. Add a network with chain id 1337 and this link in the wallet, then sign again: http://localhost:3337/rpc",
		});
		// it said yes to adding and still does not have it
		const liar = wallet({ on: { wallet_addEthereumChain: () => null } });
		expect(await addSigningNetwork(liar.provider, NET, noWait)).toMatchObject({
			ok: false,
			why: "failed",
			message: CODE_COPY.wouldNotAdd(NET),
		});
		// it added it, said yes to the switch, and stayed where it was
		let added = false;
		const stuck: WalletProvider = {
			async request({ method }) {
				if (method === "eth_chainId") return "0x3e6";
				if (method === "wallet_addEthereumChain") added = true;
				if (method === "wallet_switchEthereumChain" && !added)
					throw new Error("unknown");
				return null;
			},
		};
		expect(await addSigningNetwork(stuck, NET, noWait)).toMatchObject({
			ok: false,
			why: "failed",
			message: CODE_COPY.didNotSwitch,
		});
	});
	it("waits on the real clock when none is given", async () => {
		const w = wallet({ chain: "0x539", has: true });
		expect((await goToSigningNetwork(w.provider)).ok).toBe(true);
		const lazy = wallet({ has: true, lazy: 1 });
		expect((await goToSigningNetwork(lazy.provider)).ok).toBe(true);
	});
});

describe("the words about signing a code", () => {
	const texts = [
		CODE_COPY.intro,
		CODE_COPY.check,
		CODE_COPY.asShown("b"),
		CODE_COPY.missing,
		CODE_COPY.add,
		CODE_COPY.adding,
		CODE_COPY.didNotSwitch,
		CODE_COPY.wouldNotAdd(NET),
		CODE_COPY.absentHead,
		CODE_COPY.absentBody,
		CODE_COPY.signedUnder,
		CODE_COPY.chainLabel,
		CODE_COPY.chainHint("HyperEVM testnet", false),
		CODE_COPY.chainHint("HyperEVM testnet", true),
		HELP.signingCode.body,
		HELP.signingNetwork.body,
	];
	it("promise nothing the product does not provide, in plain words", () => {
		for (const t of texts) {
			for (const claim of FORBIDDEN_CLAIMS)
				expect(t, `${claim} in "${t}"`).not.toMatch(claim);
			for (const word of HELP_JARGON)
				expect(t, `${word} in "${t}"`).not.toMatch(word);
		}
	});
	it("say what the wallet shows and what the signer does about it", () => {
		expect(CODE_COPY.asShown("a")).toBe(
			'In the wallet it is the field "connectionId", next to "source: a".',
		);
		expect(CODE_COPY.missing).toContain(
			"Nothing is ever sent on that network.",
		);
	});
	it("say that the chain chosen in a vault form is the finaliser's, not the signers'", () => {
		// the signers of a vault action never switch to that chain: only what
		// is signed as readable data is under it
		expect(CODE_COPY.chainHint("Arbitrum Sepolia", false)).toBe(
			"Signers sign a code, under the signing network. Only the signature the finaliser submits with is under Arbitrum Sepolia; nothing is sent to that chain.",
		);
		expect(CODE_COPY.chainHint("Arbitrum Sepolia", true)).toContain(
			"Step 1, and the signatures the finaliser submits with, are under Arbitrum Sepolia",
		);
	});
});
