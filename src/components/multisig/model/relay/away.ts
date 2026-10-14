/**
 * "While you were away": what finished or changed in a treasury since its
 * signer last said "Got it". Not the inbox (things that wait for you), and
 * not the whole history: only finished things that change what you believed
 * about the treasury.
 *
 *   in   an action carried out that you did not submit yourself
 *        a co-signer's no that still stands on something you proposed or
 *        have to submit
 *        the end of something you proposed or signed (rejected, withdrawn,
 *        declined, expired)
 *        signers or threshold changed; the account stopped being a multi-sig
 *        an API wallet approved or gone that no proposal in the notice explains
 *        money that left with no proposal on record
 *   out  a new proposal waiting (the inbox), a co-signer signing or taking a
 *        signature back, or saying no to somebody else's proposal (the
 *        proposal's page and the lists), money arriving and trades
 *        (the tables), and whatever you did yourself
 *
 * Pure. The relay's history says who did what; what a proposal does comes
 * from its own verified document; what only Hyperliquid knows (API wallets,
 * transfers) is used only once its check has finished, never guessed.
 */
import {
	type Address,
	type AgentInfo,
	cutTo,
	Decimal,
	type Hex,
	isAgentRemoval,
	isolated,
	type LedgerRow,
	type Proposal,
	visibleText,
} from "@hl-tools/core";
import type { RowProposal } from "../chain/match";
import { type RecordQuestion, recordQuestion } from "../chain/record";
import { type MoveRef, sayOncePerMove, stepMark } from "../move";
import { joinParts, type Part, part, say } from "../parts";
import { shortAddress } from "../stage";
import { actionLine } from "../staking";
import type { TreasuryTab } from "../tabs";
import { afterRejection } from "./copy";
import type { EventRow, ProposalRow, ProposalStatus } from "./rows";
import { buildTimeline } from "./timeline";

/** The signer's newest marker for one treasury. */
export interface ReadMark {
	/** Every history entry up to this id has been read. */
	readonly eventId: number;
	/** Transfers up to this moment (unix ms) have been seen; null when never recorded. */
	readonly ledgerTime: number | null;
	/** The API wallets the signer knew of; null when never recorded. */
	readonly agents: readonly Address[] | null;
	readonly markedAt: number;
}

/** A proposal the history refers to, as verified in this browser. */
export interface AwayProposal {
	readonly digest: Hex;
	/** The action in words. */
	readonly line: string;
	readonly title: string | null;
	/** `action.type`. */
	readonly kind: string;
	/** The API wallet an `approveAgent` names. */
	readonly agent: Address | null;
	/** It removes an API wallet (an approval of the zero address). */
	readonly removes?: boolean;
	readonly createdBy: Address | null;
	/** The one signer who can submit it. */
	readonly finaliser: Address | null;
	/** Whose signatures verified. */
	readonly signers: readonly Address[];
	readonly status: ProposalStatus;
	readonly expiresAt: number;
	/** Set when it is one step of a move this browser verified (model/move.ts). */
	readonly move?: MoveRef | null;
	/** What to look for on Hyperliquid's record, should it read as accepted. */
	readonly record?: RecordQuestion;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A proposal for the notice, from the relay's row and the document this
 * browser verified. Who proposed it is the relay's word (it stamps the
 * signed-in wallet); who signed is what verified here.
 */
export function awayProposal(row: ProposalRow, p: Proposal): AwayProposal {
	const action = p.payload.action;
	const removes = isAgentRemoval(action);
	// a removal names the zero address, which is nobody's wallet
	const agent =
		action.type === "approveAgent" && !removes ? action.agentAddress : null;
	return {
		digest: p.digest,
		// a staking step in the words of its own page, as every list has it
		line: actionLine(action, null, p.payload.network),
		title: p.meta.title ?? null,
		kind: String(action.type),
		agent:
			typeof agent === "string" && ADDRESS.test(agent)
				? (agent.toLowerCase() as Address)
				: null,
		removes,
		createdBy: row.createdBy,
		finaliser: row.finaliser,
		signers: p.signatures.map((s) => s.signer),
		status: row.status,
		expiresAt: row.expiresAt,
		record: recordQuestion(p),
	};
}

/** The history entries that end a proposal. */
export function isEnding(e: EventRow): boolean {
	return endingOf(e) !== null;
}

/**
 * The history entries whose proposals the notice has to read: the ones that
 * ended, and the ones somebody said no to (the notice says so only for the
 * reader's own, and whose it is stands in the document).
 */
export function needsDocument(e: EventRow): boolean {
	return isEnding(e) || e.kind === "objection_added";
}

/** How many treasuries one visit of the home screen asks Hyperliquid about. */
export const AWAY_TREASURIES_PER_VISIT = 10;
/** Hyperliquid is asked about one treasury at most this often. */
export const AWAY_CHECK_EVERY_MS = 5 * 60_000;

/**
 * Which treasuries a screen asks Hyperliquid about, by key. The home screen:
 * the first ten. A treasury's own page: that treasury. Everything else (the
 * navigation) asks about none and shows what is already known.
 */
export function treasuriesToCheck(
	keys: readonly string[],
	scope: "all" | "none" | string,
): ReadonlySet<string> {
	if (scope === "none") return new Set();
	if (scope === "all") return new Set(keys.slice(0, AWAY_TREASURIES_PER_VISIT));
	return new Set(keys.includes(scope) ? [scope] : []);
}

/** What only Hyperliquid knows. Null means "not checked", and then nothing is said. */
export interface AwayChain {
	/** The account's ledger since the marker, each row with what is known about its proposal. */
	readonly ledger:
		| readonly { readonly row: LedgerRow; readonly proposal: RowProposal }[]
		| null;
	readonly agents: readonly AgentInfo[] | null;
}

export type AwayGo =
	| { readonly kind: "proposal"; readonly digest: Hex }
	| { readonly kind: "tab"; readonly tab: TreasuryTab };

export interface AwayItem {
	readonly key: string;
	/** When it happened; null for what is only known as "now" (an API wallet list). */
	readonly at: number | null;
	readonly parts: readonly Part[];
	/** Where "View" leads. */
	readonly go: AwayGo;
	/** Reports of acceptance (one, or both steps of a move): checked against Hyperliquid's record. */
	readonly records?: readonly {
		readonly digest: Hex;
		readonly question: RecordQuestion;
	}[];
}

/** Transfers named one by one before the rest are counted. */
export const AWAY_TRANSFERS_SHOWN = 5;
/** How long after the reader's own submission a signer change is taken to be its effect. */
const OWN_CHANGE_MS = 10 * 60_000;

type Ending = "accepted" | "outside" | "rejected" | "withdrawn" | "declined";
const RANK: Record<Ending, number> = {
	accepted: 3,
	outside: 2,
	rejected: 1,
	withdrawn: 1,
	declined: 1,
};

function endingOf(e: EventRow): Ending | null {
	switch (e.kind) {
		case "submission_recorded":
			return e.data.accepted === true ? "accepted" : "rejected";
		case "proposal_carried_out":
			return "outside";
		case "proposal_withdrawn":
			return "withdrawn";
		case "proposal_declined":
			return "declined";
		default:
			return null;
	}
}

export function awayItems(i: {
	/** Null until the signer has a marker: the notice starts from the first one. */
	readonly mark: ReadMark | null;
	/** The treasury's history; entries at or before the marker are ignored. */
	readonly events: readonly EventRow[];
	readonly proposals: readonly AwayProposal[];
	readonly me: Address;
	readonly chain: AwayChain;
	readonly now: number;
}): AwayItem[] {
	const { mark, me } = i;
	if (!mark) return [];
	const events = i.events
		.filter((e) => e.id > mark.eventId)
		.sort((a, b) => a.id - b.id);
	const proposals = new Map(i.proposals.map((p) => [p.digest, p]));
	const who = (a: Address | null): Part =>
		a ? { text: a === me ? "you" : shortAddress(a), who: a } : part("someone");
	const action = (p: AwayProposal | null, start: boolean): Part[] =>
		!p
			? [part(start ? "A proposal" : "a proposal")]
			: [
					{ text: p.move ? p.move.line : p.line, strong: true },
					...(p.move ? [stepMark(p.move.step)] : []),
					...(p.title
						? [{ text: ` (“${isolated(p.title)}”)`, quiet: true }]
						: []),
				];
	/** What the reader had to do with a proposal; null when nothing (or when it cannot be told). */
	const mine = (p: AwayProposal | null): "proposed" | "signed" | null =>
		!p
			? null
			: p.createdBy === me
				? "proposed"
				: p.signers.includes(me)
					? "signed"
					: null;
	const names = (list: readonly Address[]): Part[] => {
		const each = list.map((a) => [who(a)]);
		if (each.length <= 1) return each[0] ?? [];
		return [
			...joinParts(each.slice(0, -1), ", "),
			part(" and "),
			...(each[each.length - 1] as Part[]),
		];
	};

	const out: AwayItem[] = [];

	// ---- how each proposal ended: one line per proposal, for its last word
	const finals = new Map<Hex, { ending: Ending; e: EventRow }>();
	for (const e of events) {
		const ending = endingOf(e);
		if (!ending || !e.digest) continue;
		const had = finals.get(e.digest);
		if (!had || RANK[ending] >= RANK[had.ending])
			finals.set(e.digest, { ending, e });
	}
	/** Digests carried out in this notice's span, whoever sent them. */
	const carriedOut = new Set<Hex>();
	for (const [digest, { ending, e }] of finals) {
		const p = proposals.get(digest) ?? null;
		const rel = mine(p);
		const go: AwayGo = { kind: "proposal", digest };
		const item = (parts: Part[]) =>
			out.push({ key: `end:${digest}`, at: e.at, parts, go });
		if (ending === "accepted" || ending === "outside") carriedOut.add(digest);
		switch (ending) {
			case "accepted": {
				// what you submitted yourself is not news to you
				if (e.actor === me) break;
				const others = (p?.signers ?? []).filter((a) => a !== me);
				const question = p?.record
					? { ...p.record, sentAt: p.record.sentAt ?? e.at }
					: null;
				const accepted = (parts: Part[]) =>
					out.push({
						key: `end:${digest}`,
						at: e.at,
						parts,
						go,
						...(question ? { records: [{ digest, question }] } : {}),
					});
				accepted(
					rel
						? say`${action(p, true)}, which you ${rel}, was carried out. Submitted by ${who(e.actor)}.`
						: !p
							? say`${action(p, true)} was carried out. Submitted by ${who(e.actor)}.`
							: others.length
								? say`${action(p, true)} was carried out. Signed by ${names(others)}; you did not sign.`
								: say`${action(p, true)} was carried out. You did not sign.`,
				);
				break;
			}
			case "outside":
				item(
					rel
						? say`${action(p, true)}, which you ${rel}, was carried out without being reported here.`
						: say`${action(p, true)} was carried out without being reported here.`,
				);
				break;
			case "rejected":
				if (rel && e.actor !== me)
					item(
						say`Hyperliquid rejected ${action(p, false)}, which you ${rel}. ${afterRejection(e.data.http_status)}`,
					);
				break;
			case "withdrawn":
				if (rel && e.actor !== me)
					item(
						say`${action(p, true)}, which you ${rel}, was withdrawn by the proposer, ${who(e.actor)}.`,
					);
				break;
			case "declined":
				if (rel && e.actor !== me)
					item(
						say`${action(p, true)}, which you ${rel}, was declined by the finaliser, ${who(e.actor)}.`,
					);
				break;
		}
	}

	// ---- a co-signer's no that still stands on something that is yours to move
	// (what they said to other people's proposals is on those proposals)
	const noes = new Map<string, EventRow>();
	for (const e of events) {
		if (!e.digest || !e.actor) continue;
		const key = `${e.digest}:${e.actor}`;
		if (e.kind === "objection_added") noes.set(key, e);
		// taken back, or replaced by a signature
		else if (e.kind === "objection_removed" || e.kind === "signature_added")
			noes.delete(key);
	}
	for (const e of noes.values()) {
		const digest = e.digest as Hex;
		const p = proposals.get(digest) ?? null;
		if (
			!p ||
			e.actor === me ||
			// its end is the news then, and is said above or below
			finals.has(digest) ||
			p.status !== "open" ||
			p.expiresAt <= i.now
		)
			continue;
		const rel =
			p.createdBy === me
				? "proposed"
				: p.finaliser === me
					? "have to submit"
					: null;
		if (!rel) continue;
		out.push({
			key: `no:${digest}:${e.actor}`,
			at: e.at,
			parts: say`${who(e.actor)} said no to ${action(p, false)}, which you ${rel}.`,
			go: { kind: "proposal", digest },
		});
	}

	// ---- yours, and its signing window closed with nothing sent
	for (const p of i.proposals) {
		if (
			p.status !== "open" ||
			finals.has(p.digest) ||
			p.expiresAt <= mark.markedAt ||
			p.expiresAt > i.now
		)
			continue;
		const rel = mine(p);
		if (!rel) continue;
		out.push({
			key: `expired:${p.digest}`,
			at: p.expiresAt,
			parts: say`${action(p, true)}, which you ${rel}, expired before it was submitted.`,
			go: { kind: "proposal", digest: p.digest },
		});
	}

	// ---- who controls the treasury
	for (const e of events) {
		if (
			e.kind !== "signers_changed" &&
			e.kind !== "treasury_frozen" &&
			e.kind !== "treasury_unfrozen"
		)
			continue;
		// the effect of what the reader just submitted is not news either
		const own = events.some(
			(s) =>
				s.id < e.id &&
				e.at - s.at <= OWN_CHANGE_MS &&
				s.kind === "submission_recorded" &&
				s.data.accepted === true &&
				s.actor === me &&
				s.digest !== null &&
				proposals.get(s.digest)?.kind === "convertToMultiSigUser",
		);
		if (own) continue;
		const entry = buildTimeline([e], { me, line: () => null })[0];
		if (entry)
			out.push({
				key: `event:${e.id}`,
				at: e.at,
				parts: entry.parts,
				go: { kind: "tab", tab: "overview" },
			});
	}

	// ---- API wallets: compared with the list the reader last knew
	if (mark.agents && i.chain.agents) {
		const knew = new Set(mark.agents);
		const now = new Set(
			i.chain.agents.map((a) => a.address.toLowerCase() as Address),
		);
		// an approval that a proposal of this notice explains is said once, there
		const explained = new Set(
			[...carriedOut]
				.map((d) => proposals.get(d))
				.filter((p) => p?.kind === "approveAgent")
				.map((p) => p?.agent),
		);
		for (const a of i.chain.agents) {
			const address = a.address.toLowerCase() as Address;
			if (knew.has(address) || explained.has(address)) continue;
			out.push({
				key: `agent+:${address}`,
				at: null,
				parts: say`An API wallet was approved with no proposal on record: ${agentName(a.name)}${{ text: shortAddress(address), who: address }}. It can trade with everything this treasury holds and move it into vaults.`,
				go: { kind: "tab", tab: "overview" },
			});
		}
		// A removal names its wallet by name and the reader's list holds
		// addresses, so which wallet a removal took cannot be told for certain.
		// When as many removals were carried out as wallets are gone, the two
		// facts are said side by side; a guess at the cause is left out.
		const gone = mark.agents.filter((address) => !now.has(address));
		const removals = [...carriedOut].filter(
			(d) => proposals.get(d)?.removes,
		).length;
		for (const address of gone) {
			const who = { text: shortAddress(address), who: address };
			out.push({
				key: `agent-:${address}`,
				at: null,
				parts:
					removals >= gone.length
						? say`An API wallet is no longer approved: ${who}. A proposal that removes an API wallet was carried out.`
						: say`An API wallet is no longer approved: ${who}. It was removed, replaced, or it expired.`,
				go: { kind: "tab", tab: "overview" },
			});
		}
	}

	// ---- money that left, and nothing on record asked for it
	if (mark.ledgerTime !== null && i.chain.ledger) {
		const since = mark.ledgerTime;
		const left = i.chain.ledger
			.filter(
				(x) =>
					x.row.direction === "out" &&
					x.row.time > since &&
					x.proposal.kind === "none",
			)
			.sort((a, b) => b.row.time - a.row.time);
		for (const { row } of left.slice(0, AWAY_TRANSFERS_SHOWN)) {
			// as the tables show it: "1", not the ledger's "1.0"
			const amount = row.amount
				? (Decimal.tryParse(row.amount)?.toString() ?? row.amount)
				: "An amount";
			const what = `${amount}${row.token ? ` ${row.token}` : ""}`;
			out.push({
				key: `left:${row.key}`,
				at: row.time,
				parts: row.counterparty
					? say`${what} left for ${{ text: shortAddress(row.counterparty), who: row.counterparty }} with no proposal on record.`
					: say`${what} left the treasury with no proposal on record.`,
				go: { kind: "tab", tab: "chain" },
			});
		}
		const more = left.length - AWAY_TRANSFERS_SHOWN;
		if (more > 0) {
			out.push({
				key: `left:more:${more}`,
				at: left[AWAY_TRANSFERS_SHOWN]?.row.time ?? null,
				parts: say`${String(more)} more ${more === 1 ? "transfer" : "transfers"} left with no proposal on record.`,
				go: { kind: "tab", tab: "chain" },
			});
		}
	}

	// what is only known as "now" first, then newest first
	// the two steps of a move: what is said of both alike is said once
	const once = sayOncePerMove(
		out,
		{
			digest: (item) => (item.go.kind === "proposal" ? item.go.digest : null),
			parts: (item) => item.parts,
			// news without a moment of its own stands for now
			at: (item) => item.at ?? i.now,
		},
		(digest) => proposals.get(digest)?.move ?? null,
		(first, parts, second) => {
			const records = [...(first.records ?? []), ...(second.records ?? [])];
			return { ...first, parts, ...(records.length ? { records } : {}) };
		},
	);
	return once.sort(
		(a, b) =>
			(b.at ?? Number.POSITIVE_INFINITY) - (a.at ?? Number.POSITIVE_INFINITY) ||
			(a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
	);
}

/**
 * How far the look at Hyperliquid has got, for the line under a group:
 *   open    some transfer's proposal is still being looked up
 *   failed  one could not be looked up (it stays unread and is tried again)
 *   done    everything read was judged
 */
export function ledgerProgress(chain: AwayChain): "open" | "failed" | "done" {
	const out = (chain.ledger ?? []).filter((x) => x.row.direction === "out");
	if (out.some((x) => x.proposal.kind === "checking")) return "open";
	if (out.some((x) => x.proposal.kind === "unchecked")) return "failed";
	return "done";
}

/** An API wallet's name is whatever its approver typed on chain: quoted, and cut. */
function agentName(name: string): string {
	const tidy = visibleText(name.replace(/\s+/g, " ").trim());
	if (!tidy) return "";
	return `“${isolated(cutTo(tidy, 40))}” `;
}

/** What a marker may carry about the chain (see the relay's `mark_chain_ok`). */
export interface MarkChain {
	ledgerTime?: number;
	agents?: Address[];
}

/** The most API wallets a marker holds. */
export const MARK_AGENTS_MAX = 50;

function agentList(agents: readonly AgentInfo[] | null): Address[] | null {
	if (!agents) return null;
	const list = [
		...new Set(agents.map((a) => a.address.toLowerCase() as Address)),
	];
	return list.length <= MARK_AGENTS_MAX ? list : null;
}

/**
 * The marker "Got it" writes: everything shown is read. What could not be
 * checked stays unread: the ledger is marked only up to just before the first
 * transfer whose proposal is still unknown, and not at all when the ledger
 * was not read.
 */
export function markAfter(i: {
	readonly mark: ReadMark;
	readonly events: readonly EventRow[];
	readonly chain: AwayChain;
	/** When the ledger was read; null when it was not. */
	readonly ledgerReadAt: number | null;
}): { readonly eventId: number; readonly chain: MarkChain } {
	const chain: MarkChain = {};
	if (i.chain.ledger && i.ledgerReadAt !== null) {
		const open = i.chain.ledger
			.filter(
				(x) =>
					x.row.direction === "out" &&
					(x.proposal.kind === "checking" || x.proposal.kind === "unchecked"),
			)
			.map((x) => x.row.time);
		const upTo = open.length ? Math.min(...open) - 1 : i.ledgerReadAt;
		if (upTo > (i.mark.ledgerTime ?? -1)) chain.ledgerTime = upTo;
	}
	const agents = agentList(i.chain.agents);
	if (agents) chain.agents = agents;
	return {
		eventId: i.events.reduce((m, e) => Math.max(m, e.id), i.mark.eventId),
		chain,
	};
}

/**
 * The signer's first marker for a treasury: the notice starts from now, so
 * nothing that happened before is "while you were away".
 */
export function firstMark(i: {
	/** The treasury's newest history entry. */
	readonly newestEventId: number;
	readonly now: number;
}): { readonly eventId: number; readonly chain: MarkChain } {
	return { eventId: i.newestEventId, chain: { ledgerTime: i.now } };
}

/**
 * The API wallets to record once a marker that has none meets a finished
 * check: from then on, changes to that list can be told. Null when there is
 * nothing to record.
 */
export function agentsBaseline(
	mark: ReadMark | null,
	agents: readonly AgentInfo[] | null,
): Address[] | null {
	if (!mark || mark.agents !== null) return null;
	return agentList(agents);
}
