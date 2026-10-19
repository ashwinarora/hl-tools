import { describe, expect, it } from "vitest";
import {
	hasHidden,
	isolated,
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

describe("what does not show, beyond the control characters", () => {
	const cp = (...codes: number[]) => String.fromCodePoint(...codes);
	it.each<[string, string]>([
		["a Hangul filler, a letter by its category", cp(0x3164)],
		["the other fillers", cp(0x115f, 0x1160, 0xffa0)],
		["the braille pattern with no dot", cp(0x2800)],
		["a variation selector", cp(0xfe0f)],
		["a variation selector of the supplement", cp(0xe0100)],
		["the combining grapheme joiner", cp(0x34f)],
		["a private-use character", cp(0xe000)],
		["a zero-width joiner", cp(0x200d)],
	])("%s is dropped", (_name, hidden) => {
		expect(shownLine(`Hy${hidden}purr`)).toBe("Hypurr");
		expect(hasHidden(`Hy${hidden}purr`)).toBe(true);
	});
	it("half a surrogate pair is dropped, and a whole pair is kept", () => {
		// a string with a lone half cannot be put into a link at all
		const half = String.fromCharCode(0xd83d);
		expect(shownLine(`a${half}b`)).toBe("ab");
		expect(() => encodeURIComponent(shownLine(`a${half}b`))).not.toThrow();
		expect(shownLine("a😀b")).toBe("a😀b");
	});
	it("every kind of space is one space", () => {
		const spaces = cp(0xa0, 0x2003, 0x202f, 0x3000);
		expect(shownLine(`a${spaces}b`)).toBe("a b");
	});
	it("a letter keeps a few combining marks, not a pile of them", () => {
		const acute = cp(0x301);
		const dot = cp(0x323);
		expect(shownLine(`e${acute}`)).toBe("é");
		const piled = shownLine(`x${dot.repeat(40)}`);
		expect([...piled]).toHaveLength(4);
	});
	it("gives the same text when done twice (a title is cleaned when made and again when read)", () => {
		const zwj = cp(0x200d);
		const acute = cp(0x301);
		for (const raw of [
			// composes only once the joiner between the two is gone
			`a${zwj}${acute}`,
			`  Pay ${cp(0x202e)} rent${cp(0x2028)}now `,
			`x${cp(0x323).repeat(9)}${acute.repeat(9)}`,
			`${cp(0x5e9, 0x5dc, 0x5d5, 0x5dd)} (0x12…34)`,
			"plain",
			"",
		]) {
			const once = shownLine(raw);
			expect(shownLine(once)).toBe(once);
			const cutOnce = shownLine(raw, 3);
			expect(shownLine(cutOnce, 3)).toBe(cutOnce);
			const note = shownNote(`${raw}\n\n\n${raw}`);
			expect(shownNote(note)).toBe(note);
		}
		expect(shownLine(`a${zwj}${acute}`)).toBe("á");
	});
});

describe("a label inside a sentence", () => {
	const cp = (...codes: number[]) => String.fromCodePoint(...codes);
	const FSI = cp(0x2068);
	const PDI = cp(0x2069);
	it("is closed off when it holds letters written right to left", () => {
		// with no hidden character at all, such a name moves the address after it
		const hebrew = cp(0x5e9, 0x5dc, 0x5d5, 0x5dd);
		const arabic = cp(0x645, 0x631, 0x62d, 0x628, 0x627);
		expect(isolated(hebrew)).toBe(`${FSI}${hebrew}${PDI}`);
		expect(isolated(`Bank ${arabic}`)).toBe(`${FSI}Bank ${arabic}${PDI}`);
		// a supplementary right-to-left script (Adlam)
		expect(isolated(cp(0x1e900))).toBe(`${FSI}${cp(0x1e900)}${PDI}`);
	});
	it("is left as it is otherwise", () => {
		for (const plain of ["Hypurr", "Zürich 東京 ✓", "", "a😀b"])
			expect(isolated(plain)).toBe(plain);
	});
	it("does not survive being cleaned as a label: it is for the sentence only", () => {
		const hebrew = cp(0x5e9, 0x5dc);
		expect(shownLine(isolated(hebrew))).toBe(hebrew);
	});
});
