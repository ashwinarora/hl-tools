/**
 * A half-filled form, kept in this browser so that a reload or a closed tab
 * does not lose it. Pure: what is worth keeping, how long, how many, what a
 * stored draft has to look like to be put back, and when a link wins over it.
 * The store is src/store/multisigDraftsStore.ts; nothing here leaves the
 * browser, and nothing is restored into another treasury or network (the
 * key names both).
 */
import type { Network } from "@hl-tools/core";
import { ACTION_KINDS, type ActionForm, DEFAULT_FORM } from "./actions";
import { fromNow } from "./time";

/** A draft older than this is dropped when the store is read. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** How many drafts a browser keeps at most: the newest. */
export const DRAFT_CAP = 20;
/** How long after the last keystroke a draft is written. */
export const DRAFT_SAVE_AFTER_MS = 400;
/** Longest text kept in one field (a raw action is the long one). */
const TEXT_MAX = 20_000;
const SIGNERS_MAX = 10;

/** The propose form of one treasury, or the wizard of one account. */
export type DraftKind = "propose" | "create";

export interface ProposeDraft {
	/** When it was last written. */
	readonly at: number;
	readonly form: ActionForm;
}

export interface CreateDraft {
	readonly at: number;
	/** The addresses entered as signers, as typed. */
	readonly entries: readonly string[];
	readonly threshold: number | null;
}

export type StoredDraft = ProposeDraft | CreateDraft;

/** One draft per form, network and account: never read back under another. */
export const draftKey = (
	kind: DraftKind,
	network: Network,
	address: string,
): string => `${kind}:${network}:${address.toLowerCase()}`;

const PICK: {
	readonly [K in keyof ActionForm]?: readonly ActionForm[K][];
} = {
	kind: ACTION_KINDS.map((k) => k.kind),
	fromPocket: ["auto", "perps", "spot"],
	toPocket: ["perps", "spot"],
	toPerp: ["perp", "spot"],
	toMode: ["", "unified", "manual"],
	chain: ["hyperevm", "arbitrum"],
};

/**
 * A stored form put back into shape, field by field: a field that is not
 * what the form can hold falls back to its default (what was stored may be
 * from an older version, or edited by hand). Null when it is no form at all.
 */
export function restoredForm(v: unknown): ActionForm | null {
	if (!v || typeof v !== "object" || Array.isArray(v)) return null;
	const raw = v as Record<string, unknown>;
	const out: Record<string, unknown> = { ...DEFAULT_FORM };
	for (const key of Object.keys(DEFAULT_FORM) as (keyof ActionForm)[]) {
		const value = raw[key];
		const choices = PICK[key] as readonly unknown[] | undefined;
		if (choices) {
			if (choices.includes(value)) out[key] = value;
		} else if (key === "removeAgent") {
			if (value === null || typeof value === "string")
				out[key] = typeof value === "string" ? value.slice(0, TEXT_MAX) : null;
		} else if (typeof value === "string") out[key] = value.slice(0, TEXT_MAX);
	}
	// the nonce is chosen at the moment of creating: a stored "pick a time" would be a stale one
	out.nonceMode = DEFAULT_FORM.nonceMode;
	return out as unknown as ActionForm;
}

/** Whether a form holds anything a person typed or chose (the kind alone counts). */
export function formWorthKeeping(form: ActionForm): boolean {
	return (Object.keys(DEFAULT_FORM) as (keyof ActionForm)[]).some(
		(k) => k !== "nonceMode" && form[k] !== DEFAULT_FORM[k],
	);
}

/** What a draft read from storage is, if it is one; null for anything else, or one that is too old. */
export function restoredDraft(
	key: string,
	v: unknown,
	now: number,
): StoredDraft | null {
	if (!v || typeof v !== "object" || Array.isArray(v)) return null;
	const raw = v as Record<string, unknown>;
	const at = raw.at;
	if (typeof at !== "number" || !Number.isFinite(at)) return null;
	// one written "in the future" (a clock set back since) is as old as it claims to be new
	if (now - at > DRAFT_MAX_AGE_MS || at - now > DRAFT_MAX_AGE_MS) return null;
	if (key.startsWith("propose:")) {
		const form = restoredForm(raw.form);
		return form && formWorthKeeping(form) ? { at, form } : null;
	}
	if (key.startsWith("create:")) {
		const entries = Array.isArray(raw.entries)
			? raw.entries
					.filter((e): e is string => typeof e === "string")
					.slice(0, SIGNERS_MAX)
					.map((e) => e.slice(0, 80))
			: [];
		const threshold =
			typeof raw.threshold === "number" &&
			Number.isInteger(raw.threshold) &&
			raw.threshold >= 1 &&
			raw.threshold <= entries.length
				? raw.threshold
				: null;
		return entries.length > 0 ? { at, entries, threshold } : null;
	}
	return null;
}

/** Everything read from storage, cleaned: only drafts, none too old, the newest `DRAFT_CAP`. */
export function restoredDrafts(
	v: unknown,
	now: number,
): Record<string, StoredDraft> {
	if (!v || typeof v !== "object" || Array.isArray(v)) return {};
	const kept: [string, StoredDraft][] = [];
	for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
		const draft = restoredDraft(key, value, now);
		if (draft) kept.push([key, draft]);
	}
	return capped(Object.fromEntries(kept));
}

/** The newest `DRAFT_CAP` drafts. */
export function capped(
	drafts: Readonly<Record<string, StoredDraft>>,
): Record<string, StoredDraft> {
	const entries = Object.entries(drafts);
	if (entries.length <= DRAFT_CAP) return { ...drafts };
	return Object.fromEntries(
		entries.sort((a, b) => b[1].at - a[1].at).slice(0, DRAFT_CAP),
	);
}

/** What the link that opened the propose form asks for. */
export interface ProposeLink {
	readonly kind?: string;
	readonly supersedes?: string;
	/** Remove API wallet: the wallet's name. */
	readonly agent?: string;
	/** A vault form: the vault's address. */
	readonly vault?: string;
}

/**
 * The stored form to open the propose form with, or null. A link that asks
 * for something else wins: one that re-proposes a proposal, one that names
 * another kind than the draft's, another API wallet to remove or another
 * vault. The draft
 * is left where it is; it is replaced only once something is typed.
 */
export function proposeDraftFor(
	stored: StoredDraft | null | undefined,
	link: ProposeLink,
): ProposeDraft | null {
	if (!stored || !("form" in stored)) return null;
	if (link.supersedes) return null;
	const { form } = stored;
	if (link.kind !== undefined) {
		// the Signers card's "Convert back" is Change signers with that choice made
		const asked = link.kind === "convertBack" ? "changeSigners" : link.kind;
		const same =
			asked === form.kind ||
			// the three staking forms are one entry in a link too
			(asked === "stake" &&
				(form.kind === "returnToSpot" || form.kind === "moveStake"));
		if (!same) return null;
		if (link.kind === "convertBack" && form.signers !== "null") return null;
	}
	if (link.agent !== undefined && form.removeAgent !== link.agent) return null;
	if (
		link.vault !== undefined &&
		form.vault.trim().toLowerCase() !== link.vault.trim().toLowerCase()
	)
		return null;
	return stored;
}

/** The stored wizard draft, if that is what it is. */
export function createDraftFor(
	stored: StoredDraft | null | undefined,
): CreateDraft | null {
	return stored && "entries" in stored ? stored : null;
}

/** Every sentence about drafts. Tested against the forbidden claims. */
export const DRAFT_COPY = {
	restored: (at: number, now: number) =>
		`What you had filled in here ${fromNow(at, now)} is back. This browser keeps it for a week.`,
	clear: "Clear",
} as const;
