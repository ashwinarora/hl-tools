/**
 * Choosing who signs for a treasury and how many of them must: for the first
 * conversion of an account and for a later change of signers. Pure: the page
 * looks each address up and passes in what Hyperliquid said.
 *
 * Three levels and nothing else, as decided for these screens:
 *   blocked  Hyperliquid itself would refuse it (measured:
 *            fixtures/multisig/plain-convert.json). The button is off and the
 *            reason stands beside it.
 *   warning  allowed, but risky or surprising. One line, no click.
 *   shown    a plain fact.
 * The chain's rules are the core's (`validateSignerSet`); this module gives
 * each of its findings a level and a sentence a newcomer can read.
 */
import {
	type Address,
	checksumMismatch,
	nonceWindow,
	type Policy,
	type Proposal,
	type SignerSet,
	validateSignerSet,
} from "@hl-tools/core";
import { ADDRESS_RE } from "#/components/tools/multisig/model";
import { joinParts, type Part, part, say } from "./parts";
import { countedSigners } from "./relay/assemble";
import { refusedForGood, shortAddress } from "./stage";

/** At most this many signers (the core's `MAX_SIGNERS`, restated for the screens). */
export const SIGNERS_MAX = 10;

export type Level = "blocked" | "warning" | "shown";

export interface Line {
	readonly level: Level;
	readonly code: string;
	readonly text: string;
}

const line = (level: Level, code: string, text: string): Line => ({
	level,
	code,
	text,
});
const worst = (lines: readonly Line[]): Level | "ok" =>
	lines.some((l) => l.level === "blocked")
		? "blocked"
		: lines.some((l) => l.level === "warning")
			? "warning"
			: "ok";

// ---------------------------------------------------------------- pasting

export interface Pasted {
	/** Addresses found, as typed, each once. */
	readonly addresses: readonly string[];
	/** What was there and is not an address. */
	readonly rejected: readonly string[];
}

/** One address or many, separated by anything a chat or a spreadsheet puts between them. */
export function parsePasted(text: string): Pasted {
	const addresses: string[] = [];
	const rejected: string[] = [];
	const seen = new Set<string>();
	for (const raw of text.split(/[\s,;|]+/)) {
		const token = raw.replace(/^[("'[<]+|[)"'\]>.:]+$/g, "");
		if (!token) continue;
		if (!ADDRESS_RE.test(token)) {
			rejected.push(token);
			continue;
		}
		const key = token.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		addresses.push(token);
	}
	return { addresses, rejected };
}

export interface Added {
	/** The list afterwards, as typed. */
	readonly entries: readonly string[];
	/** Already in the list: an address is a signer once. */
	readonly duplicates: number;
	/** Left out because the list was full. */
	readonly overMax: number;
}

/** Put pasted addresses into the list: no address twice, never more than ten. */
export function addEntries(
	entries: readonly string[],
	pasted: readonly string[],
): Added {
	const out = [...entries];
	const have = new Set(out.map((e) => e.toLowerCase()));
	let duplicates = 0;
	let overMax = 0;
	for (const a of pasted) {
		const key = a.toLowerCase();
		if (have.has(key)) {
			duplicates += 1;
			continue;
		}
		if (out.length >= SIGNERS_MAX) {
			overMax += 1;
			continue;
		}
		have.add(key);
		out.push(a);
	}
	return { entries: out, duplicates, overMax };
}

// ---------------------------------------------------------------- one address

/**
 * What Hyperliquid said about an address someone wants as a signer.
 *   loading  being asked
 *   failed   could not be asked: nothing is known, nothing is claimed
 *   ready    `role` and `multiSig` hold the answers
 */
export interface SignerCheck {
	readonly state: "loading" | "failed" | "ready";
	/** `userRole`: `missing` is an address that never received anything. */
	readonly role?:
		| "user"
		| "missing"
		| "agent"
		| "vault"
		| "subAccount"
		| "unknown";
	/** For an API wallet: the account it acts for. */
	readonly agentOf?: string | null;
	/** Its own signer set when it is itself a multi-sig; null when it is not. */
	readonly multiSig?: {
		readonly threshold: number;
		readonly signers: number;
	} | null;
}

/** Read `userRole` and `userToMultiSigSigners` answers into a check. Never throws. */
export function signerCheck(role: unknown, policy: unknown): SignerCheck {
	const r =
		role && typeof role === "object"
			? (role as { role?: unknown; data?: { user?: unknown } })
			: {};
	const p =
		policy && typeof policy === "object"
			? (policy as { authorizedUsers?: unknown; threshold?: unknown })
			: null;
	const known = ["user", "missing", "agent", "vault", "subAccount"] as const;
	return {
		state: "ready",
		role: (known as readonly unknown[]).includes(r.role)
			? (r.role as (typeof known)[number])
			: "unknown",
		agentOf: typeof r.data?.user === "string" ? r.data.user : null,
		multiSig:
			p && Array.isArray(p.authorizedUsers) && typeof p.threshold === "number"
				? { threshold: p.threshold, signers: p.authorizedUsers.length }
				: null,
	};
}

export interface SignerRow {
	/** Lowercased. */
	readonly address: Address;
	/**
	 * kept     a signer now and afterwards
	 * added    not a signer now (in the first conversion: every row)
	 * removed  a signer now, not afterwards
	 */
	readonly kind: "kept" | "added" | "removed";
	/** The worst of its lines; `pending` while Hyperliquid is still being asked. */
	readonly level: Level | "ok" | "pending";
	/** What to say on the row, worst first. Empty for a signer that simply stays. */
	readonly lines: readonly Line[];
	/** Asking again can change the answer (never used, or the look-up failed). */
	readonly recheck: boolean;
}

function addedLines(
	typed: string,
	address: Address,
	self: Address,
	check: SignerCheck | undefined,
): { lines: Line[]; pending: boolean; recheck: boolean } {
	const lines: Line[] = [];
	let recheck = false;
	if (address === self) {
		lines.push(
			line(
				"blocked",
				"signer.self",
				"This is the account being converted. An account cannot be its own signer.",
			),
		);
	}
	if (checksumMismatch(typed)) {
		lines.push(
			line(
				"warning",
				"signer.checksum",
				"The capital letters do not match this address's checksum. Check it for a typo.",
			),
		);
	}
	if (address === self) return { lines, pending: false, recheck };
	if (!check || check.state === "loading")
		return { lines, pending: true, recheck };
	if (check.state === "failed") {
		lines.push(
			line(
				"warning",
				"signer.unchecked",
				"Could not be checked on Hyperliquid. If this address has never been used there, the change will be refused.",
			),
		);
		return { lines, pending: false, recheck: true };
	}
	switch (check.role) {
		case "missing":
			recheck = true;
			lines.push(
				line(
					"blocked",
					"signer.missing",
					"Never used on Hyperliquid. It has to receive something first.",
				),
			);
			break;
		case "vault":
		case "subAccount":
			lines.push(
				line(
					"blocked",
					"signer.kind",
					`This is a ${check.role === "vault" ? "vault" : "sub-account"}. It has no key of its own, and Hyperliquid refuses it as a signer.`,
				),
			);
			break;
		case "agent":
			lines.push(
				line(
					"warning",
					"signer.agent",
					`This is an API wallet${check.agentOf ? ` of ${shortAddress(check.agentOf)}` : ""}. Hyperliquid takes it as a signer only if the address has received funds itself.`,
				),
			);
			break;
		case "unknown":
			lines.push(
				line(
					"warning",
					"signer.unchecked",
					"Hyperliquid's answer about this address could not be read.",
				),
			);
			break;
		default:
			break;
	}
	if (check.multiSig) {
		lines.push(
			line(
				"warning",
				"signer.nested",
				`Itself a multi-sig (${check.multiSig.threshold} of ${check.multiSig.signers}). Its own key signs here, not its signers.`,
			),
		);
	}
	// said also next to a warning (a checksum, a nested multi-sig): the reader
	// should see that the address was looked up and what came back
	if (check.role === "user")
		lines.push(line("shown", "signer.ok", "In use on Hyperliquid."));
	return { lines, pending: false, recheck };
}

const ORDER: Record<Level, number> = { blocked: 0, warning: 1, shown: 2 };

/**
 * The rows of the signer list. `entries` is the list wanted, as typed;
 * `current` the signers now (null for an account that is not a multi-sig
 * yet). A signer who simply stays is not looked up: it is one already.
 */
export function signerRows(input: {
	readonly entries: readonly string[];
	readonly self: string;
	readonly checks: ReadonlyMap<string, SignerCheck>;
	readonly current?: readonly Address[] | null;
}): SignerRow[] {
	const self = input.self.toLowerCase() as Address;
	const now = new Set(input.current ?? []);
	const rows: SignerRow[] = [];
	const wanted = new Set<string>();
	for (const typed of input.entries) {
		const address = typed.toLowerCase() as Address;
		wanted.add(address);
		if (now.has(address)) {
			rows.push({
				address,
				kind: "kept",
				level: "ok",
				lines: [],
				recheck: false,
			});
			continue;
		}
		const a = addedLines(typed, address, self, input.checks.get(address));
		const lines = [...a.lines].sort((x, y) => ORDER[x.level] - ORDER[y.level]);
		const level = worst(lines);
		rows.push({
			address,
			kind: "added",
			level: level === "ok" && a.pending ? "pending" : level,
			lines,
			recheck: a.recheck,
		});
	}
	for (const address of input.current ?? []) {
		if (wanted.has(address)) continue;
		rows.push({
			address,
			kind: "removed",
			level: "ok",
			lines: [line("shown", "signer.removed", "Will be removed.")],
			recheck: false,
		});
	}
	return rows;
}

/** The addresses that have to be looked up: the ones that would be new signers. */
export function toLookUp(
	entries: readonly string[],
	self: string,
	current?: readonly Address[] | null,
): Address[] {
	const now = new Set(current ?? []);
	const me = self.toLowerCase();
	const out: Address[] = [];
	for (const typed of entries) {
		const a = typed.toLowerCase() as Address;
		if (a === me || now.has(a) || out.includes(a)) continue;
		out.push(a);
	}
	return out;
}

// ---------------------------------------------------------------- the set as a whole

/**
 * What each finding of the core's `validateSignerSet` becomes here.
 *   row   said on the address's own row (`signerRows`), not again for the set
 *   form  a rule of the form, not of Hyperliquid (it would take an unchanged set)
 *   none  not said: this screen gives the core everything it needs to know
 */
export const SET_CODE: Readonly<
	Record<string, Level | "row" | "form" | "none">
> = {
	"signers.empty": "blocked",
	"signers.too_many": "blocked",
	"signers.threshold": "blocked",
	"signers.self": "row",
	"signers.nonexistent": "row",
	"signers.existence_unknown": "row",
	"signers.existence_unchecked": "none",
	"signers.nested": "row",
	"signers.noop": "form",
	"lockout.all_keys_required": "warning",
	"lockout.leader_removed": "shown",
	"lockout.all_current_removed": "warning",
	"lockout.unreachable": "warning",
};

const SET_TEXT: Readonly<Record<string, string>> = {
	"signers.empty": "Add at least one signer.",
	"signers.too_many": `A treasury has at most ${SIGNERS_MAX} signers.`,
	"signers.threshold": "Choose how many must sign.",
	"lockout.all_keys_required":
		"One lost key locks the account for good. Hyperliquid has no recovery.",
	"lockout.leader_removed":
		"The signer who will submit this proposal is removed by it. They can still submit it.",
	"lockout.all_current_removed":
		"None of the current signers remain. This hands the treasury over.",
	"lockout.unreachable":
		"With the keys known to be lost, too few signers remain to act.",
};

export interface SetJudgement {
	/** Lines about the set as a whole, worst first. */
	readonly lines: readonly Line[];
	/** The first reason the button is off, or null. */
	readonly blockedBy: string | null;
	/** The list and the number are what they are now: nothing to propose. */
	readonly unchanged: boolean;
	/** Hyperliquid is still being asked about a signer. */
	readonly pending: boolean;
}

/**
 * Judge the wanted set: the chain's rules through the core, the rows' own
 * blocks, and for a change of signers who is taken out. `threshold` null means
 * no number was chosen yet.
 */
export function judgeSet(input: {
	readonly entries: readonly string[];
	readonly threshold: number | null;
	readonly self: string;
	readonly checks: ReadonlyMap<string, SignerCheck>;
	/** The signers now, for a change; null for the first conversion. */
	readonly current?: Policy | null;
	/** The connected wallet, to say "you are removing yourself". */
	readonly me?: string | null;
	/** Who will submit the proposal that carries the change. */
	readonly leader?: string | null;
}): SetJudgement {
	const self = input.self.toLowerCase() as Address;
	const users = [
		...new Set(input.entries.map((e) => e.toLowerCase() as Address)),
	].sort();
	const rows = signerRows({
		entries: input.entries,
		self,
		checks: input.checks,
		current: input.current?.authorizedUsers ?? null,
	});
	const set: SignerSet = {
		authorizedUsers: users,
		threshold: input.threshold ?? 0,
	};
	const found = validateSignerSet(set, {
		self,
		current: input.current ?? null,
		leader: input.leader ? (input.leader.toLowerCase() as Address) : null,
	});
	const lines: Line[] = [];
	let unchanged = false;
	for (const i of found) {
		const as = SET_CODE[i.code] ?? "warning";
		if (as === "form") unchanged = true;
		if (as === "blocked" || as === "warning" || as === "shown")
			lines.push(line(as, i.code, SET_TEXT[i.code] ?? i.message));
	}
	const me = input.me?.toLowerCase();
	if (
		me &&
		input.current?.authorizedUsers.includes(me as Address) &&
		!users.includes(me as Address)
	) {
		lines.push(
			line(
				"warning",
				"signers.self_removed",
				"You are removing yourself. After this you cannot sign for this treasury or see its proposals.",
			),
		);
	}
	lines.sort((x, y) => ORDER[x.level] - ORDER[y.level]);
	const rowBlock = rows.find((r) => r.level === "blocked");
	const setBlock = lines.find((l) => l.level === "blocked");
	// an empty list or a missing number is said before a row's own trouble
	const blockedBy = setBlock
		? setBlock.text
		: rowBlock
			? `${shortAddress(rowBlock.address)}: ${rowBlock.lines[0]?.text ?? ""}`
			: null;
	return {
		lines,
		blockedBy,
		unchanged,
		pending: rows.some((r) => r.level === "pending"),
	};
}

// ---------------------------------------------------------------- how many must sign

export interface ThresholdLines {
	readonly summary: string;
	/** How many stolen keys it takes to empty the treasury. */
	readonly stolen: string;
	/** How many lost keys it takes to lock it. */
	readonly lost: string;
	readonly warning: string | null;
}

/**
 * What a number of required signers means, in the two things it trades
 * against each other. Null until there is a list and a number that fits it.
 */
export function thresholdLines(
	n: number,
	k: number | null,
): ThresholdLines | null {
	if (k === null || n < 1 || k < 1 || k > n) return null;
	const spare = n - k;
	if (n === 1) {
		return {
			summary: "The one signer acts alone.",
			stolen: "Stolen keys: that 1 key is enough to take everything.",
			lost: "Lost keys: if it is lost, the account is locked for good.",
			warning:
				"One key controls the account. This only changes which key that is.",
		};
	}
	return {
		summary:
			k === n
				? `All ${n} signers must sign every time.`
				: k === 1
					? `Any one of the ${n} signers can act alone.`
					: `Any ${k} of the ${n} signers can act.`,
		stolen:
			k === 1
				? "Stolen keys: 1 key is enough to take everything."
				: `Stolen keys: ${k - 1} ${k - 1 === 1 ? "is" : "are"} not enough to move anything. ${k} are.`,
		lost:
			spare === 0
				? "Lost keys: 1 lost key locks it for good."
				: `Lost keys: with ${spare} lost it still works. With ${spare + 1} lost it is locked for good.`,
		warning:
			k === 1
				? "Any one signer alone controls everything."
				: k === n
					? "One lost key locks the account for good. Hyperliquid has no recovery."
					: null,
	};
}

// ---------------------------------------------------------------- what changes

const who = (a: string): Part => ({ text: shortAddress(a), who: a });

/**
 * A change of signers in words: "0xCa70…9d is removed · 0xDa7e…55 is added ·
 * still 2 of 3". `next` null is the conversion back to a normal account.
 */
export function changeSummary(
	current: Pick<Policy, "authorizedUsers" | "threshold">,
	next: SignerSet | null,
): Part[] {
	if (!next)
		return say`Converted back to a normal account: no signers any more.`;
	const removed = current.authorizedUsers.filter(
		(a) => !next.authorizedUsers.includes(a),
	);
	const added = next.authorizedUsers.filter(
		(a) => !current.authorizedUsers.includes(a),
	);
	const of = (s: Pick<Policy, "authorizedUsers" | "threshold">) =>
		`${s.threshold} of ${s.authorizedUsers.length}`;
	const clauses: Part[][] = [
		...removed.map((a) => say`${who(a)} is removed`),
		...added.map((a) => say`${who(a)} is added`),
	];
	clauses.push([
		part(
			of(current) === of(next)
				? `still ${of(next)}`
				: `${of(current)} becomes ${of(next)}`,
		),
	]);
	return joinParts(clauses, " · ");
}

/** Is the wanted set exactly what the account has: the same signers and the same number? */
export function sameSet(
	a: Pick<Policy, "authorizedUsers" | "threshold">,
	b: SignerSet,
): boolean {
	return (
		a.threshold === b.threshold &&
		a.authorizedUsers.length === b.authorizedUsers.length &&
		[...a.authorizedUsers].sort().join() ===
			[...b.authorizedUsers].sort().join()
	);
}

// ---------------------------------------------------------------- waiting proposals

/** A proposal on record, as much of it as this needs. */
export interface OnRecord {
	readonly digest: string;
	readonly title: string;
	readonly proposal: Proposal;
	/** The relay's status; null for a proposal only this browser holds. */
	readonly status: string | null;
	/** Hyperliquid took it. */
	readonly accepted: boolean;
}

/**
 * The proposals still waiting: not carried out, not ended, not refused, and
 * inside the window in which Hyperliquid would still take them.
 */
export function waitingProposals<T extends OnRecord>(
	known: readonly T[],
	now: number,
): T[] {
	return known.filter(
		(k) =>
			!k.accepted &&
			(k.status === null || k.status === "open") &&
			!refusedForGood(k.proposal) &&
			now < nonceWindow(k.proposal.payload.nonce).validUntil,
	);
}

/**
 * loses-signature  a signature of someone removed stops counting
 * cannot-submit    the signer who was to submit it is removed
 * falls-short      it had enough signatures and no longer has
 * becomes-ready    it did not have enough and now has
 * ends             the account stops being a multi-sig: nobody can submit it
 */
export type Effect =
	| "loses-signature"
	| "cannot-submit"
	| "falls-short"
	| "becomes-ready"
	| "ends";

export interface Affected {
	readonly digest: string;
	readonly title: string;
	readonly effects: readonly Effect[];
	/** Signers whose signature stops counting. */
	readonly lost: readonly Address[];
	readonly finaliser: Address;
	readonly have: number;
	readonly need: number;
	/** One line saying what happens to it. */
	readonly parts: readonly Part[];
}

function affectedParts(
	effects: readonly Effect[],
	lost: readonly Address[],
	finaliser: Address,
	have: number,
	need: number,
): Part[] {
	if (effects.includes("ends")) return say`can no longer be submitted`;
	const clauses: Part[][] = [];
	if (effects.includes("cannot-submit"))
		clauses.push(
			say`can no longer be submitted: ${who(finaliser)} was to submit it`,
		);
	if (effects.includes("loses-signature"))
		clauses.push(
			say`loses the signature of ${joinParts(
				lost.map((a) => [who(a)]),
				", ",
			)}: ${String(have)} of ${String(need)} left`,
		);
	else if (effects.includes("falls-short"))
		clauses.push(
			say`no longer has enough signatures: ${String(have)} of ${String(need)}`,
		);
	if (effects.includes("becomes-ready"))
		clauses.push(
			say`becomes ready to submit: ${String(have)} of ${String(need)}`,
		);
	return joinParts(clauses, " · ");
}

/**
 * What a change of signers does to the proposals still waiting. Only the
 * ones it touches are returned. `exclude` is the proposal that carries the
 * change, when it already exists.
 */
export async function affectedProposals(
	waiting: readonly OnRecord[],
	current: Pick<Policy, "authorizedUsers" | "threshold">,
	next: SignerSet | null,
	exclude?: string | null,
): Promise<Affected[]> {
	const out: Affected[] = [];
	for (const w of waiting) {
		if (w.digest === exclude) continue;
		const finaliser = w.proposal.payload.outerSigner;
		const before = await countedSigners(
			w.proposal,
			current.authorizedUsers,
			current.threshold,
		);
		if (!next) {
			out.push({
				digest: w.digest,
				title: w.title,
				effects: ["ends"],
				lost: before,
				finaliser,
				have: 0,
				need: 0,
				parts: affectedParts(["ends"], before, finaliser, 0, 0),
			});
			continue;
		}
		const after = await countedSigners(
			w.proposal,
			next.authorizedUsers,
			next.threshold,
		);
		const lost = before.filter((a) => !after.includes(a));
		const wasReady = before.length >= current.threshold;
		const isReady = after.length >= next.threshold;
		const canSubmit = next.authorizedUsers.includes(finaliser);
		const effects: Effect[] = [];
		if (!canSubmit && current.authorizedUsers.includes(finaliser))
			effects.push("cannot-submit");
		if (lost.length > 0) effects.push("loses-signature");
		if (wasReady && !isReady) effects.push("falls-short");
		if (!wasReady && isReady && canSubmit) effects.push("becomes-ready");
		if (effects.length === 0) continue;
		out.push({
			digest: w.digest,
			title: w.title,
			effects,
			lost,
			finaliser,
			have: after.length,
			need: next.threshold,
			parts: affectedParts(
				effects,
				lost,
				finaliser,
				after.length,
				next.threshold,
			),
		});
	}
	return out;
}
