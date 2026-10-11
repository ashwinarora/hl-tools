/**
 * A user-signed action sent by the account's own key: what an account does
 * while it is not a multi-sig, above all the conversion that makes it one.
 *
 * Hyperliquid has no "from" field. Whoever the signature recovers to is the
 * account the action is carried out for, so a wallet that signs with another
 * key than the one meant converts another account. `signUserAction` therefore
 * always takes the account it expects and refuses a signature that recovers
 * to anyone else.
 */
import type { Address } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { fromPlain, type JsonObject } from "../json.ts";
import { type Network, networkConfig } from "../network.ts";
import { userSignedSpec } from "../rules/signing.ts";
import {
	eip712Hashes,
	type TypedDataPayload,
	userSignedTypedData,
} from "../signing.ts";
import { prepareInnerAction } from "./action.ts";
import { normaliseAddress } from "./address.ts";
import { signTyped } from "./envelope.ts";
import { recoverInnerSigner } from "./signature.ts";
import { signersString } from "./signerSet.ts";
import type {
	Hex,
	PlainObject,
	Sig,
	SignerSet,
	TypedDataSigner,
} from "./types.ts";

export interface PlainDigest {
	/** What the wallet is asked to sign; null when the action cannot be signed this way. */
	readonly typedData: TypedDataPayload | null;
	readonly digest: Hex | null;
	readonly issues: readonly Issue[];
}

/** The typed data and digest of a user-signed action sent by the account itself. */
export function plainDigest(action: PlainObject): PlainDigest {
	const type = action.type;
	const spec = typeof type === "string" ? userSignedSpec(type) : undefined;
	if (!spec) {
		return {
			typedData: null,
			digest: null,
			issues: [
				issue(
					"plain.not_user_signed",
					"error",
					`"${String(type)}" is not a user-signed action: it has no typed data an account's own wallet could sign here.`,
					{ path: "action.type" },
				),
			],
		};
	}
	const built = userSignedTypedData(fromPlain(action) as JsonObject, spec);
	if (!built.typedData)
		return { typedData: null, digest: null, issues: built.issues };
	try {
		return {
			typedData: built.typedData,
			digest: eip712Hashes(built.typedData).digest,
			issues: built.issues,
		};
	} catch (e) {
		return {
			typedData: null,
			digest: null,
			issues: [
				issue(
					"digest.failed",
					"error",
					`Could not hash the typed data: ${(e as Error).message}`,
				),
			],
		};
	}
}

export interface SignedUserAction {
	readonly signature: Sig | null;
	/** Who the signature recovers to: the account Hyperliquid would act for. */
	readonly recovered: Address | null;
	readonly digest: Hex | null;
	readonly issues: readonly Issue[];
}

/**
 * Have the account's own wallet sign a user-signed action. The signature is
 * returned only when it recovers to `expectedSigner`.
 */
export async function signUserAction(
	action: PlainObject,
	signer: TypedDataSigner,
	opts: { readonly expectedSigner: string },
): Promise<SignedUserAction> {
	const none = (
		issues: readonly Issue[],
		recovered: Address | null = null,
	): SignedUserAction => ({
		signature: null,
		recovered,
		digest: null,
		issues,
	});
	const expected = normaliseAddress(opts.expectedSigner, "expectedSigner");
	if (!expected.address) return none(expected.issues);
	const d = plainDigest(action);
	if (!d.typedData || !d.digest) return none(d.issues);
	const s = await signTyped(signer, d.typedData, "signature");
	if (!s.sig) return none(s.issues);
	const recovered = await recoverInnerSigner(d.digest, s.sig);
	/* v8 ignore start -- a freshly produced, parseable signature always recovers */
	if (!recovered) {
		return none([
			issue(
				"signature.unrecoverable",
				"error",
				"The produced signature does not recover.",
			),
		]);
	}
	/* v8 ignore stop */
	if (recovered !== expected.address) {
		return none(
			[
				issue(
					"signature.signer_mismatch",
					"error",
					`The wallet signed with ${recovered}, not with ${expected.address}. Hyperliquid would carry this out for the account that signed, so nothing was sent.`,
					{ path: "signature" },
				),
			],
			recovered,
		);
	}
	return { signature: s.sig, recovered, digest: d.digest, issues: [] };
}

/**
 * The JSON body to POST to /exchange for a user-signed action sent by the
 * account itself: the request's nonce is the action's own number.
 */
export function userActionBody(
	action: PlainObject,
	signature: Sig,
): PlainObject {
	const spec = userSignedSpec(String(action.type));
	const body: Record<string, unknown> = {
		action,
		nonce: action[spec?.nonceField ?? "nonce"],
		signature,
	};
	return body as PlainObject;
}

export interface Conversion {
	/** The canonical `convertToMultiSigUser`, or null when it cannot be built. */
	readonly action: PlainObject | null;
	readonly issues: readonly Issue[];
}

/**
 * The action that turns an account into a multi-sig (or, with `set` null,
 * back into a normal one), in the exact form that is signed: signers
 * lowercased, without duplicates, sorted.
 */
export function conversionAction(input: {
	readonly network: Network;
	/** The EIP-712 chain the wallet signs under, as hex; Hyperliquid accepts any. */
	readonly signatureChainId: string;
	readonly set: SignerSet | null;
	readonly nonce: number;
}): Conversion {
	const set = input.set
		? {
				authorizedUsers: [
					...new Set(
						input.set.authorizedUsers.map((a) => a.toLowerCase() as Address),
					),
				].sort(),
				threshold: input.set.threshold,
			}
		: null;
	const prepared = prepareInnerAction(
		{
			type: "convertToMultiSigUser",
			signatureChainId: input.signatureChainId,
			hyperliquidChain: networkConfig(input.network).hyperliquidChain,
			signers: signersString(set),
			nonce: input.nonce,
		},
		input.network,
		input.nonce,
	);
	return { action: prepared.action, issues: prepared.issues };
}
