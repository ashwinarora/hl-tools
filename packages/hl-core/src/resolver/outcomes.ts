/**
 * The name of a HIP-4 outcome share, as Hyperliquid's own page writes it.
 *
 * `outcomeMeta` names an outcome in one of four ways (seen on mainnet and
 * testnet, fixtures/outcomes/meta-*.json):
 *
 *  - plainly: "June Fed rate change", with sides "Change" / "No Change";
 *  - "template:<id>": the name of template <id> in `outcomeTemplates`
 *    ("{perp} above {threshold} at {time}?"), filled with the outcome's
 *    description, "perp:ZEC|threshold:1057|time:20261023-0800|…";
 *  - "template fallback": the "anything else" outcome of a question;
 *  - "Recurring": the protocol's own daily markets, described as
 *    "class:priceBinary|underlying:BTC|expiry:…|targetPrice:…", and the
 *    "Recurring Named Outcome" "index:<n>" of a "class:priceBucket" question.
 *
 * An outcome that belongs to a question (a match, an award) is read with its
 * question: "UEFA Europa League Matchday 3: Bournemouth AFC v AC Milan: Draw".
 * A side named "template:<text>" is filled the same way ("{shortNameA}").
 *
 * Every text here was written by whoever deployed the market: a screen shows
 * it through `shownLine`. Nothing here throws; what cannot be read falls back
 * to "Outcome <id>" and "side <n>".
 */
import type { OutcomeShare } from "../rules/assetIds.ts";
import type { RawOutcome, RawOutcomeMeta, RawQuestion } from "./metadata.ts";

/** One entry of `outcomeTemplates`. */
export interface RawOutcomeTemplate {
	readonly id: string;
	/** "question", or what kind of outcome it names. */
	readonly role: unknown;
	readonly name: string;
	readonly description?: string;
	readonly keywords?: readonly (readonly string[])[];
	readonly [key: string]: unknown;
}

export interface OutcomeName {
	/** The outcome, with its question in front when it has one. */
	readonly title: string;
	/** The side the share is on: "Yes", "No Change", "Hawks"… */
	readonly side: string;
	/** True when Hyperliquid's list did not name it: `title` is "Outcome <id>". */
	readonly unknown: boolean;
}

const TEMPLATE = "template:";

/** "k:v|k:v" → fields; a description that is not one gives none. */
function fields(description: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!description) return out;
	for (const part of description.split("|")) {
		const at = part.indexOf(":");
		if (at <= 0) continue;
		out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
	}
	return out;
}

/** "20261023-0800" → "2026-10-23 08:00 UTC"; anything else as it is. */
function moment(v: string): string {
	const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(v);
	return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} UTC` : v;
}

/** The text with every {key} filled; null when one of them has no value. */
function fill(text: string, values: Record<string, string>): string | null {
	let missing = false;
	const out = text.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) => {
		const v = values[key];
		if (v === undefined || v === "") {
			missing = true;
			return "";
		}
		return moment(v);
	});
	return missing ? null : out.replace(/\s+/g, " ").trim();
}

/** The name of a "Recurring" outcome or question, from its class. */
function recurring(f: Record<string, string>): string | null {
	const at = f.expiry ? moment(f.expiry) : null;
	if (f.class === "priceBinary" && f.underlying && f.targetPrice && at)
		return `${f.underlying} above ${f.targetPrice} at ${at}`;
	if (f.class === "priceBucket" && f.underlying && at)
		return `${f.underlying} at ${at}`;
	return null;
}

/** One bucket of a "priceBucket" question: "below 63250", "63250 to 65831", "65831 or above". */
function bucket(
	question: Record<string, string>,
	index: string,
): string | null {
	const [lower, upper] = (question.priceThresholds ?? "").split(",");
	if (!lower || !upper) return null;
	if (index === "0") return `below ${lower}`;
	if (index === "1") return `${lower} to ${upper}`;
	if (index === "2") return `${upper} or above`;
	return null;
}

/** A name as `outcomeMeta` writes it, read: null when it cannot be. */
function named(
	name: string,
	description: string,
	templates: ReadonlyMap<string, RawOutcomeTemplate>,
): string | null {
	const f = fields(description);
	if (name.startsWith(TEMPLATE)) {
		const t = templates.get(name.slice(TEMPLATE.length));
		return t ? fill(t.name, f) : null;
	}
	if (name === "template fallback" || name === "Recurring Fallback")
		return "Other";
	if (name === "Recurring") return recurring(f);
	if (name === "Recurring Named Outcome") return null;
	return name.trim() || null;
}

function questionOf(meta: RawOutcomeMeta, outcome: number): RawQuestion | null {
	for (const q of meta.questions ?? []) {
		if (
			q.fallbackOutcome === outcome ||
			q.namedOutcomes.includes(outcome) ||
			(q.settledNamedOutcomes ?? []).includes(outcome)
		)
			return q;
	}
	return null;
}

function sideName(o: RawOutcome, side: 0 | 1): string {
	const raw = o.sideSpecs[side]?.name;
	if (!raw) return `side ${side}`;
	if (!raw.startsWith(TEMPLATE)) return raw;
	// "template:Yes" is the word itself; "template:{shortNameA}" is filled
	return (
		fill(raw.slice(TEMPLATE.length), fields(o.description)) ?? `side ${side}`
	);
}

/**
 * The name of an outcome share from Hyperliquid's lists. `meta` and
 * `templates` are `outcomeMeta` and `outcomeTemplates`; either may be missing
 * (not read yet, or the request failed), and the name is then as much as can
 * be said.
 */
export function outcomeName(
	share: OutcomeShare,
	meta: RawOutcomeMeta | null,
	templates: readonly RawOutcomeTemplate[] | null,
): OutcomeName {
	const fallback = {
		title: `Outcome ${share.outcome}`,
		side: `side ${share.side}`,
		unknown: true,
	};
	const o = meta?.outcomes.find((x) => x.outcome === share.outcome);
	if (!meta || !o) return fallback;
	const byId = new Map((templates ?? []).map((t) => [t.id, t]));
	const q = questionOf(meta, share.outcome);
	let own = named(o.name, o.description, byId);
	if (q && o.name === "Recurring Named Outcome") {
		const index = fields(o.description).index;
		own = index === undefined ? null : bucket(fields(q.description), index);
	}
	const head = q ? named(q.name, q.description, byId) : null;
	const title = head
		? `${head}: ${own ?? `outcome ${share.outcome}`}`
		: (own ?? fallback.title);
	return {
		title,
		side: sideName(o, share.side),
		unknown: !head && !own,
	};
}
