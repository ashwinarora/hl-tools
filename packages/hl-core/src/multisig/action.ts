/**
 * Prepare an inner action for a proposal: canonicalise it the way the chain
 * re-serialises it, infer the hashing scheme, enforce the user-signed rules
 * the chain enforces (and the lab confirmed), and derive risk flags.
 */
import { canonicalizeAction } from "../canonical.ts";
import { type Issue, issue } from "../issues.ts";
import {
	fromPlain,
	getEntry,
	isIntegerLexeme,
	type JsonNode,
	type JsonObject,
	type PlainJson,
	toPlain,
} from "../json.ts";
import { type Network, networkConfig } from "../network.ts";
import {
	MULTISIG_ACTION_TYPES,
	signingFamilyFor,
	type UserSignedSpec,
	userSignedSpec,
} from "../rules/signing.ts";
import { normaliseAddress } from "./address.ts";
import { parseSignersString, signersString } from "./signerSet.ts";
import type { Kind, PlainObject, RiskFlag } from "./types.ts";

export interface PreparedAction {
	/** Canonical action, or null when an error blocks it. */
	readonly action: PlainObject | null;
	readonly kind: Kind | null;
	readonly spec: UserSignedSpec | null;
	readonly flags: readonly RiskFlag[];
	readonly issues: readonly Issue[];
}

/** Canonical issues that describe something we fixed rather than something wrong. */
const NORMALISED_CODES = new Set([
	"decimal.not_string",
	"decimal.not_canonical",
	"address.uppercase",
	"cloid.uppercase",
	"field.order",
	"field.must_omit",
]);

const FUNDS_OUT = new Set([
	"usdSend",
	"spotSend",
	"withdraw3",
	"sendAsset",
	"sendToEvmWithData",
]);
const EVM_TOUCHING = new Set(["sendToEvmWithData", "evmUserModify"]);

/** Risk flags derived from the action type (and, for convert, its content). */
export function riskFlags(action: PlainObject): RiskFlag[] {
	const flags: RiskFlag[] = [];
	const type = action.type;
	if (typeof type !== "string") return flags;
	if (type === "approveAgent") flags.push("agent_bypass");
	if (type === "convertToMultiSigUser") {
		flags.push(
			parseSignersString(action.signers).revert
				? "destructive"
				: "policy_change",
		);
	}
	if (FUNDS_OUT.has(type)) flags.push("funds_out");
	if (EVM_TOUCHING.has(type)) flags.push("evm_warning");
	return flags;
}

function toNode(input: unknown): { node: JsonNode | null; issues: Issue[] } {
	try {
		return { node: fromPlain(input), issues: [] };
	} catch (e) {
		const message = (e as Error).message;
		return {
			node: null,
			issues: [
				/Refusing float/.test(message)
					? issue(
							"action.float",
							"error",
							"The action contains a non-integer number; protocol numbers (prices, sizes, amounts) must be strings.",
							{ path: "action" },
						)
					: issue("action.invalid", "error", `Not JSON: ${message}`, {
							path: "action",
						}),
			],
		};
	}
}

function findIntegerKeys(node: JsonNode, path: string, out: string[]): void {
	if (node.kind === "object") {
		for (const e of node.entries) {
			if (isIntegerLexeme(e.key)) out.push(path ? `${path}.${e.key}` : e.key);
			findIntegerKeys(e.value, path ? `${path}.${e.key}` : e.key, out);
		}
	} else if (node.kind === "array") {
		for (const [i, item] of node.items.entries()) {
			findIntegerKeys(item, `${path}[${i}]`, out);
		}
	}
}

function hexString(value: unknown): value is string {
	return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

export interface PrepareOptions {
	/** Override the EIP-712 spec used for a user-signed type (tests, forward compatibility). */
	readonly spec?: UserSignedSpec;
}

export function prepareInnerAction(
	input: unknown,
	network: Network,
	nonce: number,
	opts: PrepareOptions = {},
): PreparedAction {
	const none = (issues: Issue[]): PreparedAction => ({
		action: null,
		kind: null,
		spec: null,
		flags: [],
		issues,
	});
	const { node, issues: nodeIssues } = toNode(input);
	if (!node) return none(nodeIssues);
	if (node.kind !== "object") {
		return none([
			issue("action.not_object", "error", "The action must be a JSON object.", {
				path: "action",
			}),
		]);
	}
	const typeNode = getEntry(node, "type");
	if (!typeNode || typeNode.kind !== "string") {
		return none([
			issue(
				"action.no_type",
				"error",
				'The action needs a string "type" field.',
				{ path: "action.type" },
			),
		]);
	}
	const type = typeNode.value;
	if (MULTISIG_ACTION_TYPES.has(type)) {
		return none([
			issue(
				"action.nested_envelope",
				"error",
				"A multiSig envelope cannot be the inner action of another envelope; propose the inner action itself.",
				{ path: "action.type" },
			),
		]);
	}
	const integerKeys: string[] = [];
	findIntegerKeys(node, "", integerKeys);
	if (integerKeys.length) {
		return none([
			issue(
				"action.integer_key",
				"error",
				`Object keys that look like integers (${integerKeys.join(", ")}) are reordered by JSON parsers, which changes the hash; they are not allowed in a proposal.`,
				{ path: "action" },
			),
		]);
	}
	const kind = signingFamilyFor(type) === "user-signed" ? "user-signed" : "l1";
	if (kind === "l1") return prepareL1(node);
	const spec =
		opts.spec?.actionType === type
			? opts.spec
			: (userSignedSpec(type) as UserSignedSpec);
	return prepareUserSigned(node, spec, network, nonce);
}

function prepareL1(node: JsonObject): PreparedAction {
	const c = canonicalizeAction(node);
	const issues: Issue[] = c.issues.map((i) =>
		NORMALISED_CODES.has(i.code) && i.severity === "error"
			? { ...i, severity: "warning", message: `Normalised: ${i.message}` }
			: i,
	);
	if (issues.some((i) => i.severity === "error")) {
		return { action: null, kind: "l1", spec: null, flags: [], issues };
	}
	const action = toPlain(c.canonical) as PlainObject;
	return { action, kind: "l1", spec: null, flags: riskFlags(action), issues };
}

function prepareUserSigned(
	node: JsonObject,
	spec: UserSignedSpec,
	network: Network,
	nonce: number,
): PreparedAction {
	const issues: Issue[] = [];
	const out: Record<string, PlainJson> = { type: spec.actionType };
	const at = (name: string) => `action.${name}`;

	const sigChain = getEntry(node, "signatureChainId");
	if (!sigChain || sigChain.kind !== "string" || !hexString(sigChain.value)) {
		issues.push(
			issue(
				"usersigned.signatureChainId",
				"error",
				'User-signed actions need "signatureChainId" as a hex string (the EIP-712 domain chainId the signers\' wallets will use).',
				{ path: at("signatureChainId") },
			),
		);
	} else {
		out.signatureChainId = sigChain.value.toLowerCase();
	}

	const expectedChain = networkConfig(network).hyperliquidChain;
	const hc = getEntry(node, "hyperliquidChain");
	if (!hc || hc.kind !== "string") {
		issues.push(
			issue(
				"usersigned.hyperliquidChain",
				"error",
				`"hyperliquidChain" must be "${expectedChain}" for ${network}.`,
				{ path: at("hyperliquidChain") },
			),
		);
	} else if (hc.value !== expectedChain) {
		issues.push(
			issue(
				"network.mismatch",
				"error",
				`"hyperliquidChain" is "${hc.value}" but the proposal is for ${network} ("${expectedChain}"); the chain answers "Mainnet and testnet require different signature."`,
				{ path: at("hyperliquidChain") },
			),
		);
	} else {
		out.hyperliquidChain = hc.value;
	}

	for (const field of spec.fields) {
		if (field.name === "hyperliquidChain") continue;
		const path = at(field.name);
		let value = getEntry(node, field.name);
		if (
			spec.actionType === "approveAgent" &&
			field.name === "agentName" &&
			(!value || value.kind === "null")
		) {
			value = { kind: "string", value: "", start: 0, end: 0 };
			issues.push(
				issue(
					"approveAgent.agentName",
					"info",
					'agentName was absent or null: it is signed and sent as "" (an unnamed, main API wallet), matching the SDKs.',
					{ path },
				),
			);
		}
		if (!value) {
			issues.push(
				issue(
					"field.missing",
					"error",
					`Missing field "${field.name}" (${field.type}).`,
					{ path },
				),
			);
			continue;
		}
		const t = field.type;
		if (t === "string") {
			if (value.kind !== "string") {
				issues.push(
					issue("field.type", "error", `"${field.name}" must be a string.`, {
						path,
					}),
				);
				continue;
			}
			out[field.name] = value.value;
		} else if (t === "address") {
			const r = normaliseAddress(
				value.kind === "string" ? value.value : null,
				path,
			);
			issues.push(...r.issues);
			if (r.address) out[field.name] = r.address;
		} else if (t === "bool") {
			if (value.kind !== "bool") {
				issues.push(
					issue(
						"field.type",
						"error",
						`"${field.name}" must be true or false.`,
						{
							path,
						},
					),
				);
				continue;
			}
			out[field.name] = value.value;
		} else if (t === "bytes" || t === "bytes32") {
			if (value.kind !== "string" || !hexString(value.value)) {
				issues.push(
					issue(
						"field.type",
						"error",
						`"${field.name}" must be a 0x hex string.`,
						{
							path,
						},
					),
				);
				continue;
			}
			out[field.name] = value.value.toLowerCase();
		} else if (/^u?int\d*$/.test(t)) {
			if (value.kind !== "number" || !isIntegerLexeme(value.raw)) {
				issues.push(
					issue(
						"field.type",
						"error",
						`"${field.name}" must be an integer number (JSON number, not a string).`,
						{ path },
					),
				);
				continue;
			}
			const big = BigInt(value.raw);
			if (big < 0n) {
				issues.push(
					issue(
						"field.type",
						"error",
						`"${field.name}" must not be negative.`,
						{
							path,
						},
					),
				);
				continue;
			}
			out[field.name] = toPlain(value);
		} else {
			issues.push(
				issue(
					"field.type",
					"error",
					`Unsupported EIP-712 type ${t} for "${field.name}".`,
					{ path },
				),
			);
		}
	}

	const nonceValue = out[spec.nonceField];
	if (nonceValue !== undefined && nonceValue !== nonce) {
		issues.push(
			issue(
				"nonce.mismatch",
				"error",
				`"${spec.nonceField}" (${String(nonceValue)}) must equal the proposal nonce (${nonce}); the chain answers "Nonce mismatch." otherwise.`,
				{ path: at(spec.nonceField) },
			),
		);
	}

	const known = new Set([
		"type",
		"signatureChainId",
		...spec.fields.map((f) => f.name),
	]);
	for (const e of node.entries) {
		if (!known.has(e.key)) {
			issues.push(
				issue(
					"usersigned.extra",
					"error",
					`"${e.key}" is not part of ${spec.primaryType}. Unsigned fields are not allowed in a proposal: what is signed must be exactly what is sent.`,
					{ path: at(e.key) },
				),
			);
		}
	}

	if (
		spec.actionType === "convertToMultiSigUser" &&
		typeof out.signers === "string"
	) {
		const parsed = parseSignersString(out.signers);
		issues.push(...parsed.issues.map((i) => ({ ...i, path: at(i.path) })));
		if (parsed.set) out.signers = signersString(parsed.set);
		else if (parsed.revert) out.signers = signersString(null);
	}

	if (issues.some((i) => i.severity === "error")) {
		return { action: null, kind: "user-signed", spec, flags: [], issues };
	}
	const action = out as PlainObject;
	return {
		action,
		kind: "user-signed",
		spec,
		flags: riskFlags(action),
		issues,
	};
}
