/**
 * The testnet lab, replayed offline. fixtures/multisig/lab-envelopes.json holds
 * 124 real requests (and the chain's answers) recorded on 2026-10-07. For each
 * one the module must: parse the envelope, recover every signer to a known lab
 * wallet (unless the recording deliberately diverged), predict the chain's
 * threshold/signer verdict from the policy in force, explain the error, and
 * name the injected divergence.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Address } from "../../src/identity.ts";
import {
	classifySignatures,
	type DiagnosisCause,
	diagnoseSignature,
	type EnvelopeRequest,
	envelopeDigest,
	explainExchangeError,
	innerDigest,
	NONCE_WINDOW,
	type Policy,
	type Proposal,
	parseEnvelope,
	readiness,
	recoverInnerSigner,
	signingFamilyFor,
} from "../../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(
	join(here, "..", "..", "fixtures", "multisig", "lab-envelopes.json"),
	"utf8",
);
const fixture = JSON.parse(text) as {
	roles: Record<string, string>;
	recordings: {
		label: string;
		time: string;
		subject: string | null;
		policyBefore: { authorizedUsers: string[]; threshold: number } | null;
		payload: Record<string, unknown>;
		result: {
			httpStatus: number;
			body: unknown;
			ok: boolean;
			error: string | null;
		};
	}[];
};
const roles = fixture.roles;
const roleOf = (a: string | null) =>
	a ? (roles[a.toLowerCase()] ?? a) : "none";
const byRole = (role: string) =>
	Object.keys(roles).find((a) => roles[a] === role) as Address;
const multisigRecordings = fixture.recordings.filter(
	(r) => (r.payload.action as { type: string }).type === "multiSig",
);

/** Inner signatures made over different bytes than the envelope carries (by design). */
const DIVERGENT: Record<
	string,
	{ index: number; claimed: string; cause: DiagnosisCause }
> = {
	"neg-B-signed-different-nonce": {
		index: 1,
		claimed: "signerB",
		cause: "other-nonce",
	},
	"neg-B-signed-different-action": {
		index: 1,
		claimed: "signerB",
		cause: "unknown",
	},
	"neg-B-signed-for-lead-C": {
		index: 1,
		claimed: "signerB",
		cause: "other-leader",
	},
	"neg-B-signed-other-multisig-user": {
		index: 1,
		claimed: "signerB",
		cause: "unknown",
	},
	"neg-inner-sigs-mainnet-domain": {
		index: 0,
		claimed: "signerA",
		cause: "other-network",
	},
	"neg-userSigned-B-signed-different-amount": {
		index: 1,
		claimed: "signerB",
		cause: "unknown",
	},
	"vault-inner-sigs-omit-vault": {
		index: 0,
		claimed: "signerA",
		cause: "vault-omitted",
	},
	"expires-inner-sigs-omit-expiresAfter": {
		index: 0,
		claimed: "signerA",
		cause: "expires-omitted",
	},
	"nested-pass-D-envelope-sig-as-inner": {
		index: 1,
		claimed: "signerD",
		cause: "unknown",
	},
};
/** Chain errors the module cannot know offline (volume gates, balances, agent funding). */
const UNMODELLED =
	/^(Cannot set scheduled cancel|Cannot create sub-accounts|Insufficient balance to create vault)/;
const EXPECTED_ID: Record<string, string> = {
	"Multi-sig required": "multisig-required",
	"Multi-sig threshold not met": "multisig-threshold",
	"Invalid multi-sig inner signer": "multisig-inner-signer",
	"Invalid multi-sig outer signer": "multisig-outer-signer",
	"Multi-sig outer signer must be an L1 user.": "multisig-leader-not-user",
	"Invalid multi-sig user": "multisig-not-multisig",
	"Invalid multi-sig threshold": "multisig-threshold-invalid",
	"Multi-sig authorized user must exist on L1": "multisig-signer-missing",
	"Cannot register self as multi-sig authorized user": "multisig-self",
	"Too many multi-sig signers": "multisig-too-many",
	"Nonce mismatch.": "nonce-mismatch",
	"Action already expired": "expired",
	"Mainnet and testnet require different signature.": "network-signature",
	"Unexpected error (code=148)": "revert-shape",
	"Failed to deserialize the JSON body into the target type": "deserialize",
};

function proposalFor(req: EnvelopeRequest): Proposal {
	const payload = {
		network: "testnet" as const,
		multiSigUser: req.action.payload.multiSigUser,
		outerSigner: req.action.payload.outerSigner,
		action: req.action.payload.action,
		nonce: req.nonce,
		vaultAddress: req.vaultAddress,
		expiresAfter: req.expiresAfter,
	};
	const digest = innerDigest(payload).digest;
	if (!digest) throw new Error("lab payload cannot be hashed");
	return {
		v: 1,
		payload,
		digest,
		signatures: req.action.signatures.map((s) => ({
			...s,
			signer: "0x0000000000000000000000000000000000000000" as Address,
			at: null,
		})),
		meta: {
			kind:
				signingFamilyFor(String(req.action.payload.action.type)) ===
				"user-signed"
					? "user-signed"
					: "l1",
			title: null,
			note: null,
			createdBy: null,
			createdAt: null,
			supersedes: null,
			policyAtCreation: null,
		},
		receipt: null,
	};
}

describe("lab fixture", () => {
	it("contains 124 recordings, no secrets, and every expected scenario", () => {
		expect(fixture.recordings.length).toBe(124);
		expect(text).not.toMatch(/privateKey|mnemonic/i);
		for (const label of [
			...Object.keys(DIVERGENT),
			"ms-order-resting",
			"ms-usdSend-5",
			"rot-10-signers-threshold-10",
			"funded-agentA-leads-sigs-AB",
			"revert-json-null",
			"untrimmed-leading-zero-r-or-s",
			"checksummed-multiSigUser-in-payload",
		]) {
			expect(
				fixture.recordings.some((r) => r.label === label),
				label,
			).toBe(true);
		}
	});
});

describe("lab: every multiSig envelope", () => {
	for (const rec of multisigRecordings) {
		it(`${rec.label} (${rec.result.ok ? "ok" : rec.result.error})`, async () => {
			const parsed = parseEnvelope(rec.payload);
			expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
			const req = parsed.request as EnvelopeRequest;
			const outerSig = parsed.outerSignature;
			expect(outerSig).not.toBeNull();

			// The envelope signature recovers to the named leader, except where the lab deliberately broke it.
			const outer = envelopeDigest(req, "testnet");
			const recoveredOuter = await recoverInnerSigner(
				outer.digest as `0x${string}`,
				outerSig as never,
			);
			const OUTER_BY_OTHER: Record<string, string> = {
				"neg-outer-signed-by-B-field-says-A": "signerB",
				"agentA-signs-outer-field-says-A-sigs-AB": "agentA",
				"mainAgent-signs-outer-field-A-sigs-AB": "signerAMain",
			};
			if (OUTER_BY_OTHER[rec.label]) {
				expect(roleOf(recoveredOuter)).toBe(OUTER_BY_OTHER[rec.label]);
				expect(rec.result.error).toBe("Invalid multi-sig outer signer");
			} else if (rec.label === "untrimmed-leading-zero-r-or-s") {
				// the lab sent an untrimmed inner signature; the recorded outer signature was made over
				// those untrimmed bytes, so against the (trimmed) canonical envelope it does not recover
				expect(parsed.issues.some((i) => i.code === "envelope.untrimmed")).toBe(
					true,
				);
				expect(recoveredOuter).not.toBe(req.action.payload.outerSigner);
				expect(rec.result.error).toBe("Invalid multi-sig outer signer");
			} else {
				expect(recoveredOuter, "outer signer").toBe(
					req.action.payload.outerSigner,
				);
			}

			// Inner signatures recover to known lab wallets unless the recording diverged on purpose.
			const p = proposalFor(req);
			const digest = p.digest;
			const divergent = DIVERGENT[rec.label];
			const recovered: (string | null)[] = [];
			for (const [i, s] of req.action.signatures.entries()) {
				const r = await recoverInnerSigner(digest, s);
				recovered.push(r);
				const expectKnown = !(
					divergent &&
					(divergent.index === i || divergent.index === 0)
				);
				if (expectKnown) expect(roles[r ?? ""], `inner[${i}]`).toBeDefined();
			}

			// Readiness against the policy in force predicts threshold/signer verdicts.
			const policyBefore = rec.policyBefore;
			const policy: Policy | null = policyBefore
				? {
						authorizedUsers: policyBefore.authorizedUsers as Address[],
						threshold: policyBefore.threshold,
						observedAt: req.nonce,
					}
				: null;
			const withSigners = {
				...p,
				signatures: p.signatures.map((s, i) => ({
					...s,
					signer: (recovered[i] ?? s.signer) as Address,
				})),
			};
			const classified = await classifySignatures(withSigners, policy);
			const ready = readiness(withSigners, policy, classified, {
				now: req.nonce,
			});
			const explanation = explainExchangeError(
				rec.result.body,
				rec.result.httpStatus,
			);
			if (rec.result.ok) {
				expect(explanation.id).toBe("ok");
				expect(
					ready.status,
					"a recording the chain accepted must be ready",
				).toBe("ready");
			} else {
				const error = rec.result.error ?? "";
				if (
					!UNMODELLED.test(error) &&
					!/^Vault not registered/.test(error) &&
					!/^Must deposit/.test(error) &&
					!/^Invalid nonce/.test(error)
				) {
					expect(explanation.id, error).toBe(
						EXPECTED_ID[error.split(":")[0] as string] ?? EXPECTED_ID[error],
					);
				}
				if (
					explanation.id === "multisig-threshold" ||
					explanation.id === "multisig-inner-signer"
				) {
					expect(ready.status, "the module must predict the rejection").toBe(
						"not-ready",
					);
					expect(ready.have).toBeLessThan(
						ready.need ?? Number.POSITIVE_INFINITY,
					);
				}
				if (explanation.id === "multisig-not-multisig")
					expect(ready.status).toBe("not-multisig");
				// The bounds in the message are chain time − 2 days (too low) and chain time + 1 day (too high).
				if (explanation.id === "nonce-low") {
					const chainNow =
						Number(explanation.details.minimum) + NONCE_WINDOW.pastMs;
					expect(
						readiness(withSigners, policy, classified, { now: chainNow })
							.status,
					).toBe("expired");
				}
				if (explanation.id === "nonce-high") {
					const chainNow =
						Number(explanation.details.maximum) - NONCE_WINDOW.futureMs;
					expect(
						readiness(withSigners, policy, classified, { now: chainNow })
							.status,
					).toBe("not-yet-valid");
				}
			}

			// The injected divergence is named.
			if (divergent) {
				const sig = {
					...req.action.signatures[divergent.index],
					signer: byRole(divergent.claimed),
					at: null,
				} as Proposal["signatures"][number];
				const d = await diagnoseSignature(sig, p, policy);
				expect(d.cause, `diagnosis for ${rec.label}`).toBe(divergent.cause);
			}
		});
	}
});

describe("lab: direct convertToMultiSigUser requests", () => {
	const direct = fixture.recordings.filter(
		(r) =>
			(r.payload.action as { type: string }).type === "convertToMultiSigUser",
	);
	it("every recorded error maps to a catalogue entry", () => {
		expect(direct.length).toBeGreaterThan(10);
		for (const rec of direct) {
			const e = explainExchangeError(rec.result.body, rec.result.httpStatus);
			if (rec.result.ok) expect(e.id).toBe("ok");
			else expect(e.id, rec.label).toBe(EXPECTED_ID[rec.result.error ?? ""]);
		}
	});
	it("the duplicate-signer conversion was accepted and deduplicated by the chain", () => {
		const dup = fixture.recordings.find(
			(r) => r.label === "convert-duplicate-signer",
		);
		expect(dup?.result.ok).toBe(true);
		const next = fixture.recordings.find(
			(r) => r.label === "convert-self-as-signer",
		);
		expect(next?.result.error).toBe("Multi-sig required");
	});
});

describe("lab: notable recordings", () => {
	const rec = (label: string) =>
		fixture.recordings.find(
			(r) => r.label === label,
		) as (typeof fixture.recordings)[number];
	it("checksummed-multiSigUser-in-payload: the lab lowercased before sending, so the recording is already canonical", () => {
		const r = rec("checksummed-multiSigUser-in-payload");
		const parsed = parseEnvelope(r.payload);
		expect(parsed.issues).toEqual([]);
		expect(
			(parsed.request as EnvelopeRequest).action.payload.multiSigUser,
		).toMatch(/^0x[0-9a-f]{40}$/);
		expect(r.result.ok).toBe(true);
	});
	it("outer-signatureChainId-0x1 and the mainnet id were accepted on testnet", () => {
		expect(rec("outer-signatureChainId-0x1").result.ok).toBe(true);
		expect(rec("neg-outer-signatureChainId-mainnet-arb").result.ok).toBe(true);
		expect(
			(
				parseEnvelope(rec("outer-signatureChainId-0x1").payload)
					.request as EnvelopeRequest
			).action.signatureChainId,
		).toBe("0x1");
	});
	it("funded agent led successfully; the same agent unfunded could not", () => {
		expect(rec("funded-agentA-leads-sigs-AB").result.ok).toBe(true);
		expect(rec("agentA-leads-outerSigner-agent-sigs-AB").result.error).toBe(
			"Multi-sig outer signer must be an L1 user.",
		);
		const req = parseEnvelope(rec("funded-agentA-leads-sigs-AB").payload)
			.request as EnvelopeRequest;
		expect(roleOf(req.action.payload.outerSigner)).toBe("agentA");
	});
	it("a replayed envelope is a duplicate nonce; another leader may reuse the nonce", () => {
		expect(
			explainExchangeError(
				rec("neg-replay-exact-same-envelope").result.body,
				200,
			).id,
		).toBe("nonce-duplicate");
		expect(rec("leadB-reuses-leadA-nonce").result.ok).toBe(true);
	});
	it("revert needs the literal 'null'; empty lists are rejected", () => {
		expect(rec("revert-json-null").result.ok).toBe(true);
		expect(rec("revert-empty-list-threshold-0").result.error).toBe(
			"Invalid multi-sig threshold",
		);
		expect(rec("revert-missing-signers-field").result.error).toBe(
			"Unexpected error (code=148)",
		);
		expect(rec("ms-envelope-against-normal-user").result.error).toBe(
			"Invalid multi-sig user",
		);
	});
});
