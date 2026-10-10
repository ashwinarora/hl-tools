/**
 * Deterministic test material for the app-level suites, mirroring
 * `packages/hl-core/test/multisig/_helpers.ts` (the Python SDK's public test
 * key plus five tiny ones). Nothing here touches the network.
 */
import {
	type Address,
	createProposal,
	type PlainObject,
	type Policy,
	type Proposal,
	signProposal,
	viemSigner,
} from "@hl-tools/core";
import { privateKeyToAccount } from "viem/accounts";

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
/** Roles: [0] treasury, [1..3] signers A, B, C, [4] outsider, [5] spare. */
export const TREASURY = ADDRESSES[0] as Address;
export const A = ADDRESSES[1] as Address;
export const B = ADDRESSES[2] as Address;
export const C = ADDRESSES[3] as Address;
export const OUTSIDER = ADDRESSES[4] as Address;
export const RECIPIENT =
	"0x51d3aaa37dc88af4d4ef846629e7e7f201b47fd9" as Address;

export const NONCE = 1_791_399_781_235;
export const NOW = NONCE + 60_000;

export const POLICY: Policy = {
	authorizedUsers: [A, B, C].sort(),
	threshold: 2,
	observedAt: NOW,
};

/** A testnet usdSend signed under HyperEVM testnet (0x3e6), as the signer UI builds it. */
export function usdSend(over: Record<string, unknown> = {}): PlainObject {
	return {
		type: "usdSend",
		signatureChainId: "0x3e6",
		hyperliquidChain: "Testnet",
		destination: RECIPIENT,
		amount: "1",
		time: NONCE,
		...over,
	} as PlainObject;
}

/** An unsigned proposal: treasury → RECIPIENT, leader B unless overridden. */
export function makeProposal(
	over: { leader?: Address; action?: PlainObject; title?: string } = {},
): Proposal {
	const r = createProposal(
		{
			network: "testnet",
			multiSigUser: TREASURY,
			outerSigner: over.leader ?? B,
			action: over.action ?? usdSend(),
			nonce: NONCE,
			title: over.title ?? "test proposal",
			policyAtCreation: POLICY,
		},
		{ now: NOW },
	);
	if (!r.proposal) throw new Error(JSON.stringify(r.issues));
	return r.proposal;
}

/** The proposal with one more signature, made by ACCOUNTS[index]. */
export async function signAs(p: Proposal, index: number): Promise<Proposal> {
	const account = ACCOUNTS[index];
	if (!account) throw new Error(`no test account ${index}`);
	const s = await signProposal(p, viemSigner(account), { at: NOW });
	if (!s.signature) throw new Error(JSON.stringify(s.issues));
	return { ...p, signatures: [...p.signatures, s.signature] };
}
