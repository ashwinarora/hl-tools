/**
 * Every sentence of "Change signers": the form that replaces a treasury's
 * signer list and the number that must sign, through one proposal. Kept here
 * so the wording is tested like the wizard's (`create.ts`) and uses the same
 * three levels: blocked only where Hyperliquid would refuse, a warning as one
 * line with no click, and plain facts.
 */
import type { AgentInfo, Policy, SignerSet } from "@hl-tools/core";
import { visibleText } from "@hl-tools/core";
import { API_WALLET_CAN } from "./apiWallet";
import {
	isKeyless,
	judgeSet,
	type Line,
	type SignerCheck,
	thresholdLines,
} from "./signerSet";

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

export const CHANGE = {
	/** On the treasury's Signers card. */
	linkLabel: "Change signers",
	signersTitle: "Signers after the change",
	remove: "Remove",
	undo: "Undo",
	you: "you",
	added: "new",
	whatChanges: "What changes",
	nothing: "Nothing changes yet.",
	/** Who has to approve it: the signers of now, by the number of now. */
	whoDecides: (k: number, n: number) =>
		`The current signers decide this: ${
			n === 1
				? "the one signer"
				: k === n
					? n === 2
						? "both of them"
						: `all ${n} of them`
					: `any ${k} of the ${n}`
		}.`,
	/** With a change that takes someone out. */
	removedCanSign: "Someone who is being removed can still sign it.",
	takesEffect:
		"It takes effect the moment Hyperliquid accepts the proposal. Until then nothing changes.",
	/** On the proposal's page: what the comparison is made with. */
	againstNow:
		"Compared with the signers Hyperliquid reports for this treasury now.",
	// The conversion back to a normal account: nothing to fill in, only to understand.
	backLink: "Convert this treasury back to a normal account instead",
	backTitle: "Convert back to a normal account",
	/** Its own choice in the propose form's picker: the same action as `backLink`. */
	backChoice: "Convert back",
	/** Under "Action" for Convert back. */
	backDescription:
		"Turn the treasury back into a normal account, run by its own key again.",
	backLead:
		"After this the account is a normal account again. Whoever holds its own key controls everything it holds, alone. The signers decide nothing any more.",
	backUndo: "Keep it a treasury and change its signers instead",
	/** Under the list of waiting proposals, all of which end. */
	backWaiting: (n: number) =>
		n === 0
			? ""
			: `${plural(n, "waiting proposal", "waiting proposals")} can no longer be sent afterwards.`,
	// What the change does to the proposals still waiting.
	affectedTitle: "Waiting proposals this changes",
	affectedNone: "No waiting proposal is affected.",
	affectedReading: "Reading the waiting proposals…",
	/** The record kept with the relay could not be read. */
	affectedPartial:
		"Only the proposals kept in this browser could be checked. The others could not be read just now.",
	/** Nothing but this browser's copies exists to check (links and files). */
	affectedLocal:
		"Checked against the proposals this browser has opened. One that was passed around as a link or a file and never opened here is not known.",
} as const;

/** What is known about the treasury when its conversion back is proposed. */
export interface BackFacts {
	/** Approved API wallets; null when they could not be read. */
	readonly agents:
		| readonly { readonly name: string; readonly validUntil: number }[]
		| null;
	readonly now: number;
}

/**
 * What to know before converting back. Nothing here is blocked: Hyperliquid
 * takes the conversion from the signers whatever the account holds, and the
 * page cannot know who holds the account's own key.
 */
export function convertBackLines(f: BackFacts): Line[] {
	const lines: Line[] = [
		{
			level: "warning",
			code: "back.key",
			text: "If nobody holds the account's own key, the account is locked for good. This page cannot tell who holds it.",
		},
	];
	if (f.agents === null) {
		lines.push({
			level: "warning",
			code: "back.agents_unread",
			text: "Its API wallets could not be read. If it has one, that wallet keeps acting for the account afterwards.",
		});
	} else {
		const live = f.agents.filter((a) => a.validUntil > f.now);
		if (live.length > 0) {
			const names = live
				.map((a) => `"${a.name ? visibleText(a.name) : "unnamed"}"`)
				.join(", ");
			lines.push({
				level: "warning",
				code: "back.agents",
				text: `${plural(live.length, "API wallet", "API wallets")} (${names}) ${live.length === 1 ? "keeps" : "keep"} acting for the account afterwards: ${live.length === 1 ? "it" : "they"} can ${API_WALLET_CAN}.`,
			});
		}
	}
	lines.push({
		level: "shown",
		code: "back.holds",
		text: "It moves no funds: balances, positions and history stay as they are.",
	});
	return lines;
}

/**
 * API wallets a signer change does not touch: they keep acting for the
 * treasury, whoever its signers become (audit F-023). Null when it has none
 * (or they could not be read: then nothing is said, as on the form).
 */
export function agentsStayLine(
	agents: readonly AgentInfo[] | null,
	now: number,
): Line | null {
	const live = (agents ?? []).filter((a) => a.validUntil > now);
	if (live.length === 0) return null;
	const names = live
		.map((a) => `"${a.name ? visibleText(a.name) : "unnamed"}"`)
		.join(", ");
	return {
		level: "warning",
		code: "change.agents",
		text: `${plural(live.length, "API wallet", "API wallets")} (${names}) ${live.length === 1 ? "keeps" : "keep"} acting for the treasury after this change, whoever its signers are: ${live.length === 1 ? "it" : "they"} can ${API_WALLET_CAN}.`,
	};
}

/**
 * What every co-signer reads on the page of a proposal that changes the
 * signers (audit F-092, decision D3): the form's own judgement of the new
 * list, so a change that locks the treasury for good or hands it over is
 * said to those who approve it, not only to its proposer. The amber lines
 * block nothing; `blockedBy` is set only for a change Hyperliquid would not
 * take, such as more signers required than listed.
 */
export function changeLines(i: {
	/** The new list; null for converting back to a normal account. */
	readonly next: SignerSet | null;
	readonly current: Policy;
	readonly self: string;
	readonly checks: ReadonlyMap<string, SignerCheck>;
	readonly me: string | null;
	readonly leader: string;
	readonly agents: readonly AgentInfo[] | null;
	readonly now: number;
}): { readonly lines: readonly Line[]; readonly blockedBy: string | null } {
	if (!i.next)
		return {
			lines: convertBackLines({ agents: i.agents, now: i.now }).filter(
				(l) => l.level === "warning",
			),
			blockedBy: null,
		};
	const n = i.next.authorizedUsers.length;
	const k = i.next.threshold;
	if (n < 1 || k < 1 || k > n)
		return {
			lines: [],
			blockedBy: `This asks for ${k} of ${n} ${n === 1 ? "signer" : "signers"}, which Hyperliquid cannot take.`,
		};
	const judged = judgeSet({
		entries: i.next.authorizedUsers,
		threshold: k,
		self: i.self,
		checks: i.checks,
		current: i.current,
		me: i.me,
		leader: i.leader,
	});
	const lines: Line[] = judged.lines.filter((l) => l.level === "warning");
	const meaning = thresholdLines(
		n,
		k,
		i.next.authorizedUsers.filter(isKeyless).length,
	);
	if (meaning?.warning)
		lines.unshift({
			level: "warning",
			code: "change.locked",
			text: meaning.warning,
		});
	const agents = agentsStayLine(i.agents, i.now);
	if (agents) lines.push(agents);
	return { lines, blockedBy: judged.blockedBy };
}
