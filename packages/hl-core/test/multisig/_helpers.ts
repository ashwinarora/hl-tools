/**
 * Shared test material for the multisig suites: six deterministic keys (the
 * Python SDK's public test key plus five tiny ones), base proposals for both
 * hashing schemes, and signing helpers. Nothing here touches the network.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "../../src/identity.ts";
import {
	type Hex,
	innerDigest,
	normaliseSig,
	type PlainObject,
	type Policy,
	type Proposal,
	type ProposalPayload,
	type ProposalSignature,
	padSig,
	type Sig,
} from "../../src/multisig/index.ts";
import type { Network } from "../../src/network.ts";

export const KEYS = [
	"0x0123456789012345678901234567890123456789012345678901234567890123",
	"0x0000000000000000000000000000000000000000000000000000000000000001",
	"0x0000000000000000000000000000000000000000000000000000000000000002",
	"0x0000000000000000000000000000000000000000000000000000000000000003",
	"0x0000000000000000000000000000000000000000000000000000000000000004",
	"0x0000000000000000000000000000000000000000000000000000000000000005",
] as const;

export const ACCOUNTS = KEYS.map((k) => privateKeyToAccount(k));
export const ADDRESSES = ACCOUNTS.map(
	(a) => a.address.toLowerCase() as Address,
);
/** Roles: [0] = treasury (the multi-sig user), [1..3] = signers A, B, C, [4] = outsider, [5] = spare. */
export const TREASURY = ADDRESSES[0] as Address;
export const A = ADDRESSES[1] as Address;
export const B = ADDRESSES[2] as Address;
export const C = ADDRESSES[3] as Address;
export const OUTSIDER = ADDRESSES[4] as Address;
export const SPARE = ADDRESSES[5] as Address;
export const RECIPIENT =
	"0x51d3aaa37dc88af4d4ef846629e7e7f201b47fd9" as Address;
export const VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303" as Address;

export const NONCE = 1_791_399_781_235;
export const NOW = NONCE + 60_000;

export const POLICY: Policy = {
	authorizedUsers: [A, B, C].sort(),
	threshold: 2,
	observedAt: NOW,
};

export const ORDER: PlainObject = {
	type: "order",
	orders: [
		{
			a: 3,
			b: true,
			p: "50000",
			s: "0.001",
			r: false,
			t: { limit: { tif: "Gtc" } },
		},
	],
	grouping: "na",
};

export function usdSend(
	nonce = NONCE,
	network: Network = "testnet",
): PlainObject {
	return {
		type: "usdSend",
		signatureChainId: "0x66eee",
		hyperliquidChain: network === "testnet" ? "Testnet" : "Mainnet",
		destination: RECIPIENT,
		amount: "5",
		time: nonce,
	};
}

export function payload(
	overrides: Partial<ProposalPayload> = {},
): ProposalPayload {
	return {
		network: "testnet",
		multiSigUser: TREASURY,
		outerSigner: A,
		action: ORDER,
		nonce: NONCE,
		vaultAddress: null,
		expiresAfter: null,
		...overrides,
	};
}

export function userPayload(
	overrides: Partial<ProposalPayload> = {},
): ProposalPayload {
	return payload({ action: usdSend(), ...overrides });
}

export function digestOf(p: ProposalPayload): Hex {
	const d = innerDigest(p).digest;
	if (!d) throw new Error("undigestable test payload");
	return d;
}

/** Sign a 32-byte digest with one of the test accounts (raw ECDSA, as a wallet would). */
export async function signDigest(digest: Hex, index: number): Promise<Sig> {
	const account = ACCOUNTS[index];
	if (!account) throw new Error(`no test account ${index}`);
	const hex = await account.sign({ hash: digest });
	const n = normaliseSig(hex).sig;
	if (!n) throw new Error("test signature did not parse");
	return padSig(n);
}

export async function signatureBy(
	p: ProposalPayload,
	index: number,
	at: number | null = NOW,
): Promise<ProposalSignature> {
	const sig = await signDigest(digestOf(p), index);
	return { ...sig, signer: ADDRESSES[index] as Address, at };
}

export function proposalOf(
	p: ProposalPayload,
	signatures: readonly ProposalSignature[] = [],
	extra: Partial<Proposal> = {},
): Proposal {
	return {
		v: 1,
		payload: p,
		digest: digestOf(p),
		signatures,
		meta: {
			kind:
				typeof p.action.type === "string" && p.action.type === "order"
					? "l1"
					: "user-signed",
			title: null,
			note: null,
			createdBy: A,
			createdAt: NONCE,
			supersedes: null,
			policyAtCreation: POLICY,
		},
		receipt: null,
		...extra,
	};
}

export function codes(issues: readonly { code: string }[]): string[] {
	return issues.map((i) => i.code);
}
