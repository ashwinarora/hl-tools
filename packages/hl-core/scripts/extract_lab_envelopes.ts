/**
 * Build fixtures/multisig/lab-envelopes.json from the testnet lab recordings
 * (labs/multisig/runs, gitignored). Only public data is copied: request
 * bodies, responses and addresses. Private keys never appear in runs/ and the
 * output is grepped for them anyway.
 *
 *   bun packages/hl-core/scripts/extract_lab_envelopes.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const RUNS = join(here, "../../../labs/multisig/runs");
const SECRETS = join(here, "../../../labs/multisig/secrets");
const OUT = join(here, "../fixtures/multisig/lab-envelopes.json");

interface Recording {
	label: string;
	time: string;
	payload: Record<string, unknown>;
	result: { httpStatus: number; body: unknown; ok: boolean; error: string | null };
}
interface Policy { authorizedUsers: string[]; threshold: number }

const roles: Record<string, string> = {};
for (const w of JSON.parse(readFileSync(join(SECRETS, "wallets.json"), "utf8")) as { role: string; address: string }[]) {
	roles[w.address.toLowerCase()] = w.role;
}
const agents = JSON.parse(readFileSync(join(SECRETS, "agents.json"), "utf8")) as Record<string, { address: string }>;
for (const [name, a] of Object.entries(agents)) roles[a.address.toLowerCase()] = name;
const extras = JSON.parse(readFileSync(join(SECRETS, "extras.json"), "utf8")) as { address: string }[];
extras.forEach((e, i) => { roles[e.address.toLowerCase()] = `extra${i}`; });

const files = readdirSync(RUNS).filter((f) => f.endsWith(".json")).sort();
const recordings: Recording[] = [];
for (const f of files) {
	const m = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z)-(\d{3})-(.+)\.json$/.exec(f);
	if (!m) continue;
	const data = JSON.parse(readFileSync(join(RUNS, f), "utf8")) as Partial<Recording>;
	if (!data.payload || !data.result) continue;
	recordings.push({ label: m[3] as string, time: `${m[1]}-${m[2]}`, payload: data.payload, result: data.result });
}

// Replay conversions in order to know the policy in force at each recording.
const policies = new Map<string, Policy | null>();
const out: unknown[] = [];
for (const r of recordings) {
	const action = r.payload.action as Record<string, unknown>;
	const type = action.type as string;
	const isMultiSig = type === "multiSig";
	const inner = isMultiSig ? ((action.payload as Record<string, unknown>).action as Record<string, unknown>) : action;
	const subject = isMultiSig
		? ((action.payload as Record<string, unknown>).multiSigUser as string).toLowerCase()
		: null;
	const policyBefore = subject ? (policies.get(subject) ?? null) : null;
	if (isMultiSig || type === "convertToMultiSigUser") {
		out.push({
			label: r.label,
			time: r.time,
			subject,
			policyBefore,
			payload: r.payload,
			result: { httpStatus: r.result.httpStatus, body: r.result.body, ok: r.result.ok, error: r.result.error },
		});
	}
	if (r.result.ok && inner.type === "convertToMultiSigUser") {
		// a direct convert acts on the signer of the request; recover it from the role map by
		// matching the recorded outcome in FINDINGS: only the treasury and signer D ever converted directly
		const target = isMultiSig ? subject : directConvertTarget(r.label);
		if (target) {
			const signers = inner.signers as string;
			// a revert is a known "normal user" state (empty set), distinct from never observed (null)
			if (signers === "null") policies.set(target, { authorizedUsers: [], threshold: 0 });
			else {
				const s = JSON.parse(signers) as Policy;
				policies.set(target, { authorizedUsers: [...new Set(s.authorizedUsers.map((a) => a.toLowerCase()))].sort(), threshold: s.threshold });
			}
		}
	}
}

function directConvertTarget(label: string): string | null {
	if (label.startsWith("D-")) return Object.keys(roles).find((a) => roles[a] === "signerD") ?? null;
	return Object.keys(roles).find((a) => roles[a] === "treasury") ?? null;
}

const text = JSON.stringify({ generatedFrom: "labs/multisig/runs (testnet, 2026-10-07)", roles, recordings: out }, null, "\t");
if (/privateKey|mnemonic/i.test(text)) throw new Error("refusing to write: secret-looking content");
writeFileSync(OUT, `${text}\n`);
console.log(`${out.length} recordings → ${OUT}`);
