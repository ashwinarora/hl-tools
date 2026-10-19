import { describe, expect, it } from "vitest";
import { RECIPIENT, TREASURY } from "#/test/keys";
import { ACTION_KINDS, type ActionForm, DEFAULT_FORM } from "./actions";
import {
	capped,
	createDraftFor,
	DRAFT_CAP,
	DRAFT_COPY,
	DRAFT_MAX_AGE_MS,
	draftKey,
	formWorthKeeping,
	proposeDraftFor,
	restoredDraft,
	restoredDrafts,
	restoredForm,
	type StoredDraft,
} from "./drafts";
import { FORBIDDEN_CLAIMS } from "./relay/copy";

const NOW = 1_791_900_000_000;
const DAY = 24 * 60 * 60_000;
const form = (over: Partial<ActionForm> = {}): ActionForm => ({
	...DEFAULT_FORM,
	...over,
});
const SEND = form({ destination: RECIPIENT, amount: "12.5", title: "Rent" });
const KEY = draftKey("propose", "testnet", TREASURY);

describe("the key of a draft", () => {
	it("names the form, the network and the account, in one case", () => {
		expect(KEY).toBe(`propose:testnet:${TREASURY}`);
		expect(draftKey("create", "mainnet", TREASURY.toUpperCase())).toBe(
			`create:mainnet:${TREASURY}`,
		);
		// another network or another form is another draft
		expect(draftKey("propose", "mainnet", TREASURY)).not.toBe(KEY);
		expect(draftKey("create", "testnet", TREASURY)).not.toBe(KEY);
	});
});

describe("what is worth keeping", () => {
	it("is a form somebody touched: a field, or the kind alone", () => {
		expect(formWorthKeeping(DEFAULT_FORM)).toBe(false);
		expect(formWorthKeeping(form({ amount: "1" }))).toBe(true);
		expect(formWorthKeeping(form({ kind: "withdraw3" }))).toBe(true);
		expect(formWorthKeeping(form({ removeAgent: "" }))).toBe(true);
		expect(formWorthKeeping(form({ note: " " }))).toBe(true);
		// when the proposal is numbered is chosen at the moment of creating
		expect(formWorthKeeping(form({ nonceMode: "after" as never }))).toBe(false);
	});
});

describe("a stored form put back", () => {
	it("comes back as it was", () => {
		expect(restoredForm(JSON.parse(JSON.stringify(SEND)))).toEqual(SEND);
		const remove = form({ kind: "removeAgent", removeAgent: "" });
		expect(restoredForm(JSON.parse(JSON.stringify(remove)))).toEqual(remove);
		const mode = form({ kind: "accountMode", toMode: "manual" });
		expect(restoredForm(JSON.parse(JSON.stringify(mode)))).toEqual(mode);
	});

	it("takes a field that is not what the form can hold back to its default", () => {
		const odd = restoredForm({
			...SEND,
			kind: "transferEverything",
			amount: 12.5,
			fromPocket: "savings",
			toPerp: null,
			toMode: "portfolio",
			chain: "ethereum",
			removeAgent: 7,
			somethingElse: "x",
			nonceMode: "after",
		});
		expect(odd).toEqual({
			...DEFAULT_FORM,
			destination: RECIPIENT,
			title: "Rent",
		});
		expect(odd && "somethingElse" in odd).toBe(false);
	});

	it("is null for what is no form, and cuts a field that is far too long", () => {
		for (const v of [null, undefined, "form", 7, [], [SEND]])
			expect(restoredForm(v)).toBeNull();
		expect(restoredForm({ raw: "x".repeat(50_000) })?.raw).toHaveLength(20_000);
	});

	it("knows every kind the form offers", () => {
		for (const { kind } of ACTION_KINDS)
			expect(restoredForm({ kind })?.kind).toBe(kind);
	});
});

describe("a stored draft", () => {
	const propose = { at: NOW - DAY, form: SEND };
	it("is kept for a week, and no longer", () => {
		expect(restoredDraft(KEY, propose, NOW)).toEqual(propose);
		expect(
			restoredDraft(KEY, { ...propose, at: NOW - DRAFT_MAX_AGE_MS }, NOW),
		).not.toBeNull();
		expect(
			restoredDraft(KEY, { ...propose, at: NOW - DRAFT_MAX_AGE_MS - 1 }, NOW),
		).toBeNull();
		// a clock set back since: one dated far ahead is not trusted either
		expect(
			restoredDraft(KEY, { ...propose, at: NOW + DRAFT_MAX_AGE_MS + 1 }, NOW),
		).toBeNull();
	});

	it("is dropped when it holds nothing, or is not one", () => {
		expect(restoredDraft(KEY, { at: NOW, form: DEFAULT_FORM }, NOW)).toBeNull();
		expect(restoredDraft(KEY, { at: "yesterday", form: SEND }, NOW)).toBeNull();
		expect(restoredDraft(KEY, { form: SEND }, NOW)).toBeNull();
		expect(restoredDraft(KEY, null, NOW)).toBeNull();
		expect(restoredDraft(KEY, [propose], NOW)).toBeNull();
		expect(restoredDraft("other:testnet:0x1", propose, NOW)).toBeNull();
	});

	it("holds the wizard's signers and number, checked", () => {
		const key = draftKey("create", "testnet", TREASURY);
		expect(
			restoredDraft(
				key,
				{ at: NOW, entries: [RECIPIENT, 7, "0xabc"], threshold: 2 },
				NOW,
			),
		).toEqual({ at: NOW, entries: [RECIPIENT, "0xabc"], threshold: 2 });
		// a number that does not fit the list is cleared, never adjusted
		expect(
			restoredDraft(key, { at: NOW, entries: [RECIPIENT], threshold: 2 }, NOW),
		).toEqual({ at: NOW, entries: [RECIPIENT], threshold: null });
		expect(
			restoredDraft(
				key,
				{ at: NOW, entries: [RECIPIENT], threshold: 1.5 },
				NOW,
			),
		).toMatchObject({ threshold: null });
		// nobody entered: nothing to keep
		expect(
			restoredDraft(key, { at: NOW, entries: [], threshold: null }, NOW),
		).toBeNull();
		expect(restoredDraft(key, { at: NOW, entries: "a,b" }, NOW)).toBeNull();
		// at most ten signers
		expect(
			(
				restoredDraft(
					key,
					{ at: NOW, entries: Array.from({ length: 14 }, (_, i) => `0x${i}`) },
					NOW,
				) as unknown as { entries: string[] }
			).entries,
		).toHaveLength(10);
	});

	it("is read back as a whole store: only drafts, none too old, the newest kept", () => {
		expect(restoredDrafts(null, NOW)).toEqual({});
		expect(restoredDrafts([propose], NOW)).toEqual({});
		const many: Record<string, unknown> = {
			junk: 1,
			[KEY]: { at: NOW - 8 * DAY, form: SEND },
		};
		for (let i = 0; i < DRAFT_CAP + 5; i++)
			many[`propose:testnet:0x${i.toString(16).padStart(40, "0")}`] = {
				at: NOW - i * 60_000,
				form: SEND,
			};
		const kept = restoredDrafts(many, NOW);
		expect(Object.keys(kept)).toHaveLength(DRAFT_CAP);
		expect(KEY in kept).toBe(false);
		// the oldest five went
		expect(Math.min(...Object.values(kept).map((d) => d.at))).toBe(
			NOW - (DRAFT_CAP - 1) * 60_000,
		);
		expect(Object.keys(capped({ [KEY]: propose }))).toEqual([KEY]);
	});
});

describe("which form a link opens", () => {
	const stored: StoredDraft = { at: NOW, form: SEND };
	it("puts the draft back when the link asks for nothing else", () => {
		expect(proposeDraftFor(stored, {})).toBe(stored);
		expect(proposeDraftFor(stored, { kind: "sendUsdc" })).toBe(stored);
	});

	it("lets the link win when it asks for another kind, or to propose something again", () => {
		expect(proposeDraftFor(stored, { kind: "withdraw3" })).toBeNull();
		expect(proposeDraftFor(stored, { supersedes: "0xabc" })).toBeNull();
		expect(
			proposeDraftFor(stored, { kind: "sendUsdc", supersedes: "0xabc" }),
		).toBeNull();
		expect(proposeDraftFor(null, {})).toBeNull();
		expect(proposeDraftFor(undefined, {})).toBeNull();
		// a wizard's draft is no form
		expect(
			proposeDraftFor({ at: NOW, entries: [RECIPIENT], threshold: 1 }, {}),
		).toBeNull();
	});

	it("knows the links that name a choice inside a form", () => {
		const back: StoredDraft = {
			at: NOW,
			form: form({ kind: "changeSigners", signers: "null" }),
		};
		const change: StoredDraft = {
			at: NOW,
			form: form({
				kind: "changeSigners",
				signers: '{"authorizedUsers":[],"threshold":1}',
			}),
		};
		expect(proposeDraftFor(back, { kind: "convertBack" })).toBe(back);
		expect(proposeDraftFor(change, { kind: "convertBack" })).toBeNull();
		expect(proposeDraftFor(change, { kind: "changeSigners" })).toBe(change);
		// staking is one entry: any of its three forms comes back
		const move: StoredDraft = {
			at: NOW,
			form: form({ kind: "moveStake", amount: "1" }),
		};
		expect(proposeDraftFor(move, { kind: "stake" })).toBe(move);
		expect(proposeDraftFor(move, { kind: "returnToSpot" })).toBeNull();
		// "remove A", then "remove B": another wallet is another form
		const removeA: StoredDraft = {
			at: NOW,
			form: form({ kind: "removeAgent", removeAgent: "a", note: "why" }),
		};
		expect(proposeDraftFor(removeA, { kind: "removeAgent", agent: "a" })).toBe(
			removeA,
		);
		expect(
			proposeDraftFor(removeA, { kind: "removeAgent", agent: "b" }),
		).toBeNull();
		expect(
			proposeDraftFor(removeA, { kind: "removeAgent", agent: "" }),
		).toBeNull();
		expect(proposeDraftFor(removeA, { kind: "removeAgent" })).toBe(removeA);
		// a row of the Vaults tab names its vault: a draft for another vault stays put
		const VAULT_A = `0x${"a".repeat(40)}`;
		const fromA: StoredDraft = {
			at: NOW,
			form: form({ kind: "vaultWithdraw", vault: VAULT_A, amount: "5" }),
		};
		expect(
			proposeDraftFor(fromA, {
				kind: "vaultWithdraw",
				vault: VAULT_A.toUpperCase().replace("0X", "0x"),
			}),
		).toBe(fromA);
		expect(
			proposeDraftFor(fromA, {
				kind: "vaultWithdraw",
				vault: `0x${"b".repeat(40)}`,
			}),
		).toBeNull();
		expect(proposeDraftFor(fromA, { kind: "vaultWithdraw" })).toBe(fromA);
		expect(proposeDraftFor(fromA, { kind: "vaultDeposit" })).toBeNull();
	});

	it("tells a wizard's draft from a form's", () => {
		const wizard: StoredDraft = { at: NOW, entries: [RECIPIENT], threshold: 1 };
		expect(createDraftFor(wizard)).toBe(wizard);
		expect(createDraftFor(stored)).toBeNull();
		expect(createDraftFor(null)).toBeNull();
	});
});

describe("the line that says a draft is back", () => {
	it("says when, where it is kept and for how long, and promises nothing more", () => {
		const text = DRAFT_COPY.restored(NOW - 3 * 60 * 60_000, NOW);
		expect(text).toBe(
			"What you had filled in here 3 hours ago is back. This browser keeps it for a week.",
		);
		for (const pattern of FORBIDDEN_CLAIMS) expect(text).not.toMatch(pattern);
		expect(DRAFT_COPY.clear).toBe("Clear");
	});
});
