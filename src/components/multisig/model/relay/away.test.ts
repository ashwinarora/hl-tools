import type { Address, Hex, LedgerRow } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	A,
	B,
	C,
	makeProposal,
	NONCE,
	NOW,
	OUTSIDER,
	RECIPIENT,
	signAs,
	TREASURY,
} from "#/test/keys";
import { eventRow, rowFor } from "#/test/relayRows";
import type { RowProposal } from "../chain/match";
import { partsText } from "../parts";
import {
	type AwayChain,
	type AwayProposal,
	agentsBaseline,
	awayItems,
	awayProposal,
	firstMark,
	isEnding,
	ledgerProgress,
	markAfter,
	type ReadMark,
	treasuriesToCheck,
} from "./away";
import type { EventRow } from "./rows";

const D1 = `0x${"d1".repeat(32)}` as Hex;
const D2 = `0x${"d2".repeat(32)}` as Hex;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const BOT = "0x00000000000000000000000000000000000000b0" as Address;
const BOT2 = "0x00000000000000000000000000000000000000b1" as Address;
const DAY = 86_400_000;

const MARK: ReadMark = {
	eventId: 10,
	ledgerTime: NOW,
	agents: [],
	markedAt: NOW,
};
const NOTHING: AwayChain = { ledger: null, agents: null };
/** Signed by B and C, proposed by B. A (the reader) had nothing to do with it. */
const theirs = (over: Partial<AwayProposal> = {}): AwayProposal => ({
	digest: D1,
	line: "Send 120 USDC to 0x9a01…77c2",
	title: null,
	kind: "usdSend",
	agent: null,
	createdBy: B,
	finaliser: C,
	signers: [B, C],
	status: "accepted",
	expiresAt: NOW + 2 * DAY,
	...over,
});
const ev = (
	kind: Parameters<typeof eventRow>[0],
	id: number,
	over: Partial<EventRow> = {},
) => eventRow(kind, { id, digest: D1, ...over });
const accepted = (id: number, actor: Address, digest: Hex = D1) =>
	ev("submission_recorded", id, { actor, digest, data: { accepted: true } });
const rejected = (id: number, actor: Address) =>
	ev("submission_recorded", id, {
		actor,
		data: { accepted: false, http_status: 200 },
	});

const items = (i: {
	events?: EventRow[];
	proposals?: AwayProposal[];
	chain?: AwayChain;
	mark?: ReadMark | null;
	me?: Address;
	now?: number;
}) =>
	awayItems({
		mark: i.mark === undefined ? MARK : i.mark,
		events: i.events ?? [],
		proposals: i.proposals ?? [],
		me: i.me ?? A,
		chain: i.chain ?? NOTHING,
		now: i.now ?? NOW + DAY,
	});
const texts = (i: Parameters<typeof items>[0]) =>
	items(i).map((x) => partsText(x.parts));

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
	key: `${over.time ?? NOW + 5}:0xabc:internalTransfer`,
	time: NOW + 5,
	hash: "0xabc",
	type: "internalTransfer",
	direction: "out",
	token: "USDC",
	amount: "75",
	counterparty: RECIPIENT,
	fromVenue: null,
	toVenue: null,
	fee: null,
	feeToken: null,
	delta: {},
	...over,
});
const ledger = (
	...rows: [LedgerRow, RowProposal["kind"]][]
): AwayChain["ledger"] =>
	rows.map(([r, kind]) => ({
		row: r,
		proposal:
			kind === "matched"
				? { kind, digest: D1 }
				: kind === "ambiguous"
					? { kind, digests: [D1, D2] }
					: ({ kind } as RowProposal),
	}));

describe("awayItems: an action carried out", () => {
	it("checks a report of acceptance against Hyperliquid's record, and nothing else", () => {
		const question = {
			account: TREASURY,
			action: { type: "usdSend" },
			nonce: 1,
			sentAt: 5,
		};
		const [done] = items({
			events: [accepted(11, C)],
			proposals: [theirs({ record: question })],
		});
		expect(done?.records).toEqual([{ digest: D1, question }]);
		// no document here: nothing to look for
		expect(
			items({ events: [accepted(11, C)], proposals: [] })[0]?.records,
		).toBe(undefined);
		// a refusal is not checked
		expect(
			items({
				events: [rejected(11, C)],
				proposals: [theirs({ createdBy: A, record: question })],
			})[0]?.records,
		).toBe(undefined);
	});

	it("tells a signer who did not sign, and names who did", () => {
		const got = items({ events: [accepted(11, C)], proposals: [theirs()] });
		expect(got.map((x) => partsText(x.parts))).toEqual([
			`Send 120 USDC to 0x9a01…77c2 was carried out. Signed by ${short(B)} and ${short(C)}; you did not sign.`,
		]);
		expect(got[0]?.go).toEqual({ kind: "proposal", digest: D1 });
		// the screen may show nicknames for the two, and the action stands out
		expect(got[0]?.parts.filter((p) => p.who).map((p) => p.who)).toEqual([
			B,
			C,
		]);
		expect(got[0]?.parts[0]).toEqual({
			text: "Send 120 USDC to 0x9a01…77c2",
			strong: true,
		});
	});
	it("tells a signer whose own signature was used, with the title to tell like actions apart", () => {
		expect(
			texts({
				events: [accepted(11, C)],
				proposals: [theirs({ signers: [A, B], title: "Audit fee" })],
			}),
		).toEqual([
			`Send 120 USDC to 0x9a01…77c2 (“Audit fee”), which you signed, was carried out. Sent by ${short(C)}.`,
		]);
		expect(
			texts({
				events: [accepted(11, C)],
				proposals: [theirs({ createdBy: A, signers: [A, B] })],
			}),
		).toEqual([
			`Send 120 USDC to 0x9a01…77c2, which you proposed, was carried out. Sent by ${short(C)}.`,
		]);
	});
	it("says nothing to the one who submitted it", () => {
		expect(texts({ events: [accepted(11, A)], proposals: [theirs()] })).toEqual(
			[],
		);
	});
	it("still tells when the document is not at hand, without claiming who signed", () => {
		expect(texts({ events: [accepted(11, C)] })).toEqual([
			`A proposal was carried out. Sent by ${short(C)}.`,
		]);
	});
	it("tells everyone when it was carried out outside the tool", () => {
		const outside = ev("proposal_carried_out", 11, {
			actor: B,
			data: { reported_by: B },
		});
		expect(
			texts({
				events: [outside],
				proposals: [theirs({ status: "carried_out" })],
			}),
		).toEqual([
			"Send 120 USDC to 0x9a01…77c2 was carried out without being reported here.",
		]);
		expect(
			texts({
				events: [outside],
				proposals: [theirs({ status: "carried_out", createdBy: A })],
			}),
		).toEqual([
			"Send 120 USDC to 0x9a01…77c2, which you proposed, was carried out without being reported here.",
		]);
		// also the signer whose page noticed it: the page did, not the person
		expect(
			texts({
				events: [outside],
				proposals: [theirs({ status: "carried_out" })],
				me: B,
			}),
		).toHaveLength(1);
	});
	it("says it once when the finaliser's result arrives after it was closed as carried out", () => {
		expect(
			texts({
				events: [ev("proposal_carried_out", 11, { actor: B }), accepted(12, C)],
				proposals: [theirs()],
			}),
		).toEqual([
			`Send 120 USDC to 0x9a01…77c2 was carried out. Signed by ${short(B)} and ${short(C)}; you did not sign.`,
		]);
	});
});

describe("awayItems: the end of something you proposed or signed", () => {
	const mineToo = theirs({ signers: [A, B], status: "open" });
	it("tells a rejection, a withdrawal and a decline to those who had a part in it", () => {
		expect(texts({ events: [rejected(11, C)], proposals: [mineToo] })).toEqual([
			// Hyperliquid's own answer uses up the proposal's number: never "it can be retried"
			"Hyperliquid rejected Send 120 USDC to 0x9a01…77c2, which you signed. It cannot be sent again as it is: open it to see why, and propose it again if it is still wanted.",
		]);
		expect(
			texts({
				events: [ev("proposal_withdrawn", 11, { actor: B })],
				proposals: [mineToo],
			}),
		).toEqual([
			`Send 120 USDC to 0x9a01…77c2, which you signed, was cancelled by the proposer, ${short(B)}.`,
		]);
		expect(
			texts({
				events: [ev("proposal_declined", 11, { actor: C })],
				proposals: [theirs({ createdBy: A, signers: [A] })],
			}),
		).toEqual([
			`Send 120 USDC to 0x9a01…77c2, which you proposed, will not be sent: ${short(C)}, its finaliser, said no.`,
		]);
	});
	it("leaves out the ones you had no part in", () => {
		for (const e of [
			rejected(11, C),
			ev("proposal_withdrawn", 11, { actor: B }),
			ev("proposal_declined", 11, { actor: C }),
		])
			expect(texts({ events: [e], proposals: [theirs()] })).toEqual([]);
	});
	it("leaves out what you did yourself", () => {
		expect(
			texts({
				events: [ev("proposal_withdrawn", 11, { actor: A })],
				proposals: [theirs({ createdBy: A, signers: [A] })],
			}),
		).toEqual([]);
		expect(
			texts({
				events: [ev("proposal_declined", 11, { actor: A })],
				proposals: [mineToo],
			}),
		).toEqual([]);
		expect(texts({ events: [rejected(11, A)], proposals: [mineToo] })).toEqual(
			[],
		);
	});
	it("gives one line per proposal, for how it stands in the end", () => {
		// rejected twice, then accepted
		expect(
			texts({
				events: [rejected(11, C), rejected(12, C), accepted(13, C)],
				proposals: [theirs({ signers: [A, B] })],
			}),
		).toEqual([
			`Send 120 USDC to 0x9a01…77c2, which you signed, was carried out. Sent by ${short(C)}.`,
		]);
		// withdrawn, then carried out anyway by another route
		expect(
			texts({
				events: [
					ev("proposal_withdrawn", 11, { actor: B }),
					ev("proposal_carried_out", 12, { actor: C }),
				],
				proposals: [theirs({ signers: [A, B], status: "carried_out" })],
			}),
		).toEqual([
			"Send 120 USDC to 0x9a01…77c2, which you signed, was carried out without being reported here.",
		]);
		// rejected twice: the last attempt
		const twice = items({
			events: [rejected(11, C), rejected(12, C)],
			proposals: [mineToo],
		});
		expect(twice).toHaveLength(1);
		expect(twice[0]?.at).toBe(rejected(12, C).at);
	});
	it("tells when its signing window closed with nothing sent", () => {
		const expired = theirs({
			signers: [A, B],
			status: "open",
			expiresAt: NOW + 3_600_000,
		});
		const got = items({ proposals: [expired] });
		expect(got.map((x) => partsText(x.parts))).toEqual([
			"Send 120 USDC to 0x9a01…77c2, which you signed, expired before it was sent.",
		]);
		expect(got[0]?.at).toBe(NOW + 3_600_000);
		// not yours; not expired yet; expired before the marker; or it ended another way
		expect(texts({ proposals: [{ ...expired, signers: [B] }] })).toEqual([]);
		expect(texts({ proposals: [expired], now: NOW + 60_000 })).toEqual([]);
		expect(texts({ proposals: [{ ...expired, expiresAt: NOW - 1 }] })).toEqual(
			[],
		);
		expect(texts({ proposals: [{ ...expired, status: "withdrawn" }] })).toEqual(
			[],
		);
	});
});

describe("awayItems: who controls the treasury", () => {
	const changed = (id: number) =>
		eventRow("signers_changed", {
			id,
			data: {
				added: [OUTSIDER],
				removed: [C],
				threshold_before: 2,
				threshold_after: 2,
			},
		});
	it("tells a change of signers or threshold, in the history's own words", () => {
		const got = items({ events: [changed(11)] });
		expect(got.map((x) => partsText(x.parts))).toEqual([
			`Signers changed: ${short(OUTSIDER)} added, ${short(C)} removed. Threshold stays 2.`,
		]);
		expect(got[0]?.go).toEqual({ kind: "tab", tab: "overview" });
	});
	it("tells when the account stopped being a multi-sig, or is one again", () => {
		expect(
			texts({
				events: [
					eventRow("treasury_frozen", { id: 11 }),
					eventRow("treasury_unfrozen", { id: 12 }),
				],
			}),
		).toEqual([
			"This account is a multi-sig again.",
			"This account stopped being a multi-sig. Nothing new can be proposed; its history stays readable.",
		]);
	});
	it("does not report back the effect of what the reader just submitted", () => {
		const convert = theirs({ kind: "convertToMultiSigUser" });
		expect(
			texts({ events: [accepted(11, A), changed(12)], proposals: [convert] }),
		).toEqual([]);
		// someone else's submission: both the action and its effect are news
		expect(
			texts({ events: [accepted(11, C), changed(12)], proposals: [convert] }),
		).toHaveLength(2);
		// the reader submitted something else: the change is not its effect
		expect(
			texts({ events: [accepted(11, A), changed(12)], proposals: [theirs()] }),
		).toHaveLength(1);
		// long after the reader's own change: another change
		expect(
			texts({
				events: [
					accepted(11, A),
					{ ...changed(12), at: accepted(11, A).at + 3_600_000 },
				],
				proposals: [convert],
			}),
		).toHaveLength(1);
	});
});

describe("awayItems: API wallets", () => {
	const agents = (...list: [string, Address][]) =>
		list.map(([name, address]) => ({
			name,
			address,
			validUntil: NOW + 90 * DAY,
		}));
	it("tells one that appeared with no proposal on record, and one that is gone", () => {
		const got = items({
			mark: { ...MARK, agents: [BOT2] },
			chain: { ledger: null, agents: agents(["rebalancer", BOT]) },
		});
		expect(got.map((x) => partsText(x.parts))).toEqual([
			`An API wallet was approved with no proposal on record: “rebalancer” ${short(BOT)}. It can trade with everything this treasury holds and move it into vaults.`,
			`An API wallet is no longer approved: ${short(BOT2)}. It was removed, replaced, or it expired.`,
		]);
		expect(got.every((x) => x.at === null)).toBe(true);
		expect(got[0]?.go).toEqual({ kind: "tab", tab: "overview" });
	});
	it("says it once when a proposal in the notice approved it", () => {
		const approve = theirs({
			kind: "approveAgent",
			agent: BOT,
			line: "Approve API wallet “rebalancer”",
		});
		expect(
			texts({
				events: [accepted(11, C)],
				proposals: [approve],
				chain: { ledger: null, agents: agents(["rebalancer", BOT]) },
			}),
		).toEqual([
			`Approve API wallet “rebalancer” was carried out. Signed by ${short(B)} and ${short(C)}; you did not sign.`,
		]);
		// and not at all when the reader submitted that proposal
		expect(
			texts({
				events: [accepted(11, A)],
				proposals: [approve],
				chain: { ledger: null, agents: agents(["rebalancer", BOT]) },
			}),
		).toEqual([]);
	});
	it("sets a removal that was carried out beside the wallet that is gone, without calling it the cause", () => {
		const remove = theirs({
			kind: "approveAgent",
			agent: null,
			removes: true,
			line: "Remove the API wallet named “rebalancer”",
		});
		const gone = {
			mark: { ...MARK, agents: [BOT] },
			chain: { ledger: null, agents: agents() },
		};
		// carried out by somebody else: what is so now first, then the proposal's own line
		expect(
			texts({ ...gone, events: [accepted(11, C)], proposals: [remove] }),
		).toEqual([
			`An API wallet is no longer approved: ${short(BOT)}. A proposal that removes an API wallet was carried out.`,
			`Remove the API wallet named “rebalancer” was carried out. Signed by ${short(B)} and ${short(C)}; you did not sign.`,
		]);
		// two wallets gone and one removal: which one it took is not known
		expect(
			texts({
				mark: { ...MARK, agents: [BOT, BOT2] },
				chain: { ledger: null, agents: agents() },
				events: [accepted(11, C)],
				proposals: [remove],
			}).slice(0, 2),
		).toEqual([
			`An API wallet is no longer approved: ${short(BOT)}. It was removed, replaced, or it expired.`,
			`An API wallet is no longer approved: ${short(BOT2)}. It was removed, replaced, or it expired.`,
		]);
		// a removal that was refused removed nothing
		expect(
			texts({ ...gone, events: [rejected(11, C)], proposals: [remove] })[0],
		).toBe(
			`An API wallet is no longer approved: ${short(BOT)}. It was removed, replaced, or it expired.`,
		);
		// a removal never counts as an approval that explains a new wallet
		expect(
			texts({
				events: [accepted(11, A)],
				proposals: [remove],
				chain: { ledger: null, agents: agents(["rebalancer", BOT]) },
			}),
		).toEqual([
			`An API wallet was approved with no proposal on record: “rebalancer” ${short(BOT)}. It can trade with everything this treasury holds and move it into vaults.`,
		]);
	});
	it("says nothing it has not checked", () => {
		// the list was never recorded: nothing to compare with
		expect(
			texts({
				mark: { ...MARK, agents: null },
				chain: { ledger: null, agents: agents(["rebalancer", BOT]) },
			}),
		).toEqual([]);
		// the list could not be read now
		expect(texts({ mark: { ...MARK, agents: [BOT] }, chain: NOTHING })).toEqual(
			[],
		);
		// unchanged
		expect(
			texts({
				mark: { ...MARK, agents: [BOT] },
				chain: { ledger: null, agents: agents(["rebalancer", BOT]) },
			}),
		).toEqual([]);
	});
	it("quotes and cuts the name its approver typed, and copes with none", () => {
		const long = "x".repeat(60);
		const [named, unnamed] = texts({
			chain: { ledger: null, agents: agents([`  ${long} `, BOT], ["", BOT2]) },
		});
		expect(named).toContain(`“${"x".repeat(40)}…” ${short(BOT)}`);
		expect(unnamed).toBe(
			`An API wallet was approved with no proposal on record: ${short(BOT2)}. It can trade with everything this treasury holds and move it into vaults.`,
		);
	});
});

describe("awayItems: money that left", () => {
	it("tells a transfer out that no proposal on record explains", () => {
		const got = items({
			chain: { ledger: ledger([row(), "none"]), agents: null },
		});
		expect(got.map((x) => partsText(x.parts))).toEqual([
			`75 USDC left for ${short(RECIPIENT)} with no proposal on record.`,
		]);
		expect(got[0]?.go).toEqual({ kind: "tab", tab: "chain" });
		expect(got[0]?.at).toBe(NOW + 5);
		expect(
			texts({
				chain: {
					ledger: ledger([
						row({ type: "withdraw", counterparty: null, amount: "40" }),
						"none",
					]),
					agents: null,
				},
			}),
		).toEqual(["40 USDC left the treasury with no proposal on record."]);
	});
	it("writes the amount as the tables do", () => {
		expect(
			texts({
				chain: {
					ledger: ledger([row({ amount: "1.0" }), "none"]),
					agents: null,
				},
			}),
		).toEqual([
			`1 USDC left for ${short(RECIPIENT)} with no proposal on record.`,
		]);
	});
	it("knows how far the look at Hyperliquid has got", () => {
		const of = (...kinds: RowProposal["kind"][]) =>
			ledgerProgress({
				ledger: ledger(
					...kinds.map((k): [LedgerRow, RowProposal["kind"]] => [row(), k]),
				),
				agents: null,
			});
		expect(of("none", "matched")).toBe("done");
		expect(of("none", "checking", "unchecked")).toBe("open");
		expect(of("none", "unchecked")).toBe("failed");
		expect(ledgerProgress(NOTHING)).toBe("done");
	});
	it("says nothing of a transfer it could not check, or that a proposal explains", () => {
		for (const kind of [
			"checking",
			"unchecked",
			"matched",
			"ambiguous",
			"not-applicable",
		] as const)
			expect(
				texts({ chain: { ledger: ledger([row(), kind]), agents: null } }),
				kind,
			).toEqual([]);
	});
	it("leaves out money arriving, moves inside the account, and what the reader already saw", () => {
		expect(
			texts({
				chain: {
					ledger: ledger(
						[row({ direction: "in" }), "none"],
						[row({ direction: "within" }), "none"],
						[row({ direction: "other" }), "none"],
						[row({ time: NOW }), "none"],
						[row({ time: NOW - 5 }), "none"],
					),
					agents: null,
				},
			}),
		).toEqual([]);
		// never recorded up to when: nothing to count from
		expect(
			texts({
				mark: { ...MARK, ledgerTime: null },
				chain: { ledger: ledger([row(), "none"]), agents: null },
			}),
		).toEqual([]);
	});
	it("names the newest five and counts the rest", () => {
		const many = Array.from({ length: 8 }, (_, n): [LedgerRow, "none"] => [
			row({ time: NOW + 10 + n, amount: String(n + 1) }),
			"none",
		]);
		const got = texts({ chain: { ledger: ledger(...many), agents: null } });
		expect(got).toHaveLength(6);
		expect(got[0]).toBe(
			`8 USDC left for ${short(RECIPIENT)} with no proposal on record.`,
		);
		expect(got[5]).toBe("3 more transfers left with no proposal on record.");
	});
});

describe("awayItems: what stays out", () => {
	it("is not the inbox, and not the proposal's own page", () => {
		expect(
			texts({
				events: [
					ev("proposal_created", 11, { actor: B, data: { finaliser: A } }),
					ev("signature_added", 12, { actor: B }),
					ev("signature_added", 13, { actor: C }),
					ev("signature_removed", 14, { actor: C }),
					eventRow("treasury_added", { id: 15, actor: B }),
					eventRow("unknown", { id: 16, rawKind: "something_new" }),
				],
				proposals: [theirs({ status: "open", signers: [A, B] })],
			}),
		).toEqual([]);
	});
	it("starts from the marker: nothing at or before it, and nothing at all without one", () => {
		expect(
			texts({
				events: [accepted(9, C), accepted(10, C)],
				proposals: [theirs()],
			}),
		).toEqual([]);
		expect(
			texts({
				mark: null,
				events: [accepted(11, C)],
				proposals: [theirs()],
				chain: { ledger: ledger([row(), "none"]), agents: [] },
			}),
		).toEqual([]);
	});
	it("puts what is only known as 'now' first, then the newest", () => {
		const got = items({
			mark: { ...MARK, agents: [BOT] },
			events: [accepted(11, C), accepted(12, C, D2)],
			proposals: [theirs(), theirs({ digest: D2, line: "Send 5 USDC" })],
			chain: {
				ledger: ledger([row({ time: NOW + 999_999 }), "none"]),
				agents: [],
			},
		});
		expect(got.map((x) => x.key)).toEqual([
			`agent-:${BOT}`,
			`left:${NOW + 999_999}:0xabc:internalTransfer`,
			`end:${D2}`,
			`end:${D1}`,
		]);
	});
});

describe("markAfter", () => {
	const read = (
		chain: AwayChain,
		over: Partial<Parameters<typeof markAfter>[0]> = {},
	) =>
		markAfter({
			mark: MARK,
			events: [accepted(11, C), accepted(14, C)],
			chain,
			ledgerReadAt: NOW + 1000,
			...over,
		});
	it("moves the marker to the newest entry shown, never back", () => {
		expect(read(NOTHING).eventId).toBe(14);
		expect(read(NOTHING, { events: [] }).eventId).toBe(10);
		expect(read(NOTHING, { events: [accepted(3, C)] }).eventId).toBe(10);
	});
	it("says nothing about the chain when the chain was not read", () => {
		expect(read(NOTHING).chain).toEqual({});
		// read, but when is not known
		expect(
			read(
				{ ledger: ledger([row(), "none"]), agents: null },
				{
					ledgerReadAt: null,
				},
			).chain,
		).toEqual({});
	});
	it("marks the ledger read up to the moment it was read", () => {
		expect(
			read({ ledger: ledger([row(), "none"]), agents: null }).chain,
		).toEqual({ ledgerTime: NOW + 1000 });
		expect(read({ ledger: [], agents: null }).chain).toEqual({
			ledgerTime: NOW + 1000,
		});
	});
	it("stops just before the first transfer whose proposal is still unknown", () => {
		expect(
			read({
				ledger: ledger(
					[row({ time: NOW + 100 }), "none"],
					[row({ time: NOW + 300 }), "unchecked"],
					[row({ time: NOW + 200 }), "checking"],
					// money arriving is never checked: it holds nothing back
					[row({ time: NOW + 50, direction: "in" }), "checking"],
				),
				agents: null,
			}).chain,
		).toEqual({ ledgerTime: NOW + 199 });
		// nothing to gain: the marker's own time stays
		expect(
			read({
				ledger: ledger([row({ time: NOW + 1 }), "checking"]),
				agents: null,
			}).chain,
		).toEqual({});
	});
	it("records the API wallets as they are now, lowercased and once each", () => {
		const upper = BOT.toUpperCase().replace("0X", "0x");
		expect(
			read({
				ledger: null,
				agents: [
					{ name: "a", address: upper, validUntil: 0 },
					{ name: "b", address: BOT, validUntil: 0 },
					{ name: "c", address: BOT2, validUntil: 0 },
				],
			}).chain,
		).toEqual({ agents: [BOT, BOT2] });
		expect(read({ ledger: null, agents: [] }).chain).toEqual({ agents: [] });
	});
	it("leaves a list too long for a marker out", () => {
		const many = Array.from({ length: 51 }, (_, n) => ({
			name: "",
			address: `0x${n.toString(16).padStart(40, "0")}`,
			validUntil: 0,
		}));
		expect(read({ ledger: null, agents: many }).chain).toEqual({});
	});
});

describe("firstMark and agentsBaseline", () => {
	it("starts the notice from now", () => {
		expect(firstMark({ newestEventId: 42, now: NOW })).toEqual({
			eventId: 42,
			chain: { ledgerTime: NOW },
		});
	});
	it("records the API wallets once, the first time they are known", () => {
		const list = [{ name: "a", address: BOT, validUntil: 0 }];
		expect(agentsBaseline({ ...MARK, agents: null }, list)).toEqual([BOT]);
		expect(agentsBaseline({ ...MARK, agents: null }, [])).toEqual([]);
		expect(agentsBaseline({ ...MARK, agents: [] }, list)).toBeNull();
		expect(agentsBaseline({ ...MARK, agents: null }, null)).toBeNull();
		expect(agentsBaseline(null, list)).toBeNull();
	});
});

describe("awayProposal", () => {
	it("takes the action and its signers from the verified document, the proposer from the relay", async () => {
		const p = await signAs(
			await signAs(makeProposal({ title: "Audit" }), 1),
			2,
		);
		const got = awayProposal(
			rowFor(p, { createdBy: B, status: "accepted" }),
			p,
		);
		expect(got).toMatchObject({
			digest: p.digest,
			title: "Audit",
			kind: "usdSend",
			agent: null,
			createdBy: B,
			signers: [A, B],
			status: "accepted",
		});
		expect(got.line).toMatch(/^Send /);
	});
	it("names the API wallet an approval is for, lowercased", () => {
		const p = makeProposal({
			action: {
				type: "approveAgent",
				signatureChainId: "0x3e6",
				hyperliquidChain: "Testnet",
				agentAddress: BOT.replace("b0", "B0"),
				agentName: "rebalancer",
				nonce: NONCE,
			},
		});
		expect(awayProposal(rowFor(p), p)).toMatchObject({
			kind: "approveAgent",
			agent: BOT,
		});
	});
});

describe("isEnding", () => {
	it("is true for the entries that close a proposal or try to", () => {
		expect(
			(
				[
					"submission_recorded",
					"proposal_carried_out",
					"proposal_withdrawn",
					"proposal_declined",
				] as const
			).every((k) => isEnding(eventRow(k))),
		).toBe(true);
		expect(
			(
				[
					"proposal_created",
					"signature_added",
					"signature_removed",
					"signers_changed",
					"unknown",
				] as const
			).some((k) => isEnding(eventRow(k))),
		).toBe(false);
	});
});

describe("treasuriesToCheck", () => {
	const keys = Array.from({ length: 13 }, (_, n) => `testnet:0x${n}`);
	it("asks about the first ten from the home screen", () => {
		expect([...treasuriesToCheck(keys, "all")]).toEqual(keys.slice(0, 10));
	});
	it("asks about the one treasury on its own page, even the eleventh", () => {
		expect([...treasuriesToCheck(keys, "testnet:0x11")]).toEqual([
			"testnet:0x11",
		]);
		expect(treasuriesToCheck(keys, "testnet:0xnope").size).toBe(0);
	});
	it("asks about none from the navigation", () => {
		expect(treasuriesToCheck(keys, "none").size).toBe(0);
	});
});

describe("a co-signer's no", () => {
	const open = (over: Partial<AwayProposal> = {}) =>
		theirs({ status: "open", signers: [], ...over });
	const no = (id: number, actor: Address, digest: Hex = D1) =>
		ev("objection_added", id, { actor, digest });
	const lines = (list: ReturnType<typeof items>) =>
		list.map((x) => partsText(x.parts));

	it("is told when it stands on something you proposed, or have to send", () => {
		expect(
			lines(
				items({
					events: [no(11, B)],
					proposals: [open({ createdBy: A, finaliser: C })],
				}),
			),
		).toEqual([
			`${short(B)} said no to Send 120 USDC to 0x9a01…77c2, which you proposed.`,
		]);
		expect(
			lines(
				items({
					events: [no(11, B)],
					proposals: [open({ createdBy: C, finaliser: A })],
				}),
			),
		).toEqual([
			`${short(B)} said no to Send 120 USDC to 0x9a01…77c2, which you have to send.`,
		]);
	});

	it("leads to the proposal", () => {
		const [item] = items({
			events: [no(11, B)],
			proposals: [open({ createdBy: A })],
		});
		expect(item?.go).toEqual({ kind: "proposal", digest: D1 });
		expect(item?.key).toBe(`no:${D1}:${B}`);
	});

	it("is not told about somebody else's proposal: that is on the proposal and in the lists", () => {
		expect(
			items({
				events: [no(11, B)],
				proposals: [open({ createdBy: C, finaliser: B })],
			}),
		).toEqual([]);
	});

	it("is not told once it no longer stands: taken back, or replaced by a signature", () => {
		const mine = [open({ createdBy: A })];
		expect(
			items({
				events: [no(11, B), ev("objection_removed", 12, { actor: B })],
				proposals: mine,
			}),
		).toEqual([]);
		expect(
			items({
				events: [
					no(11, B),
					ev("objection_removed", 12, { actor: B }),
					ev("signature_added", 13, { actor: B }),
				],
				proposals: mine,
			}),
		).toEqual([]);
		// said, taken back, said again: it stands
		expect(
			items({
				events: [
					no(11, B),
					ev("objection_removed", 12, { actor: B }),
					no(13, B),
				],
				proposals: mine,
			}),
		).toHaveLength(1);
	});

	it("is not your own, and not about a proposal that is over", () => {
		expect(
			items({ events: [no(11, A)], proposals: [open({ createdBy: A })] }),
		).toEqual([]);
		// withdrawn since: the ending is the news (and your own withdrawal is not)
		expect(
			lines(
				items({
					events: [no(11, B), ev("proposal_withdrawn", 12, { actor: A })],
					proposals: [open({ createdBy: A, status: "withdrawn" })],
				}),
			),
		).toEqual([]);
		// lapsed since
		expect(
			lines(
				items({
					events: [no(11, B)],
					proposals: [open({ createdBy: A, expiresAt: NOW - 1 })],
				}),
			).filter((t) => t.includes("said no")),
		).toEqual([]);
		// its document is not at hand: nothing is guessed
		expect(items({ events: [no(11, B)], proposals: [] })).toEqual([]);
	});

	it("names each co-signer who said no", () => {
		expect(
			lines(
				items({
					events: [no(11, B), no(12, C)],
					proposals: [open({ createdBy: A })],
				}),
			),
		).toEqual([
			`${short(C)} said no to Send 120 USDC to 0x9a01…77c2, which you proposed.`,
			`${short(B)} said no to Send 120 USDC to 0x9a01…77c2, which you proposed.`,
		]);
	});
});

describe("a move of two steps in the notice", () => {
	const MOVE = "Stake 100 HYPE with 0x946b…5b21";
	const step = (n: 1 | 2, over: Partial<AwayProposal> = {}): AwayProposal =>
		theirs({
			digest: n === 1 ? D1 : D2,
			line: n === 1 ? "Move 50 HYPE…" : "Stake 100 HYPE…",
			kind: n === 1 ? "cDeposit" : "tokenDelegate",
			createdBy: A,
			signers: [A, C],
			move: { step: n, other: n === 1 ? D2 : D1, line: MOVE },
			...over,
		});

	it("both steps carried out is one line", () => {
		expect(
			texts({
				events: [accepted(11, C, D1), accepted(12, C, D2)],
				proposals: [step(1), step(2)],
			}),
		).toEqual([
			`${MOVE} (both steps), which you proposed, was carried out. Sent by ${short(C)}.`,
		]);
	});
	it("the line leads to the move", () => {
		const [item] = items({
			events: [accepted(11, C, D1), accepted(12, C, D2)],
			proposals: [step(1), step(2)],
		});
		expect(item?.go).toEqual({ kind: "proposal", digest: D1 });
		expect(item?.key).toBe(`end:${D1}`);
	});
	it("the one line checks both steps against Hyperliquid's record", () => {
		const question = (d: Hex) => ({
			account: TREASURY,
			action: { type: "usdSend", d },
			nonce: 1,
			sentAt: null,
		});
		const [item] = items({
			events: [accepted(11, C, D1), accepted(12, C, D2)],
			proposals: [
				step(1, { record: question(D1) }),
				step(2, { record: question(D2) }),
			],
		});
		// a report without a time of its own is taken at its history entry's
		expect(item?.records?.map((x) => [x.digest, x.question.sentAt])).toEqual([
			[D1, NOW + 11 * 1000],
			[D2, NOW + 12 * 1000],
		]);
	});
	it("one step carried out and the other refused are two lines, each naming its step", () => {
		expect(
			texts({
				events: [
					accepted(11, C, D1),
					ev("submission_recorded", 12, {
						actor: C,
						digest: D2,
						data: { accepted: false, http_status: 200 },
					}),
				],
				proposals: [step(1), step(2)],
			}).sort(),
		).toEqual(
			[
				`${MOVE} (step 1 of 2), which you proposed, was carried out. Sent by ${short(C)}.`,
				`Hyperliquid rejected ${MOVE} (step 2 of 2), which you proposed. It cannot be sent again as it is: open it to see why, and propose it again if it is still wanted.`,
			].sort(),
		);
	});
	it("a co-signer's no to both steps of your move is said once", () => {
		const open = { status: "open" as const };
		expect(
			texts({
				events: [
					ev("objection_added", 11, { actor: B, digest: D1 }),
					ev("objection_added", 12, { actor: B, digest: D2 }),
				],
				proposals: [step(1, open), step(2, open)],
			}),
		).toEqual([
			`${short(B)} said no to ${MOVE} (both steps), which you proposed.`,
		]);
	});
	it("a move that expired is said once", () => {
		const lapsed = { status: "open" as const, expiresAt: NOW + 1000 };
		expect(texts({ proposals: [step(1, lapsed), step(2, lapsed)] })).toEqual([
			`${MOVE} (both steps), which you proposed, expired before it was sent.`,
		]);
	});
});
