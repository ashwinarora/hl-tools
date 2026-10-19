/**
 * Build fixtures/outcomes/meta-<network>.json: a trimmed copy of Hyperliquid's
 * `outcomeMeta` and `outcomeTemplates`, as `outcomeName` reads them. One
 * outcome of every way of naming one (each template, "template fallback",
 * "Recurring", "Recurring Named Outcome", a plain name), every question one
 * of them belongs to, and the templates those names use. On testnet also
 * outcome 10225 ("June Fed rate change"), whose share "+102251" was the first
 * seen in a treasury's balances.
 *
 * Only public market data is copied; the deployers' addresses are left out.
 *
 *   bun packages/hl-core/scripts/record_outcomes.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	RawOutcome,
	RawOutcomeMeta,
	RawOutcomeTemplate,
	RawQuestion,
} from "../src/index.ts";

const here = new URL(".", import.meta.url).pathname;
const API = {
	mainnet: "https://api.hyperliquid.xyz/info",
	testnet: "https://api.hyperliquid-testnet.xyz/info",
} as const;
const PINNED: Record<string, number[]> = { mainnet: [], testnet: [10225] };

async function info<T>(url: string, type: string): Promise<T> {
	const r = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type }),
	});
	if (!r.ok) throw new Error(`${type}: HTTP ${r.status}`);
	return (await r.json()) as T;
}

/** How an outcome is named: a template, one of the protocol's words, or plainly. */
const kindOf = (o: RawOutcome) =>
	o.name.startsWith("template") || o.name.startsWith("Recurring")
		? o.name
		: "plain";
const templateOf = (name: string) =>
	name.startsWith("template:") ? name.slice("template:".length) : null;

for (const network of ["mainnet", "testnet"] as const) {
	const recordedAt = Date.now();
	const meta = await info<RawOutcomeMeta>(API[network], "outcomeMeta");
	const templates = await info<RawOutcomeTemplate[]>(
		API[network],
		"outcomeTemplates",
	);
	const questions = meta.questions ?? [];
	const inQuestion = (id: number) =>
		questions.find(
			(q) =>
				q.fallbackOutcome === id ||
				q.namedOutcomes.includes(id) ||
				(q.settledNamedOutcomes ?? []).includes(id),
		) ?? null;

	// one of each way of naming, a question's outcome and a standalone one apart
	const picked = new Map<number, RawOutcome>();
	const seen = new Set<string>();
	for (const o of meta.outcomes) {
		const key = `${kindOf(o)}:${inQuestion(o.outcome) ? "q" : "s"}`;
		if (seen.has(key)) continue;
		seen.add(key);
		picked.set(o.outcome, o);
	}
	for (const id of PINNED[network] ?? []) {
		const o = meta.outcomes.find((x) => x.outcome === id);
		if (o) picked.set(id, o);
	}
	const keptQuestions = new Map<number, RawQuestion>();
	for (const o of picked.values()) {
		const q = inQuestion(o.outcome);
		if (q) keptQuestions.set(q.question, q);
	}
	const usedTemplates = new Set<string>();
	for (const n of [
		...[...picked.values()].map((o) => o.name),
		...[...keptQuestions.values()].map((q) => q.name),
	]) {
		const t = templateOf(n);
		if (t) usedTemplates.add(t);
	}
	const out = {
		network,
		recordedAt,
		requests: ["outcomeMeta", "outcomeTemplates"],
		outcomeMeta: {
			outcomes: [...picked.values()].sort((a, b) => a.outcome - b.outcome),
			questions: [...keptQuestions.values()].sort(
				(a, b) => a.question - b.question,
			),
		},
		outcomeTemplates: templates.filter((t) => usedTemplates.has(t.id)),
	};
	const text = `${JSON.stringify(out, null, "\t")}\n`;
	if (/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/.test(text))
		throw new Error(`${network}: an address would be written out`);
	writeFileSync(join(here, `../fixtures/outcomes/meta-${network}.json`), text);
	console.log(
		`${network}: ${out.outcomeMeta.outcomes.length} outcomes, ${out.outcomeMeta.questions.length} questions, ${out.outcomeTemplates.length} templates`,
	);
}
