import type { Address } from "@hl-tools/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

/** A stand-in for the browser's `localStorage`: the tests run without one. */
const map = new Map<string, string>();
const localStorage = {
	getItem: (k: string) => map.get(k) ?? null,
	setItem: (k: string, v: string) => void map.set(k, v),
	removeItem: (k: string) => void map.delete(k),
	clear: () => map.clear(),
};

// loaded after the stand-in is in place: the store looks for storage when it is made
let useMultisigPrefs: typeof import("./multisigPrefsStore").useMultisigPrefs;
beforeAll(async () => {
	vi.stubGlobal("localStorage", localStorage);
	({ useMultisigPrefs } = await import("./multisigPrefsStore"));
});

/** What a stored value becomes when it is restored. */
const restore = (persisted: unknown) => {
	const merge = useMultisigPrefs.persist.getOptions().merge;
	if (!merge) throw new Error("the store restores through its own merge");
	return merge(persisted, useMultisigPrefs.getState());
};

describe("the Multisig section's preferences, as restored", () => {
	it("keep a folded notice and a put-away first-run card", () => {
		const back = restore({ awayFolded: true, walkthroughSeen: true });
		expect([back.awayFolded, back.walkthroughSeen]).toEqual([true, true]);
	});

	it("take nothing but true for them, and nothing they do not know", () => {
		const back = restore({
			awayFolded: "yes",
			walkthroughSeen: 1,
			somethingElse: "kept?",
		}) as unknown as Record<string, unknown>;
		expect([back.awayFolded, back.walkthroughSeen]).toEqual([false, false]);
		expect(back.somethingElse).toBeUndefined();
		const empty = restore(undefined);
		expect([empty.awayFolded, empty.walkthroughSeen]).toEqual([false, false]);
	});

	it("store them", () => {
		const partialize = useMultisigPrefs.persist.getOptions().partialize;
		const stored = partialize?.({
			...useMultisigPrefs.getState(),
			awayFolded: true,
			walkthroughSeen: true,
		}) as Record<string, unknown>;
		expect(stored).toMatchObject({ awayFolded: true, walkthroughSeen: true });
	});

	it('keep which treasuries\' "added by" panel was closed, as a list of names only', () => {
		const back = restore({
			provenanceClosed: ["testnet:0xabc", 7, null, "mainnet:0xdef"],
		});
		expect(back.provenanceClosed).toEqual(["testnet:0xabc", "mainnet:0xdef"]);
		expect(restore({}).provenanceClosed).toEqual([]);
		const partialize = useMultisigPrefs.persist.getOptions().partialize;
		expect(
			partialize?.({
				...useMultisigPrefs.getState(),
				provenanceClosed: ["testnet:0xabc"],
			}),
		).toMatchObject({ provenanceClosed: ["testnet:0xabc"] });
	});

	it("close a panel once, whatever is clicked twice", () => {
		const { closeProvenance } = useMultisigPrefs.getState();
		const at = "0x00000000000000000000000000000000000000aa" as Address;
		closeProvenance("testnet", at);
		closeProvenance("testnet", at);
		expect(useMultisigPrefs.getState().provenanceClosed).toEqual([
			"testnet:0x00000000000000000000000000000000000000aa",
		]);
	});

	it("keep the first-sign line apart from the card, read as before for an old choice", () => {
		expect(restore({ walkthroughSeen: true }).firstSignSeen).toBe(true);
		expect(restore({ firstSignSeen: true }).firstSignSeen).toBe(true);
		expect(restore({}).firstSignSeen).toBe(false);
		// the warning of old is gone: nothing of it is kept
		expect(
			(restore({ warningSeen: true }) as unknown as Record<string, unknown>)
				.warningSeen,
		).toBeUndefined();
	});

	it("fold and unfold the card, and let 'Got it' fold it too", () => {
		const s = useMultisigPrefs.getState();
		s.setWalkthroughFolded(true);
		expect(useMultisigPrefs.getState().walkthroughSeen).toBe(true);
		s.setWalkthroughFolded(false);
		expect(useMultisigPrefs.getState().walkthroughSeen).toBe(false);
		s.dismissFirstSign();
		expect([
			useMultisigPrefs.getState().firstSignSeen,
			useMultisigPrefs.getState().walkthroughSeen,
		]).toEqual([true, true]);
		// unfolding the card does not bring the line back
		s.setWalkthroughFolded(false);
		expect(useMultisigPrefs.getState().firstSignSeen).toBe(true);
	});
});
