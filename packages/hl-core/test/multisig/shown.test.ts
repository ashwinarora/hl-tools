import { describe, expect, it } from "vitest";
import {
	hasHidden,
	shownLine,
	shownNote,
	visibleText,
} from "../../src/multisig/shown.ts";

// built from code points, so that this file holds no hidden character itself
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const LRI = String.fromCodePoint(0x2066);
const BOM = String.fromCodePoint(0xfeff);
const SOFT = String.fromCodePoint(0xad);
const LINE_SEP = String.fromCodePoint(0x2028);
const NUL = String.fromCodePoint(0);
const BELL = String.fromCodePoint(7);
const UMLAUT = String.fromCodePoint(0x308);

describe("a label somebody else wrote", () => {
	it("loses the characters that do not show", () => {
		// a validator's name that would turn the address printed after it around
		expect(shownLine(`Hypurr${RLO}`)).toBe("Hypurr");
		expect(shownLine(`Hy${ZWSP}purr`)).toBe("Hypurr");
		expect(shownLine(`${LRI}Pay ${SOFT}rent${BOM}`)).toBe("Pay rent");
		expect(shownLine(`a${NUL}b${BELL}c`)).toBe("abc");
	});
	it("is one line with single spaces", () => {
		expect(shownLine("  Pay \t rent\nto  Ada ")).toBe("Pay rent to Ada");
		expect(shownLine(`one${LINE_SEP}two`)).toBe("one two");
		// a hidden character between two spaces leaves one space
		expect(shownLine(`a ${ZWSP} b`)).toBe("a b");
	});
	it("keeps what does show, in any script", () => {
		expect(shownLine("Zürich ✓ 東京 مرحبا")).toBe("Zürich ✓ 東京 مرحبا");
		// compatibility forms are left alone: a superscript is not made a digit
		expect(shownLine("10² USDC")).toBe("10² USDC");
		// composed and decomposed forms of one letter become one
		expect(shownLine(`u${UMLAUT}`)).toBe("ü");
	});
	it("is cut to a number of characters, never inside one", () => {
		expect(shownLine("abcdef", 3)).toBe("abc…");
		expect(shownLine("abc", 3)).toBe("abc");
		expect(shownLine("😀😀😀😀", 2)).toBe("😀😀…");
	});
	it("can be empty", () => {
		expect(shownLine(`${RLO}${ZWSP} `)).toBe("");
	});
});

describe("a note of several lines", () => {
	it("keeps its line breaks and loses the rest", () => {
		expect(shownNote(`first ${RLO}line\r\n  second\tline \n`)).toBe(
			"first line\nsecond line",
		);
		expect(shownNote(`a${LINE_SEP}b\rc`)).toBe("a\nb\nc");
		expect(shownNote("a\n\n\n\n\nb")).toBe("a\n\nb");
		expect(shownNote("abcdef", 4)).toBe("abcd…");
	});
});

describe("a value that is signed", () => {
	it("is shown whole, with each hidden character written out", () => {
		expect(visibleText(`bot${RLO}1`)).toBe("bot\\u{202e}1");
		expect(visibleText(`a${ZWSP}b\nc`)).toBe("a\\u{200b}b\\u{a}c");
		expect(visibleText("plain name 1")).toBe("plain name 1");
	});
	it("says whether there is anything hidden, call after call", () => {
		expect(hasHidden(`a${RLO}`)).toBe(true);
		expect(hasHidden(`a${RLO}`)).toBe(true);
		expect(hasHidden("a b")).toBe(false);
	});
});
