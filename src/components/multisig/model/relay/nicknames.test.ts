import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import { A, B, C, OUTSIDER, TREASURY } from "#/test/keys";
import {
	acceptNicknames,
	canNickname,
	NICKNAME_MAX,
	type NicknameRow,
	nicknameKey,
	nicknameProblem,
	nicknameRefusal,
	nicknameText,
} from "./nicknames";

const DEST = "0x00000000000000000000000000000000000000d1" as Address;
const DEST2 = "0x00000000000000000000000000000000000000d2" as Address;
const OTHER_TREASURY = "0x00000000000000000000000000000000000000f0" as Address;
const cp = (n: number) => String.fromCodePoint(n);

describe("the rules", () => {
	it("tidies a name: folded, one space, no ends", () => {
		expect(nicknameText("  Ops \t  lead \n")).toBe("Ops lead");
		expect(nicknameText("\uFF26\uFF55\uFF4C\uFF4C")).toBe("Full");
		expect(nicknameKey("  AUDITOR ")).toBe("auditor");
	});
	it("accepts ordinary names in any script", () => {
		for (const ok of [
			"Auditor",
			"Ops lead (Berlin) #2",
			"B\u00FCro Z\u00FCrich \u6771\u4EAC",
			"a".repeat(NICKNAME_MAX),
			"Box 0 x-ray",
			"You two",
		])
			expect(nicknameProblem(ok)).toBeNull();
	});
	it("refuses what the relay refuses, in the relay's words", () => {
		expect(nicknameProblem("")).toBe("A nickname cannot be empty.");
		expect(nicknameProblem("a".repeat(NICKNAME_MAX + 1))).toBe(
			"A nickname can be at most 40 characters.",
		);
		for (const addressLike of [
			"0x5e7c3420160987d04db5e8ed6d5bc14f61237216",
			"0x5e7c\u20267216",
			"Alice 0Xb0",
			"pay 0xa",
		])
			expect(nicknameProblem(addressLike)).toBe(
				"A nickname cannot look like an address.",
			);
		for (const reserved of ["you", "You", "SOMEONE"])
			expect(nicknameProblem(reserved)).toBe(
				"That word is used by the screens themselves.",
			);
		for (const hidden of [
			`Alice${cp(0x202e)}ecila`,
			`Al${cp(0x200b)}ice`,
			`Alice${cp(0x2066)}`,
			`Al${cp(7)}ice`,
			`${cp(0xfeff)}Alice`,
		])
			expect(nicknameProblem(hidden)).toBe(
				"A nickname cannot contain invisible or direction-changing characters.",
			);
	});
	it("counts characters, not code units", () => {
		expect(nicknameProblem("\u{1F600}".repeat(NICKNAME_MAX))).toBeNull();
		expect(
			nicknameProblem("\u{1F600}".repeat(NICKNAME_MAX + 1)),
		).not.toBeNull();
	});
});

describe("acceptNicknames", () => {
	const row = (over: Partial<NicknameRow> = {}): NicknameRow => ({
		network: "testnet",
		treasury: TREASURY,
		address: DEST,
		name: "Auditor",
		setBy: A,
		setAt: 1000,
		...over,
	});
	const of = {
		network: "testnet" as const,
		treasury: TREASURY,
		signers: [A, B, C],
	};
	const names = (rows: NicknameRow[]) =>
		Object.fromEntries(
			[...acceptNicknames(rows, of)].map(([a, n]) => [a, n.name]),
		);

	it("shows a treasury its own nicknames, with who gave them and when", () => {
		expect(acceptNicknames([row()], of).get(DEST)).toEqual({
			name: "Auditor",
			setBy: A,
			setAt: 1000,
		});
	});
	it("never shows a nickname outside the treasury it was given in", () => {
		expect(
			names([
				row({ treasury: OTHER_TREASURY }),
				row({ network: "mainnet", address: DEST2, name: "Lawyer" }),
			]),
		).toEqual({});
	});
	it("ignores a row the relay should never have had", () => {
		expect(
			names([
				row({ name: "0x5e7c\u20267216" }),
				row({ address: DEST2, name: "  untidy " }),
				row({ address: OUTSIDER, name: "You" }),
				row({ address: OTHER_TREASURY, name: "x".repeat(41) }),
			]),
		).toEqual({});
	});
	it("accepts a signer's nickname only from that signer", () => {
		expect(
			names([
				row({ address: A, name: "Alice", setBy: A }),
				row({ address: B, name: "Boss", setBy: A }),
			]),
		).toEqual({ [A]: "Alice" });
		// judged against the signer list the page trusts: not a signer there, anyone may name it
		expect([
			...acceptNicknames([row({ address: B, name: "Boss", setBy: A })], {
				...of,
				signers: [A, C],
			}).keys(),
		]).toEqual([B]);
	});
	it("gives a name to one address only: the earlier one keeps it", () => {
		expect(
			names([
				row({ address: DEST2, name: "AUDITOR", setAt: 2000 }),
				row({ address: DEST, name: "Auditor", setAt: 1000 }),
			]),
		).toEqual({ [DEST]: "Auditor" });
		// and one address has one name
		expect(
			names([row({ setAt: 1000 }), row({ name: "Second", setAt: 2000 })]),
		).toEqual({ [DEST]: "Auditor" });
	});
});

describe("canNickname", () => {
	const signers = [A, B, C];
	it("lets a signer name their own address and anything that is not another signer", () => {
		expect(canNickname(A, A, signers)).toBe(true);
		expect(canNickname(A, DEST, signers)).toBe(true);
		expect(canNickname(A, TREASURY, signers)).toBe(true);
		expect(canNickname(A, B, signers)).toBe(false);
	});
	it("lets nobody else name anything", () => {
		expect(canNickname(OUTSIDER, DEST, signers)).toBe(false);
		expect(canNickname(OUTSIDER, OUTSIDER, signers)).toBe(false);
		expect(canNickname(null, DEST, signers)).toBe(false);
	});
});

describe("nicknameRefusal", () => {
	const current = new Map([[DEST, { name: "Auditor", setBy: A, setAt: 1 }]]);
	it("says before asking the relay why a name would be refused", () => {
		expect(nicknameRefusal({ raw: " auditor ", address: DEST2, current })).toBe(
			"Another address in this treasury already has that nickname.",
		);
		expect(nicknameRefusal({ raw: "0xabc", address: DEST2, current })).toBe(
			"A nickname cannot look like an address.",
		);
		expect(nicknameRefusal({ raw: "   ", address: DEST2, current })).toBe(
			"A nickname cannot be empty.",
		);
	});
	it("lets the address that has a name keep or respell it, and a free name through", () => {
		expect(
			nicknameRefusal({ raw: "AUDITOR", address: DEST, current }),
		).toBeNull();
		expect(
			nicknameRefusal({ raw: "Lawyer", address: DEST2, current }),
		).toBeNull();
	});
});
