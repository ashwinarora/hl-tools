import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ActionForm,
	DEFAULT_FORM,
} from "#/components/multisig/model/actions";
import { DRAFT_CAP, draftKey } from "#/components/multisig/model/drafts";
import { RECIPIENT, TREASURY } from "#/test/keys";

const FORM: ActionForm = {
	...DEFAULT_FORM,
	destination: RECIPIENT,
	amount: "5",
};
const KEY = draftKey("propose", "testnet", TREASURY);
const WIZARD = draftKey("create", "testnet", TREASURY);

/** A stand-in for the browser's `localStorage`: the tests run without one. */
const map = new Map<string, string>();
const localStorage = {
	getItem: (k: string) => map.get(k) ?? null,
	setItem: (k: string, v: string) => void map.set(k, v),
	removeItem: (k: string) => void map.delete(k),
	clear: () => map.clear(),
};

// loaded after the stand-in is in place: the store looks for storage when it is made
let useMultisigDrafts: typeof import("./multisigDraftsStore").useMultisigDrafts;
let MULTISIG_DRAFTS_KEY: string;
const state = () => useMultisigDrafts.getState();

describe("the drafts store", () => {
	beforeAll(async () => {
		vi.stubGlobal("localStorage", localStorage);
		const store = await import("./multisigDraftsStore");
		useMultisigDrafts = store.useMultisigDrafts;
		MULTISIG_DRAFTS_KEY = store.MULTISIG_DRAFTS_KEY;
	});
	beforeEach(() => {
		localStorage.clear();
		useMultisigDrafts.setState({ drafts: {} });
	});

	it("keeps one draft per key, replaces it, and drops it", () => {
		state().save(KEY, { at: 1, form: FORM });
		state().save(KEY, { at: 2, form: { ...FORM, amount: "6" } });
		expect(state().drafts[KEY]).toEqual({
			at: 2,
			form: { ...FORM, amount: "6" },
		});
		expect(Object.keys(state().drafts)).toEqual([KEY]);
		state().drop(KEY);
		expect(state().drafts).toEqual({});
		// dropping what is not there changes nothing
		const before = state().drafts;
		state().drop(KEY);
		expect(state().drafts).toBe(before);
	});

	it("writes them to this browser's storage under its own key", () => {
		state().save(KEY, { at: 5, form: FORM });
		const stored = JSON.parse(
			localStorage.getItem(MULTISIG_DRAFTS_KEY) ?? "{}",
		);
		expect(Object.keys(stored.state)).toEqual(["drafts"]);
		expect(stored.state.drafts[KEY].form.amount).toBe("5");
	});

	it("keeps the newest when there are too many", () => {
		for (let i = 0; i < DRAFT_CAP + 3; i++)
			state().save(`propose:testnet:0x${i}`, { at: i, form: FORM });
		const kept = Object.values(state().drafts).map((d) => d.at);
		expect(kept).toHaveLength(DRAFT_CAP);
		expect(Math.min(...kept)).toBe(3);
	});

	it("drops every draft of an account on a network, and no other", () => {
		const other = draftKey("propose", "mainnet", TREASURY);
		const else1 = draftKey("propose", "testnet", RECIPIENT);
		state().save(KEY, { at: 1, form: FORM });
		state().save(WIZARD, { at: 1, entries: [RECIPIENT], threshold: 1 });
		state().save(other, { at: 1, form: FORM });
		state().save(else1, { at: 1, form: FORM });
		state().dropFor("testnet", TREASURY.toUpperCase().replace("0X", "0x"));
		expect(Object.keys(state().drafts).sort()).toEqual([other, else1].sort());
		const before = state().drafts;
		state().dropFor("testnet", TREASURY);
		expect(state().drafts).toBe(before);
	});

	it("checks what it reads back: a week, the fields, and nothing that is no draft", async () => {
		const now = Date.now();
		localStorage.setItem(
			MULTISIG_DRAFTS_KEY,
			JSON.stringify({
				state: {
					drafts: {
						[KEY]: { at: now - 60_000, form: { ...FORM, kind: "nonsense" } },
						[WIZARD]: { at: now - 8 * 24 * 60 * 60_000, entries: [RECIPIENT] },
						junk: "x",
					},
				},
				version: 0,
			}),
		);
		await useMultisigDrafts.persist.rehydrate();
		expect(Object.keys(state().drafts)).toEqual([KEY]);
		// what was dropped on reading leaves storage at once, not with the next
		// keystroke (audit F-085)
		await Promise.resolve();
		expect(
			Object.keys(
				JSON.parse(localStorage.getItem(MULTISIG_DRAFTS_KEY) ?? "{}").state
					.drafts,
			),
		).toEqual([KEY]);
		// a kind this version does not know falls back to the default one
		expect(state().drafts[KEY]).toMatchObject({ form: FORM });
		// storage that is not JSON at all leaves an empty store
		localStorage.setItem(MULTISIG_DRAFTS_KEY, "{not json");
		await useMultisigDrafts.persist.rehydrate();
		expect(state().drafts).toBeDefined();
	});
});
