import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, TREASURY } from "#/test/keys";
import {
	countNeeds,
	countOpen,
	groupInbox,
	type InboxEntry,
	inboxGroup,
	needsMe,
} from "./inbox";

const OTHER = "0x00000000000000000000000000000000000000aa" as Address;
let n = 0;
const entry = (over: Partial<InboxEntry> = {}): InboxEntry => ({
	network: "testnet",
	treasury: TREASURY,
	digest: `0x${(++n).toString(16).padStart(64, "0")}`,
	createdBy: A,
	finaliser: B,
	counted: [],
	threshold: 2,
	open: true,
	frozen: false,
	...over,
});

describe("a treasury that is no longer a multi-sig", () => {
	// found in the browser: its proposals kept asking for signatures nobody can give
	const stuck = [
		entry({ finaliser: A, counted: [B], frozen: true }),
		entry({ finaliser: C, frozen: true }),
		entry({ finaliser: A, counted: [A, B], frozen: true }),
	];

	it("asks nobody for anything", () => {
		for (const e of stuck) {
			expect(inboxGroup(e, A)).toBeNull();
			expect(needsMe(e, A)).toBe(false);
		}
		expect(countNeeds(stuck, A, "testnet")).toBe(0);
		expect(groupInbox(stuck, A, "testnet")).toEqual({
			finish: [],
			sign: [],
			waiting: [],
		});
	});

	it("still counts them as that treasury's pending proposals", () => {
		expect(countOpen(stuck, "testnet", TREASURY)).toBe(3);
	});
});

describe("inboxGroup", () => {
	it("asks a signer who has not signed for a signature", () => {
		expect(inboxGroup(entry({ finaliser: C }), A)).toBe("sign");
		expect(inboxGroup(entry({ finaliser: C, counted: [B] }), A)).toBe("sign");
	});

	it("lets a signer who signed wait", () => {
		expect(inboxGroup(entry({ finaliser: C, counted: [A] }), A)).toBe(
			"waiting",
		);
	});

	it("does not ask for a signature that is no longer needed", () => {
		expect(inboxGroup(entry({ finaliser: C, counted: [B, C] }), A)).toBe(
			"waiting",
		);
	});

	it("tells the finaliser to finish once the threshold is met", () => {
		expect(inboxGroup(entry({ counted: [A, C] }), B)).toBe("finish");
		expect(inboxGroup(entry({ counted: [A, B] }), B)).toBe("finish");
	});

	it("tells the finaliser to finish when their own signature is the last one missing", () => {
		expect(inboxGroup(entry({ counted: [A] }), B)).toBe("finish");
		expect(inboxGroup(entry({ threshold: 1 }), B)).toBe("finish");
	});

	it("asks the finaliser for a signature when more than theirs is missing", () => {
		expect(inboxGroup(entry({ threshold: 3 }), B)).toBe("sign");
		expect(inboxGroup(entry({ threshold: 3, counted: [A] }), B)).toBe("sign");
		expect(inboxGroup(entry({ threshold: 3, counted: [A, C] }), B)).toBe(
			"finish",
		);
	});

	it("lets the finaliser wait when they signed and others have not", () => {
		expect(inboxGroup(entry({ counted: [B] }), B)).toBe("waiting");
	});

	it("has nothing to say about a proposal that is over", () => {
		expect(inboxGroup(entry({ open: false }), A)).toBeNull();
		expect(needsMe(entry({ open: false }), A)).toBe(false);
	});

	it("needs you for 'finish' and 'sign', not for 'waiting'", () => {
		expect(needsMe(entry({ counted: [A] }), B)).toBe(true);
		expect(needsMe(entry({ finaliser: C }), A)).toBe(true);
		expect(needsMe(entry({ finaliser: C, counted: [A] }), A)).toBe(false);
	});
});

describe("groupInbox and counts", () => {
	const entries = [
		entry({ counted: [A] }), // B: finish
		entry({ finaliser: C }), // B: sign
		entry({ finaliser: C, counted: [B] }), // B: waiting
		entry({ open: false }), // nothing
		entry({ treasury: OTHER, finaliser: C }), // B: sign, other treasury
		entry({ network: "mainnet", finaliser: C }), // B: sign, other network
	];

	it("sorts one network's open proposals into the three groups, keeping their order", () => {
		const g = groupInbox(entries, B, "testnet");
		expect(g.finish).toEqual([entries[0]]);
		expect(g.sign).toEqual([entries[1], entries[4]]);
		expect(g.waiting).toEqual([entries[2]]);
	});

	it("counts what needs the wallet, per network and per treasury", () => {
		expect(countNeeds(entries, B, "testnet")).toBe(3);
		expect(countNeeds(entries, B, "testnet", TREASURY)).toBe(2);
		expect(countNeeds(entries, B, "testnet", OTHER)).toBe(1);
		expect(countNeeds(entries, B, "mainnet")).toBe(1);
		expect(countNeeds([], B, "testnet")).toBe(0);
	});

	it("counts a treasury's open proposals whoever they wait for", () => {
		expect(countOpen(entries, "testnet", TREASURY)).toBe(3);
		expect(countOpen(entries, "testnet", OTHER)).toBe(1);
		expect(countOpen(entries, "mainnet", OTHER)).toBe(0);
	});
});
