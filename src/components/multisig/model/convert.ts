/**
 * Converting an account into a multi-sig with its own key: build the action,
 * have the wallet sign it, post it, and read the signer set back. Pure: the
 * wallet, the exchange and the read are handed in, so every outcome can be
 * tested without either.
 *
 * Two things this is careful about. A signature from another key than the
 * account's is never sent: Hyperliquid would convert whoever signed. And a
 * request that got no answer is never called "nothing was sent": the signer
 * set is read to learn which way it went.
 */
import {
	type Address,
	conversionAction,
	type Hex,
	type Issue,
	type Network,
	type PlainObject,
	type Policy,
	type Sig,
	type SignedUserAction,
	type SignerSet,
} from "@hl-tools/core";
import { INNER_CHAINS, knownChain } from "./chains";
import { sameSet } from "./signerSet";
import type { UserActionResult } from "./submit";

export type ConvertOutcome =
	/** The action could not be built (a bug in the caller, or a bad chain id). */
	| { readonly kind: "invalid"; readonly issues: readonly Issue[] }
	/** The wallet refused, failed, or could not switch chain. Nothing was sent. */
	| { readonly kind: "not-signed"; readonly reason: string }
	/** The wallet signed with another key. Nothing was sent. */
	| { readonly kind: "wrong-key"; readonly signedBy: Address | null }
	/** Hyperliquid answered with an error. Nothing changed. */
	| { readonly kind: "refused"; readonly id: string; readonly message: string }
	/** Accepted, and the signer set read back is the one asked for. */
	| { readonly kind: "converted"; readonly policy: Policy }
	/** Accepted, but the signer set did not show up while this waited. */
	| { readonly kind: "unconfirmed" }
	/**
	 * The request got no answer. `converted`: what reading the signer set
	 * showed afterwards (true, false, or null when that could not be read).
	 */
	| {
			readonly kind: "unanswered";
			readonly converted: boolean | null;
			readonly policy: Policy | null;
	  };

export interface ConvertInput {
	readonly network: Network;
	/** The account being converted: the one whose key must sign. */
	readonly account: Address;
	readonly set: SignerSet;
	/** The chain the wallet signs under, as hex. */
	readonly signatureChainId: Hex;
	readonly nonce: number;
}

export interface ConvertDeps {
	/** Ask the wallet; must refuse a signature that does not recover to the account. */
	sign(action: PlainObject): Promise<SignedUserAction>;
	/** POST it. Rejects only when no answer came. */
	post(action: PlainObject, signature: Sig): Promise<UserActionResult>;
	/** The account's signer set now, read fresh; null when it is not a multi-sig. */
	readSigners(): Promise<Policy | null>;
	wait(ms: number): Promise<void>;
	/** Called as each step starts, for the page's progress line. */
	onStep?(step: "wallet" | "sending" | "reading"): void;
}

/** How often and how long the signer set is read back: it showed after a third of a second on testnet. */
export const READ_BACK = { tries: 8, everyMs: 500 } as const;

async function readBack(
	set: SignerSet,
	deps: ConvertDeps,
): Promise<{ policy: Policy | null; matched: boolean; read: boolean }> {
	let last: Policy | null = null;
	let read = false;
	for (let i = 0; i < READ_BACK.tries; i++) {
		if (i > 0) await deps.wait(READ_BACK.everyMs);
		try {
			last = await deps.readSigners();
			read = true;
			if (last && sameSet(last, set))
				return { policy: last, matched: true, read };
		} catch {
			// asked again on the next turn
		}
	}
	return { policy: last, matched: false, read };
}

export async function runConvert(
	input: ConvertInput,
	deps: ConvertDeps,
): Promise<ConvertOutcome> {
	const built = conversionAction({
		network: input.network,
		signatureChainId: input.signatureChainId,
		set: input.set,
		nonce: input.nonce,
	});
	if (!built.action) return { kind: "invalid", issues: built.issues };

	deps.onStep?.("wallet");
	const signed = await deps.sign(built.action);
	if (!signed.signature) {
		const mismatch = signed.issues.some(
			(i) => i.code === "signature.signer_mismatch",
		);
		return mismatch
			? { kind: "wrong-key", signedBy: signed.recovered }
			: {
					kind: "not-signed",
					reason: signed.issues[0]?.message ?? "The wallet did not sign.",
				};
	}

	deps.onStep?.("sending");
	let answer: UserActionResult;
	try {
		answer = await deps.post(built.action, signed.signature);
	} catch {
		deps.onStep?.("reading");
		const r = await readBack(input.set, deps);
		return {
			kind: "unanswered",
			converted: r.matched ? true : r.read ? false : null,
			policy: r.matched ? r.policy : null,
		};
	}
	if (!answer.ok) {
		return {
			kind: "refused",
			id: answer.explained.id,
			message: answer.explained.message,
		};
	}

	deps.onStep?.("reading");
	const r = await readBack(input.set, deps);
	return r.matched && r.policy
		? { kind: "converted", policy: r.policy }
		: { kind: "unconfirmed" };
}

/**
 * The chain a conversion is signed under: one of the network being converted
 * on, as a proposal's is. Hyperliquid would accept any chain here (measured:
 * fixtures/multisig/plain-convert.json), and the wizard used to keep whatever
 * chain the wallet was on. The first mainnet run showed what that looks like:
 * a wallet prompt saying chain 998, HyperEVM's test network, next to
 * "Mainnet", on the one action that hands an account over. So the wallet
 * stays where it is only when that is already a chain of this network
 * (HyperEVM or Arbitrum), and is asked to switch to this network's HyperEVM
 * otherwise.
 */
export function convertChain(
	walletChainId: number | null,
	network: Network,
): { readonly hex: Hex; readonly id: number; readonly switches: boolean } {
	const here = walletChainId === null ? null : knownChain(walletChainId);
	const ofThisNetwork = Object.values(INNER_CHAINS[network]);
	if (here && ofThisNetwork.some((c) => c.id === here.id))
		return { hex: here.hex, id: here.id, switches: false };
	const home = INNER_CHAINS[network].hyperevm;
	return { hex: home.hex, id: home.id, switches: true };
}
