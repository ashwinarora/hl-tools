/**
 * Every protocol rule set in hl-core carries a version, the date it was last
 * checked against the primary source, and links to those sources. The app's
 * /changes page and every tool's "last verified" line are generated from this
 * metadata, so there is exactly one place to bump when the protocol changes.
 */

export interface RuleSource {
	readonly label: string;
	readonly url: string;
}

export interface RuleChange {
	readonly version: string;
	/** ISO date (YYYY-MM-DD). */
	readonly date: string;
	readonly note: string;
}

export interface RuleSetMeta {
	/** Stable identifier, e.g. "precision". */
	readonly id: string;
	readonly title: string;
	/** Semver-ish version of hl-core's encoding of the rule, not of the protocol. */
	readonly version: string;
	/** ISO date the rule set was last checked against `sources`. */
	readonly verifiedAt: string;
	readonly summary: string;
	readonly sources: readonly RuleSource[];
	readonly changelog: readonly RuleChange[];
}

export const DOCS_BASE = "https://hyperliquid.gitbook.io/hyperliquid-docs";

export function docs(path: string, label: string): RuleSource {
	return { label, url: `${DOCS_BASE}/${path}` };
}

export const PYTHON_SDK: RuleSource = {
	label: "hyperliquid-python-sdk (signing.py)",
	url: "https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/signing.py",
};

export function defineRuleSet<T extends RuleSetMeta>(meta: T): T {
	return Object.freeze(meta);
}
