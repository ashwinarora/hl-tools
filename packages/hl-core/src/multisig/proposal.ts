/**
 * Create and validate proposal documents. `createProposal` turns intent into a
 * canonical, digest-stamped document; `validateProposal` takes an untrusted
 * object (a file, a share link, a relay row) and either returns a Proposal
 * whose every invariant holds, or the list of reasons it does not.
 */
import { type Address, isAddress } from "../identity.ts";
import { type Issue, issue } from "../issues.ts";
import { isNetwork, type Network } from "../network.ts";
import { MIN_NONCE_MS } from "../rules/multisig.ts";
import { NONCE_WINDOW } from "../rules/signing.ts";
import { prepareInnerAction, riskFlags } from "./action.ts";
import { normaliseAddress } from "./address.ts";
import { innerDigest } from "./digest.ts";
import { normaliseSig, padSig } from "./signature.ts";
import type {
	Hex,
	Kind,
	PlainObject,
	Policy,
	Proposal,
	ProposalInput,
	ProposalMeta,
	ProposalPayload,
	ProposalSignature,
	Receipt,
	RiskFlag,
	Sig,
} from "./types.ts";

export interface NonceWindow {
	/** Earliest chain time at which the nonce is accepted (nonce − 1 day). */
	readonly validFrom: number;
	/** Chain time after which the nonce is rejected as too low (nonce + 2 days). */
	readonly validUntil: number;
}

/**
 * The chain accepts a nonce while `nonce > T − 2 days` and `nonce < T + 1 day`
 * (T = block time), so a proposal can be submitted between nonce − 1 day and
 * nonce + 2 days. Future-dating the nonce lengthens the signing window.
 */
export function nonceWindow(nonce: number): NonceWindow {
	return {
		validFrom: nonce - NONCE_WINDOW.futureMs,
		validUntil: nonce + NONCE_WINDOW.pastMs,
	};
}

export interface ProposalResult {
	readonly proposal: Proposal | null;
	readonly flags: readonly RiskFlag[];
	readonly issues: readonly Issue[];
}

const HEX32 = /^0x[0-9a-f]{64}$/;
const LOWER_ADDRESS = /^0x[0-9a-f]{40}$/;

function isSafeInt(v: unknown): v is number {
	return typeof v === "number" && Number.isSafeInteger(v);
}

/** Nonce sanity plus timing relative to `now`; timing issues are warnings for existing documents. */
function nonceIssues(
	nonce: unknown,
	now: number,
	timingSeverity: "error" | "warning",
): Issue[] {
	if (!isSafeInt(nonce) || nonce < 0) {
		return [
			issue(
				"nonce.invalid",
				"error",
				"nonce must be a non-negative safe integer (milliseconds).",
				{ path: "payload.nonce" },
			),
		];
	}
	if (nonce < MIN_NONCE_MS) {
		return [
			issue(
				"nonce.not_milliseconds",
				"error",
				`nonce ${nonce} looks like seconds; Hyperliquid nonces are millisecond timestamps.`,
				{ path: "payload.nonce" },
			),
		];
	}
	const w = nonceWindow(nonce);
	const issues: Issue[] = [];
	if (now >= w.validUntil) {
		issues.push(
			issue(
				"nonce.expired",
				timingSeverity,
				`The nonce expired at ${new Date(w.validUntil).toISOString()}; the chain rejects it as too low. Re-propose with a fresh nonce (everyone signs again).`,
				{ path: "payload.nonce" },
			),
		);
	} else if (now < w.validFrom) {
		issues.push(
			issue(
				"nonce.future",
				"warning",
				`The nonce is more than 1 day ahead: it cannot be submitted before ${new Date(w.validFrom).toISOString()} (and expires at ${new Date(w.validUntil).toISOString()}).`,
				{ path: "payload.nonce" },
			),
		);
	}
	return issues;
}

function expiresIssues(
	expiresAfter: unknown,
	nonce: number,
	kind: Kind | null,
	now: number,
	timingSeverity: "error" | "warning",
): Issue[] {
	if (expiresAfter === null) return [];
	if (!isSafeInt(expiresAfter) || expiresAfter < 0) {
		return [
			issue(
				"expires.invalid",
				"error",
				"expiresAfter must be null or a non-negative safe integer (milliseconds).",
				{ path: "payload.expiresAfter" },
			),
		];
	}
	const issues: Issue[] = [];
	if (expiresAfter <= now) {
		issues.push(
			issue(
				"expires.past",
				timingSeverity,
				`expiresAfter ${new Date(expiresAfter).toISOString()} is in the past; the chain answers "Action already expired".`,
				{ path: "payload.expiresAfter" },
			),
		);
	} else if (expiresAfter <= nonceWindow(nonce).validFrom) {
		issues.push(
			issue(
				"expires.unreachable",
				"error",
				"expiresAfter is before the nonce becomes valid: no submission time can satisfy both.",
				{ path: "payload.expiresAfter" },
			),
		);
	}
	if (kind === "user-signed") {
		issues.push(
			issue(
				"expires.user_signed_untested",
				"warning",
				"expiresAfter with a user-signed inner action is bound only through the envelope hash; the chain's handling has not been verified.",
				{ path: "payload.expiresAfter" },
			),
		);
	}
	return issues;
}

export function createProposal(
	input: ProposalInput,
	opts: { now?: number } = {},
): ProposalResult {
	const now = opts.now ?? Date.now();
	const issues: Issue[] = [];
	const fail = (): ProposalResult => ({ proposal: null, flags: [], issues });

	if (!isNetwork(input.network)) {
		issues.push(
			issue(
				"network.invalid",
				"error",
				'network must be "mainnet" or "testnet".',
				{ path: "payload.network" },
			),
		);
		return fail();
	}
	const network: Network = input.network;
	const user = normaliseAddress(input.multiSigUser, "payload.multiSigUser");
	const leader = normaliseAddress(input.outerSigner, "payload.outerSigner");
	issues.push(...user.issues, ...leader.issues);
	let vaultAddress: Address | null = null;
	if (input.vaultAddress !== undefined && input.vaultAddress !== null) {
		const v = normaliseAddress(input.vaultAddress, "payload.vaultAddress");
		issues.push(...v.issues);
		vaultAddress = v.address;
	}
	if (user.address && leader.address && user.address === leader.address) {
		issues.push(
			issue(
				"proposal.self_lead",
				"error",
				'The leader must be an authorized user, not the multi-sig account itself (the chain answers "Invalid multi-sig outer signer").',
				{ path: "payload.outerSigner" },
			),
		);
	}
	const nonce = input.nonce ?? now;
	issues.push(...nonceIssues(nonce, now, "error"));
	const prepared = prepareInnerAction(input.action, network, nonce);
	issues.push(...prepared.issues);
	const expiresAfter = input.expiresAfter ?? null;
	issues.push(
		...expiresIssues(expiresAfter, nonce, prepared.kind, now, "error"),
	);

	let createdBy: Address | null = null;
	if (input.createdBy !== undefined && input.createdBy !== null) {
		const c = normaliseAddress(input.createdBy, "meta.createdBy");
		issues.push(...c.issues);
		createdBy = c.address;
	}
	if (input.supersedes != null && !HEX32.test(input.supersedes)) {
		issues.push(
			issue(
				"meta.supersedes",
				"error",
				"supersedes must be the 32-byte digest of the proposal being replaced.",
				{ path: "meta.supersedes" },
			),
		);
	}
	const policyAtCreation = input.policyAtCreation
		? normalisePolicy(input.policyAtCreation, "meta.policyAtCreation", issues)
		: null;

	if (issues.some((i) => i.severity === "error")) return fail();
	const payload: ProposalPayload = {
		network,
		multiSigUser: user.address as Address,
		outerSigner: leader.address as Address,
		action: prepared.action as PlainObject,
		nonce,
		vaultAddress,
		expiresAfter,
	};
	const d = innerDigest(payload);
	issues.push(...d.issues);
	if (!d.digest) return fail();
	const meta: ProposalMeta = {
		kind: prepared.kind as Kind,
		title: cleanText(input.title),
		note: cleanText(input.note),
		createdBy,
		createdAt: now,
		supersedes: input.supersedes ?? null,
		policyAtCreation,
	};
	return {
		proposal: {
			v: 1,
			payload,
			digest: d.digest,
			signatures: [],
			meta,
			receipt: null,
		},
		flags: prepared.flags,
		issues,
	};
}

function cleanText(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const t = value.trim();
	return t === "" ? null : t;
}

function normalisePolicy(
	value: unknown,
	path: string,
	issues: Issue[],
): Policy | null {
	const shapeError = () =>
		issues.push(
			issue(
				"policy.shape",
				"error",
				`${path} must be {authorizedUsers, threshold, observedAt}.`,
				{ path },
			),
		);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		shapeError();
		return null;
	}
	const p = value as Record<string, unknown>;
	const users = p.authorizedUsers;
	if (
		!Array.isArray(users) ||
		!isSafeInt(p.threshold) ||
		p.threshold < 0 ||
		!isSafeInt(p.observedAt)
	) {
		shapeError();
		return null;
	}
	const addresses: Address[] = [];
	for (const [i, u] of users.entries()) {
		const r = normaliseAddress(u, `${path}.authorizedUsers[${i}]`);
		issues.push(...r.issues);
		if (r.address) addresses.push(r.address);
	}
	return {
		authorizedUsers: [...new Set(addresses)].sort(),
		threshold: p.threshold,
		observedAt: p.observedAt,
	};
}

export interface ValidationResult {
	readonly proposal: Proposal | null;
	readonly issues: readonly Issue[];
}

const PAYLOAD_KEYS = [
	"network",
	"multiSigUser",
	"outerSigner",
	"action",
	"nonce",
	"vaultAddress",
	"expiresAfter",
] as const;
const META_KEYS = new Set([
	"kind",
	"title",
	"note",
	"createdBy",
	"createdAt",
	"supersedes",
	"policyAtCreation",
]);
const TOP_KEYS = new Set([
	"v",
	"payload",
	"digest",
	"signatures",
	"meta",
	"receipt",
]);

function lowerAddress(
	value: unknown,
	path: string,
	issues: Issue[],
): Address | null {
	if (typeof value === "string" && LOWER_ADDRESS.test(value))
		return value as Address;
	issues.push(
		isAddress(value)
			? issue(
					"address.not_lowercase",
					"error",
					`${path} must be lowercase in a document (it is hashed as written).`,
					{ path },
				)
			: issue(
					"address.invalid",
					"error",
					`${path} must be a 20-byte hex address.`,
					{ path },
				),
	);
	return null;
}

function nullableText(
	value: unknown,
	path: string,
	issues: Issue[],
): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") return value;
	issues.push(
		issue("meta.type", "error", `${path} must be a string or null.`, {
			path,
		}),
	);
	return null;
}

function nullableInt(
	value: unknown,
	path: string,
	issues: Issue[],
): number | null {
	if (value === null || value === undefined) return null;
	if (isSafeInt(value)) return value;
	issues.push(
		issue("meta.type", "error", `${path} must be an integer or null.`, {
			path,
		}),
	);
	return null;
}

function documentSig(
	value: unknown,
	path: string,
	issues: Issue[],
): Sig | null {
	const r = normaliseSig(value, path);
	issues.push(...r.issues.filter((i) => i.severity === "error"));
	if (!r.sig) return null;
	const o = value as { r?: unknown; s?: unknown };
	const padded = padSig(r.sig);
	if (o.r !== padded.r || o.s !== padded.s) {
		issues.push(
			issue(
				"signature.not_document_form",
				"error",
				`${path} must carry r and s as 32-byte lowercase hex in a document (trimming happens only in the envelope).`,
				{ path },
			),
		);
		return null;
	}
	return padded;
}

/**
 * Validate an untrusted document. Every invariant is checked, the digest is
 * recomputed, and timing problems are reported as warnings (a document may be
 * historical). The returned Proposal is the input re-assembled from validated
 * parts, so unknown fields never survive.
 */
export function validateProposal(
	doc: unknown,
	opts: { now?: number } = {},
): ValidationResult {
	const now = opts.now ?? Date.now();
	const issues: Issue[] = [];
	const fail = (): ValidationResult => ({ proposal: null, issues });
	if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
		issues.push(
			issue("proposal.shape", "error", "A proposal is a JSON object."),
		);
		return fail();
	}
	const d = doc as Record<string, unknown>;
	if (d.v !== 1) {
		issues.push(
			issue(
				"proposal.version",
				"error",
				`Unsupported proposal version ${JSON.stringify(d.v)}; this build understands v1.`,
				{ path: "v" },
			),
		);
		return fail();
	}
	for (const k of Object.keys(d)) {
		if (!TOP_KEYS.has(k)) {
			issues.push(
				issue(
					"proposal.unknown_field",
					"warning",
					`Unknown top-level field "${k}" was ignored.`,
					{ path: k },
				),
			);
		}
	}
	const pl = d.payload;
	if (!pl || typeof pl !== "object" || Array.isArray(pl)) {
		issues.push(
			issue("proposal.shape", "error", "payload must be an object.", {
				path: "payload",
			}),
		);
		return fail();
	}
	const p = pl as Record<string, unknown>;
	const known = new Set<string>(PAYLOAD_KEYS);
	for (const k of Object.keys(p)) {
		if (!known.has(k)) {
			issues.push(
				issue(
					"payload.unknown_field",
					"error",
					`Unknown payload field "${k}": nothing outside the known fields may be signed.`,
					{ path: `payload.${k}` },
				),
			);
		}
	}
	for (const k of PAYLOAD_KEYS) {
		if (!(k in p)) {
			issues.push(
				issue(
					"payload.missing_field",
					"error",
					`payload.${k} is required (use null for an unset vaultAddress or expiresAfter).`,
					{ path: `payload.${k}` },
				),
			);
		}
	}
	if (!isNetwork(p.network)) {
		issues.push(
			issue(
				"network.invalid",
				"error",
				'payload.network must be "mainnet" or "testnet".',
				{ path: "payload.network" },
			),
		);
		return fail();
	}
	const network = p.network;
	const multiSigUser = lowerAddress(
		p.multiSigUser,
		"payload.multiSigUser",
		issues,
	);
	const outerSigner = lowerAddress(
		p.outerSigner,
		"payload.outerSigner",
		issues,
	);
	if (multiSigUser && outerSigner && multiSigUser === outerSigner) {
		issues.push(
			issue(
				"proposal.self_lead",
				"error",
				"outerSigner equals multiSigUser; the multi-sig account cannot lead.",
				{ path: "payload.outerSigner" },
			),
		);
	}
	const vaultAddress =
		p.vaultAddress === null || p.vaultAddress === undefined
			? null
			: lowerAddress(p.vaultAddress, "payload.vaultAddress", issues);
	issues.push(...nonceIssues(p.nonce, now, "warning"));
	const nonce = isSafeInt(p.nonce) && p.nonce >= MIN_NONCE_MS ? p.nonce : null;

	let action: PlainObject | null = null;
	let kind: Kind | null = null;
	if (nonce !== null) {
		const prepared = prepareInnerAction(p.action, network, nonce);
		issues.push(
			...prepared.issues
				.filter((i) => i.severity === "error")
				// every error prepareInnerAction emits carries a path
				.map((i) => ({ ...i, path: `payload.${i.path}` })),
		);
		if (prepared.action) {
			if (!deepEqual(prepared.action, p.action)) {
				issues.push(
					issue(
						"action.not_canonical",
						"error",
						"payload.action is not in canonical form (key order, number formats, address case or normalised fields differ); a document must carry exactly what the chain hashes.",
						{ path: "payload.action" },
					),
				);
			} else {
				action = prepared.action;
				kind = prepared.kind;
			}
		}
	}
	const expiresAfter = p.expiresAfter === undefined ? null : p.expiresAfter;
	if (nonce !== null)
		issues.push(...expiresIssues(expiresAfter, nonce, kind, now, "warning"));

	// meta
	const m = (
		d.meta && typeof d.meta === "object" && !Array.isArray(d.meta)
			? d.meta
			: null
	) as Record<string, unknown> | null;
	if (!m) {
		issues.push(
			issue("proposal.shape", "error", "meta must be an object.", {
				path: "meta",
			}),
		);
	} else {
		for (const k of Object.keys(m)) {
			if (!META_KEYS.has(k))
				issues.push(
					issue(
						"meta.unknown_field",
						"warning",
						`Unknown meta field "${k}" was dropped.`,
						{ path: `meta.${k}` },
					),
				);
		}
		if (kind && m.kind !== kind) {
			issues.push(
				issue(
					"meta.kind",
					"error",
					`meta.kind is ${JSON.stringify(m.kind)} but the action is ${kind}.`,
					{ path: "meta.kind" },
				),
			);
		}
	}
	const meta: ProposalMeta | null = m
		? {
				kind: kind ?? "l1",
				title: nullableText(m.title, "meta.title", issues),
				note: nullableText(m.note, "meta.note", issues),
				createdBy:
					m.createdBy === null || m.createdBy === undefined
						? null
						: lowerAddress(m.createdBy, "meta.createdBy", issues),
				createdAt: nullableInt(m.createdAt, "meta.createdAt", issues),
				supersedes: supersedesOf(m.supersedes, issues),
				policyAtCreation:
					m.policyAtCreation === null || m.policyAtCreation === undefined
						? null
						: normalisePolicy(
								m.policyAtCreation,
								"meta.policyAtCreation",
								issues,
							),
			}
		: null;

	// signatures
	const signatures: ProposalSignature[] = [];
	if (!Array.isArray(d.signatures)) {
		issues.push(
			issue("proposal.shape", "error", "signatures must be an array.", {
				path: "signatures",
			}),
		);
	} else {
		const seen = new Set<string>();
		for (const [i, s] of d.signatures.entries()) {
			const path = `signatures[${i}]`;
			if (!s || typeof s !== "object") {
				issues.push(
					issue("signature.invalid", "error", `${path} must be an object.`, {
						path,
					}),
				);
				continue;
			}
			const o = s as Record<string, unknown>;
			const signer = lowerAddress(o.signer, `${path}.signer`, issues);
			const sig = documentSig(o, path, issues);
			const at = nullableInt(o.at, `${path}.at`, issues);
			if (signer && seen.has(signer)) {
				issues.push(
					issue(
						"signatures.duplicate_signer",
						"error",
						`${signer} appears more than once; merge keeps one signature per signer.`,
						{ path },
					),
				);
			}
			if (signer) seen.add(signer);
			if (signer && sig) signatures.push({ ...sig, signer, at });
		}
	}

	// receipt
	let receipt: Receipt | null = null;
	if (d.receipt !== null && d.receipt !== undefined) {
		receipt = receiptOf(d.receipt, issues);
	}

	if (issues.some((i) => i.severity === "error")) return fail();
	const payload: ProposalPayload = {
		network,
		multiSigUser: multiSigUser as Address,
		outerSigner: outerSigner as Address,
		action: action as PlainObject,
		nonce: nonce as number,
		vaultAddress,
		expiresAfter: expiresAfter as number | null,
	};
	const digest = innerDigest(payload);
	issues.push(...digest.issues);
	if (!digest.digest) return fail();
	if (
		typeof d.digest !== "string" ||
		d.digest.toLowerCase() !== digest.digest
	) {
		issues.push(
			issue(
				"proposal.digest_mismatch",
				"error",
				`The document says digest ${String(d.digest)} but the payload hashes to ${digest.digest}; the document was altered or produced with different hashing rules.`,
				{ path: "digest" },
			),
		);
		return fail();
	}
	return {
		proposal: {
			v: 1,
			payload,
			digest: digest.digest,
			signatures,
			meta: meta as ProposalMeta,
			receipt,
		},
		issues,
	};
}

function supersedesOf(value: unknown, issues: Issue[]): Hex | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" && HEX32.test(value.toLowerCase()))
		return value.toLowerCase() as Hex;
	issues.push(
		issue(
			"meta.supersedes",
			"error",
			"supersedes must be a 32-byte digest or null.",
			{ path: "meta.supersedes" },
		),
	);
	return null;
}

function receiptOf(value: unknown, issues: Issue[]): Receipt | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		issues.push(
			issue("receipt.shape", "error", "receipt must be an object or null.", {
				path: "receipt",
			}),
		);
		return null;
	}
	const r = value as Record<string, unknown>;
	const before = issues.length;
	const submittedAt = nullableInt(r.submittedAt, "receipt.submittedAt", issues);
	if (submittedAt === null)
		issues.push(
			issue("receipt.shape", "error", "receipt.submittedAt is required.", {
				path: "receipt.submittedAt",
			}),
		);
	if (
		typeof r.signatureChainId !== "string" ||
		!/^0x[0-9a-f]+$/.test(r.signatureChainId)
	) {
		issues.push(
			issue(
				"receipt.shape",
				"error",
				"receipt.signatureChainId must be lowercase hex.",
				{ path: "receipt.signatureChainId" },
			),
		);
	}
	const outer = documentSig(r.outerSignature, "receipt.outerSignature", issues);
	if (!isSafeInt(r.httpStatus))
		issues.push(
			issue(
				"receipt.shape",
				"error",
				"receipt.httpStatus must be an integer.",
				{
					path: "receipt.httpStatus",
				},
			),
		);
	if (r.response === undefined)
		issues.push(
			issue(
				"receipt.shape",
				"error",
				"receipt.response is required (use null).",
				{ path: "receipt.response" },
			),
		);
	if (issues.length > before || !outer) return null;
	return {
		submittedAt: submittedAt as number,
		signatureChainId: r.signatureChainId as Hex,
		outerSignature: outer,
		httpStatus: r.httpStatus as number,
		response: r.response as Receipt["response"],
	};
}

/** Structural equality for plain JSON (bigint-aware, key order sensitive for objects). */
export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a)) {
		const bb = b as unknown[];
		return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
	}
	const ka = Object.keys(a as object);
	const kb = Object.keys(b as object);
	if (ka.length !== kb.length) return false;
	return ka.every(
		(k, i) =>
			k === kb[i] &&
			deepEqual(
				(a as Record<string, unknown>)[k],
				(b as Record<string, unknown>)[k],
			),
	);
}

/** Risk flags of an existing proposal (derived, never stored). */
export function proposalFlags(p: Proposal): RiskFlag[] {
	return riskFlags(p.payload.action);
}
