/**
 * Signing inspection: reproduce exactly what gets hashed and signed for an
 * exchange action, and recover the signer from a signature. Never signs —
 * there is no private-key input anywhere in hl-core.
 */

import {
	type Hex,
	hashDomain,
	hashStruct,
	hashTypedData,
	keccak256,
	recoverAddress,
	type TypedDataDomain,
} from "viem";
import { canonicalizeAction } from "./canonical.ts";
import { type Issue, issue } from "./issues.ts";
import {
	getEntry,
	isIntegerLexeme,
	type JsonNode,
	type JsonObject,
	omitKeys,
} from "./json.ts";
import { bytesToHex, encodeMsgpack, hexToBytes, type Span } from "./msgpack.ts";
import {
	type Network,
	networkConfig,
	networkForHyperliquidChain,
} from "./network.ts";
import {
	L1_DOMAIN,
	L1_TYPES,
	NONCE_WINDOW,
	type SigningFamily,
	signingFamilyFor,
	USER_SIGNED_DOMAIN_NAME,
	type UserSignedSpec,
	userSignedSpec,
} from "./rules/signing.ts";

const EIP712_DOMAIN_TYPE: { name: string; type: string }[] = [
	{ name: "name", type: "string" },
	{ name: "version", type: "string" },
	{ name: "chainId", type: "uint256" },
	{ name: "verifyingContract", type: "address" },
];

export interface TypedDataPayload {
	readonly domain: {
		readonly name: string;
		readonly version: string;
		readonly chainId: number;
		readonly verifyingContract: `0x${string}`;
	};
	readonly types: Record<string, readonly { name: string; type: string }[]>;
	readonly primaryType: string;
	readonly message: Record<string, unknown>;
}

export interface HashSegment {
	readonly label: string;
	readonly start: number;
	readonly end: number;
	readonly description: string;
}

export interface L1HashBreakdown {
	readonly actionBytes: Uint8Array;
	readonly actionSpans: readonly Span[];
	readonly preimage: Uint8Array;
	readonly segments: readonly HashSegment[];
	/** keccak256(preimage) — the phantom agent's connectionId. */
	readonly connectionId: Hex;
}

function u64(n: bigint): Uint8Array {
	if (n < 0n || n >= 1n << 64n)
		throw new RangeError(`${n} does not fit in uint64`);
	const out = new Uint8Array(8);
	new DataView(out.buffer).setBigUint64(0, n, false);
	return out;
}

/**
 * keccak256(msgpack(action) ‖ nonce ‖ vaultMarker [‖ vault] [‖ 0x00 ‖ expiresAfter]).
 * Mirrors `action_hash` in the Python SDK byte for byte.
 */
export function l1ActionHash(
	action: JsonNode,
	nonce: bigint,
	vaultAddress?: string | null,
	expiresAfter?: bigint | null,
): L1HashBreakdown {
	const { bytes: actionBytes, spans } = encodeMsgpack(action);
	const parts: { label: string; bytes: Uint8Array; description: string }[] = [
		{
			label: "action",
			bytes: actionBytes,
			description: "MsgPack-encoded action (key order preserved).",
		},
		{
			label: "nonce",
			bytes: u64(nonce),
			description: "Nonce as big-endian uint64.",
		},
	];
	if (vaultAddress) {
		parts.push({
			label: "vault marker",
			bytes: new Uint8Array([1]),
			description: "0x01: a vault/sub-account address follows.",
		});
		parts.push({
			label: "vaultAddress",
			bytes: hexToBytes(vaultAddress),
			description: "20-byte vault or sub-account address.",
		});
	} else {
		parts.push({
			label: "vault marker",
			bytes: new Uint8Array([0]),
			description: "0x00: no vault address.",
		});
	}
	if (expiresAfter !== undefined && expiresAfter !== null) {
		parts.push({
			label: "expires marker",
			bytes: new Uint8Array([0]),
			description: "0x00: expiresAfter follows.",
		});
		parts.push({
			label: "expiresAfter",
			bytes: u64(expiresAfter),
			description: "expiresAfter as big-endian uint64 (ms).",
		});
	}
	const total = parts.reduce((n, p) => n + p.bytes.length, 0);
	const preimage = new Uint8Array(total);
	const segments: HashSegment[] = [];
	let offset = 0;
	for (const p of parts) {
		preimage.set(p.bytes, offset);
		segments.push({
			label: p.label,
			start: offset,
			end: offset + p.bytes.length,
			description: p.description,
		});
		offset += p.bytes.length;
	}
	return {
		actionBytes,
		actionSpans: spans,
		preimage,
		segments,
		connectionId: keccak256(preimage),
	};
}

export function l1TypedData(
	connectionId: Hex,
	network: Network,
): TypedDataPayload {
	return {
		domain: { ...L1_DOMAIN },
		types: { Agent: L1_TYPES.Agent.map((f) => ({ ...f })) },
		primaryType: "Agent",
		message: { source: networkConfig(network).l1Source, connectionId },
	};
}

export interface Eip712Hashes {
	readonly domainSeparator: Hex;
	readonly structHash: Hex;
	/** keccak256(0x1901 ‖ domainSeparator ‖ structHash) — what the wallet signs. */
	readonly digest: Hex;
}

export function eip712Hashes(td: TypedDataPayload): Eip712Hashes {
	const types = {
		...td.types,
		EIP712Domain: EIP712_DOMAIN_TYPE,
	} as Record<string, { name: string; type: string }[]>;
	const domain = td.domain as TypedDataDomain;
	return {
		domainSeparator: hashDomain({ domain, types }),
		structHash: hashStruct({
			data: td.message,
			primaryType: td.primaryType,
			types,
		}),
		digest: hashTypedData({
			domain,
			types: td.types as Record<string, { name: string; type: string }[]>,
			primaryType: td.primaryType,
			message: td.message,
		}),
	};
}

export interface ParsedSignature {
	readonly r: Hex;
	readonly s: Hex;
	readonly v: number;
	readonly yParity: 0 | 1;
	/** 65-byte r ‖ s ‖ v serialisation. */
	readonly serialized: Hex;
}

export class SignatureParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SignatureParseError";
	}
}

function pad32(hex: string, what: string): Hex {
	let h = hex.trim().toLowerCase();
	if (h.startsWith("0x")) h = h.slice(2);
	if (!/^[0-9a-f]+$/.test(h))
		throw new SignatureParseError(`${what} is not hex`);
	if (h.length > 64)
		throw new SignatureParseError(`${what} is longer than 32 bytes`);
	return `0x${h.padStart(64, "0")}`;
}

/**
 * Parse a signature given as `{r, s, v}` (the exchange request format, where
 * the Python SDK may drop leading zeros) or as a 65-byte hex string.
 */
export function parseSignature(input: unknown): ParsedSignature {
	let r: Hex;
	let s: Hex;
	let v: number;
	if (typeof input === "string") {
		const h = input.trim().toLowerCase().replace(/^0x/, "");
		if (/^[0-9a-f]{130}$/.test(h)) {
			r = `0x${h.slice(0, 64)}`;
			s = `0x${h.slice(64, 128)}`;
			v = Number.parseInt(h.slice(128), 16);
		} else if (/^[0-9a-f]{128}$/.test(h)) {
			// EIP-2098 compact: r ‖ (yParity << 255 | s)
			r = `0x${h.slice(0, 64)}`;
			const yParityAndS = BigInt(`0x${h.slice(64, 128)}`);
			const yParity = yParityAndS >> 255n;
			s = `0x${(yParityAndS & ((1n << 255n) - 1n)).toString(16).padStart(64, "0")}`;
			v = Number(yParity) + 27;
		} else {
			throw new SignatureParseError(
				"A hex signature must be 65 bytes (130 hex digits: r ‖ s ‖ v) or 64 bytes (EIP-2098 compact).",
			);
		}
	} else if (input && typeof input === "object") {
		const o = input as Record<string, unknown>;
		if (typeof o.r !== "string" || typeof o.s !== "string") {
			throw new SignatureParseError(
				'Signature object needs string "r" and "s" fields.',
			);
		}
		r = pad32(o.r, "r");
		s = pad32(o.s, "s");
		const rawV = o.v;
		if (typeof rawV === "number") v = rawV;
		else if (typeof rawV === "string")
			v = Number.parseInt(rawV, rawV.startsWith("0x") ? 16 : 10);
		else
			throw new SignatureParseError(
				'Signature object needs a "v" field (27 or 28).',
			);
	} else {
		throw new SignatureParseError(
			"Expected a {r, s, v} object or 65-byte hex string.",
		);
	}
	if (v === 0 || v === 1) v += 27;
	if (v !== 27 && v !== 28)
		throw new SignatureParseError(`v must be 27 or 28 (got ${v}).`);
	const yParity = (v - 27) as 0 | 1;
	return {
		r,
		s,
		v,
		yParity,
		serialized: `0x${r.slice(2)}${s.slice(2)}${v.toString(16).padStart(2, "0")}`,
	};
}

export async function recoverSigner(
	digest: Hex,
	signature: ParsedSignature,
): Promise<`0x${string}`> {
	const addr = await recoverAddress({
		hash: digest,
		signature: signature.serialized,
	});
	return addr.toLowerCase() as `0x${string}`;
}

function messageValue(
	node: JsonNode,
	type: string,
	path: string,
	issues: Issue[],
): unknown {
	if (type === "string") {
		if (node.kind !== "string") {
			issues.push(
				issue(
					"field.type",
					"error",
					`EIP-712 field is a string; got ${node.kind}.`,
					{ path },
				),
			);
			return node.kind === "number" ? node.raw : "";
		}
		return node.value;
	}
	if (type === "bool") {
		if (node.kind !== "bool") {
			issues.push(
				issue("field.type", "error", "EIP-712 field is a bool.", { path }),
			);
			return false;
		}
		return node.value;
	}
	if (type.startsWith("uint") || type.startsWith("int")) {
		if (node.kind !== "number" || !isIntegerLexeme(node.raw)) {
			issues.push(
				issue(
					"field.type",
					"error",
					`EIP-712 field is ${type}; expected an integer number.`,
					{ path },
				),
			);
			return 0n;
		}
		return BigInt(node.raw);
	}
	if (type === "address") {
		if (node.kind !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(node.value)) {
			issues.push(
				issue("field.type", "error", "EIP-712 field is an address.", { path }),
			);
			return "0x0000000000000000000000000000000000000000";
		}
		if (node.value !== node.value.toLowerCase()) {
			issues.push(
				issue(
					"address.uppercase",
					"warning",
					"Lower-case addresses before signing (the SDKs do).",
					{ path },
				),
			);
		}
		return node.value.toLowerCase();
	}
	if (type === "bytes" || type === "bytes32") {
		if (node.kind !== "string" || !/^0x[0-9a-fA-F]*$/.test(node.value)) {
			issues.push(
				issue(
					"field.type",
					"error",
					`EIP-712 field is ${type}; expected 0x hex.`,
					{ path },
				),
			);
			return "0x";
		}
		return node.value.toLowerCase();
	}
	issues.push(
		issue("field.type", "error", `Unsupported EIP-712 type ${type}.`, { path }),
	);
	return null;
}

export interface UserSignedBuild {
	readonly typedData: TypedDataPayload | null;
	readonly issues: readonly Issue[];
	readonly spec: UserSignedSpec;
	/** Network implied by `hyperliquidChain`. */
	readonly actionNetwork: Network | null;
}

export function userSignedTypedData(
	action: JsonObject,
	spec: UserSignedSpec,
): UserSignedBuild {
	const issues: Issue[] = [];
	const sigChain = getEntry(action, "signatureChainId");
	let chainId = 0;
	if (
		!sigChain ||
		sigChain.kind !== "string" ||
		!/^0x[0-9a-fA-F]+$/.test(sigChain.value)
	) {
		issues.push(
			issue(
				"usersigned.signatureChainId",
				"error",
				'User-signed actions need "signatureChainId" as a hex string (e.g. "0x66eee" or "0xa4b1"): it is the EIP-712 domain chainId.',
				{ path: "signatureChainId" },
			),
		);
	} else {
		chainId = Number.parseInt(sigChain.value, 16);
	}
	const hc = getEntry(action, "hyperliquidChain");
	const actionNetwork =
		hc?.kind === "string" ? networkForHyperliquidChain(hc.value) : null;
	if (!actionNetwork) {
		issues.push(
			issue(
				"usersigned.hyperliquidChain",
				"error",
				'"hyperliquidChain" must be "Mainnet" or "Testnet".',
				{
					path: "hyperliquidChain",
				},
			),
		);
	}
	const message: Record<string, unknown> = {};
	for (const field of spec.fields) {
		let node = getEntry(action, field.name);
		if (
			!node &&
			spec.actionType === "approveAgent" &&
			field.name === "agentName"
		) {
			// SDKs sign an absent agentName as the empty string (and then drop the key).
			node = { kind: "string", value: "", start: 0, end: 0 };
			issues.push(
				issue(
					"approveAgent.agentName",
					"info",
					'agentName is absent: it is signed as "" (unnamed agent), matching the SDKs.',
					{ path: "agentName" },
				),
			);
		}
		if (!node) {
			issues.push(
				issue(
					"field.missing",
					"error",
					`Missing EIP-712 field "${field.name}".`,
					{ path: field.name },
				),
			);
			continue;
		}
		message[field.name] = messageValue(node, field.type, field.name, issues);
	}
	const known = new Set([
		...spec.fields.map((f) => f.name),
		"type",
		"signatureChainId",
	]);
	for (const e of action.entries) {
		if (!known.has(e.key)) {
			issues.push(
				issue(
					"usersigned.extra",
					"warning",
					`"${e.key}" is not part of ${spec.primaryType}; it is not signed (only typed fields are).`,
					{ path: e.key },
				),
			);
		}
	}
	const complete = !issues.some(
		(i) => i.severity === "error" && i.code !== "address.uppercase",
	);
	return {
		spec,
		actionNetwork,
		issues,
		typedData: complete
			? {
					domain: {
						name: USER_SIGNED_DOMAIN_NAME,
						version: "1",
						chainId,
						verifyingContract: "0x0000000000000000000000000000000000000000",
					},
					types: { [spec.primaryType]: spec.fields.map((f) => ({ ...f })) },
					primaryType: spec.primaryType,
					message,
				}
			: null,
	};
}

export interface InspectInput {
	/** Parsed action (see parseJson). */
	readonly action: JsonNode;
	readonly nonce: bigint | null;
	readonly network: Network;
	readonly vaultAddress?: string | null;
	readonly expiresAfter?: bigint | null;
	readonly signature?: unknown;
	/** Reference time for nonce-window checks (defaults to now). */
	readonly now?: number;
}

export interface Inspection {
	readonly family: SigningFamily | "invalid";
	readonly actionType: string | null;
	readonly network: Network;
	readonly issues: readonly Issue[];
	readonly l1?: L1HashBreakdown & {
		canonicalChanged: boolean;
		canonicalKnown: boolean;
		canonical: JsonNode;
	};
	readonly userSigned?: { spec: UserSignedSpec; actionNetwork: Network | null };
	readonly typedData: TypedDataPayload | null;
	readonly hashes: Eip712Hashes | null;
	readonly signature: ParsedSignature | null;
	readonly recovered: `0x${string}` | null;
}

export async function inspectAction(input: InspectInput): Promise<Inspection> {
	const issues: Issue[] = [];
	const { action, network } = input;
	const base = {
		network,
		typedData: null,
		hashes: null,
		signature: null,
		recovered: null,
	} as const;
	if (action.kind !== "object") {
		return {
			...base,
			family: "invalid",
			actionType: null,
			issues: [
				issue(
					"action.not_object",
					"error",
					"The action must be a JSON object (paste only the `action` value, or the full request body).",
				),
			],
		};
	}
	const typeNode = getEntry(action, "type");
	if (!typeNode || typeNode.kind !== "string") {
		return {
			...base,
			family: "invalid",
			actionType: null,
			issues: [
				issue(
					"action.no_type",
					"error",
					'The action needs a string "type" field.',
					{ path: "type" },
				),
			],
		};
	}
	const actionType = typeNode.value;
	const family = signingFamilyFor(actionType);
	if (family === "multisig") {
		return {
			...base,
			family,
			actionType,
			issues: [
				issue(
					"multisig.unsupported",
					"info",
					"Multi-sig envelopes are not inspected here: use the multisig module (envelopeDigest / classifySignatures) or the Multisig Inspector. Inspect the inner action on its own instead.",
				),
			],
		};
	}

	let signature: ParsedSignature | null = null;
	if (
		input.signature !== undefined &&
		input.signature !== null &&
		input.signature !== ""
	) {
		try {
			signature = parseSignature(input.signature);
		} catch (e) {
			issues.push(
				issue("signature.invalid", "error", (e as Error).message, {
					path: "signature",
				}),
			);
		}
	}

	const now = input.now ?? Date.now();
	if (input.nonce !== null) {
		const n = Number(input.nonce);
		if (n < now - NONCE_WINDOW.pastMs || n > now + NONCE_WINDOW.futureMs) {
			issues.push(
				issue(
					"nonce.window",
					"warning",
					`Nonce ${input.nonce} is outside (now − 2 days, now + 1 day); a live submission would be rejected. Fine for reproducing old vectors.`,
					{ path: "nonce" },
				),
			);
		}
	}

	let typedData: TypedDataPayload | null = null;
	let l1: Inspection["l1"];
	let userSigned: Inspection["userSigned"];

	if (family === "l1") {
		if (input.nonce === null) {
			issues.push(
				issue(
					"nonce.missing",
					"error",
					"L1 actions hash the nonce; enter the request's nonce.",
					{ path: "nonce" },
				),
			);
		} else {
			if (
				input.vaultAddress &&
				!/^0x[0-9a-fA-F]{40}$/.test(input.vaultAddress)
			) {
				issues.push(
					issue(
						"vault.invalid",
						"error",
						"vaultAddress must be a 20-byte hex address.",
						{ path: "vaultAddress" },
					),
				);
			} else {
				if (
					input.vaultAddress &&
					input.vaultAddress !== input.vaultAddress.toLowerCase()
				) {
					issues.push(
						issue(
							"vault.uppercase",
							"info",
							"vaultAddress is hashed as raw bytes, so case doesn't matter here.",
							{
								path: "vaultAddress",
							},
						),
					);
				}
				const canon = canonicalizeAction(action);
				issues.push(...canon.issues);
				const breakdown = l1ActionHash(
					action,
					input.nonce,
					input.vaultAddress,
					input.expiresAfter,
				);
				l1 = {
					...breakdown,
					canonical: canon.canonical,
					canonicalChanged: canon.changed,
					canonicalKnown: canon.known,
				};
				typedData = l1TypedData(breakdown.connectionId, network);
			}
		}
	} else {
		const spec = userSignedSpec(actionType) as UserSignedSpec;
		if (input.vaultAddress) {
			issues.push(
				issue(
					"usersigned.vault",
					"warning",
					"User-signed actions ignore vaultAddress; it is not part of the signature.",
					{
						path: "vaultAddress",
					},
				),
			);
		}
		if (input.expiresAfter !== undefined && input.expiresAfter !== null) {
			issues.push(
				issue(
					"usersigned.expiresAfter",
					"warning",
					"User-signed actions do not support expiresAfter; it is not signed.",
					{
						path: "expiresAfter",
					},
				),
			);
		}
		const built = userSignedTypedData(action, spec);
		issues.push(...built.issues);
		userSigned = { spec, actionNetwork: built.actionNetwork };
		if (built.actionNetwork && built.actionNetwork !== network) {
			issues.push(
				issue(
					"network.mismatch",
					"error",
					`The action says hyperliquidChain "${built.actionNetwork === "mainnet" ? "Mainnet" : "Testnet"}" but the inspector is set to ${network}. The signature commits to the action's value; switch the network or fix the field.`,
					{ path: "hyperliquidChain" },
				),
			);
		}
		const nonceNode = getEntry(action, spec.nonceField);
		if (
			input.nonce !== null &&
			nonceNode?.kind === "number" &&
			BigInt(nonceNode.raw) !== input.nonce
		) {
			issues.push(
				issue(
					"nonce.mismatch",
					"error",
					`action.${spec.nonceField} (${nonceNode.raw}) must equal the outer request nonce (${input.nonce}).`,
					{ path: spec.nonceField },
				),
			);
		}
		typedData = built.typedData;
	}

	let hashes: Eip712Hashes | null = null;
	let recovered: `0x${string}` | null = null;
	if (typedData) {
		try {
			hashes = eip712Hashes(typedData);
		} catch (e) {
			issues.push(
				issue(
					"eip712.hash",
					"error",
					`Could not hash typed data: ${(e as Error).message}`,
				),
			);
		}
	}
	if (hashes && signature) {
		try {
			recovered = await recoverSigner(hashes.digest, signature);
		} catch (e) {
			issues.push(
				issue(
					"signature.recover",
					"error",
					`Signature recovery failed: ${(e as Error).message}`,
					{ path: "signature" },
				),
			);
		}
	}
	return {
		family,
		actionType,
		network,
		issues,
		l1,
		userSigned,
		typedData,
		hashes,
		signature,
		recovered,
	};
}

/**
 * Accept either a bare action or a full exchange request body
 * `{action, nonce, signature, vaultAddress?, expiresAfter?}`.
 */
export function splitRequestBody(node: JsonNode): {
	action: JsonNode;
	nonce?: bigint;
	signature?: unknown;
	vaultAddress?: string | null;
	expiresAfter?: bigint | null;
	isEnvelope: boolean;
} {
	const actionNode = getEntry(node, "action");
	if (node.kind !== "object" || !actionNode)
		return { action: node, isEnvelope: false };
	const nonceNode = getEntry(node, "nonce");
	const sigNode = getEntry(node, "signature");
	const vaultNode = getEntry(node, "vaultAddress");
	const expNode = getEntry(node, "expiresAfter");
	let signature: unknown;
	if (sigNode?.kind === "object") {
		const o: Record<string, unknown> = {};
		for (const e of sigNode.entries) {
			o[e.key] =
				e.value.kind === "string"
					? e.value.value
					: e.value.kind === "number"
						? Number(e.value.raw)
						: null;
		}
		signature = o;
	} else if (sigNode?.kind === "string") signature = sigNode.value;
	return {
		action: actionNode,
		nonce:
			nonceNode?.kind === "number" && isIntegerLexeme(nonceNode.raw)
				? BigInt(nonceNode.raw)
				: undefined,
		signature,
		vaultAddress: vaultNode?.kind === "string" ? vaultNode.value : null,
		expiresAfter:
			expNode?.kind === "number" && isIntegerLexeme(expNode.raw)
				? BigInt(expNode.raw)
				: null,
		isEnvelope: true,
	};
}

export { bytesToHex, omitKeys };
