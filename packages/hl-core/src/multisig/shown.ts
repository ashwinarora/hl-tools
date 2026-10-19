/**
 * Text that somebody else wrote, before it is put into a sentence. Pure.
 *
 * A validator names itself on chain, a vault's leader names the vault, a
 * proposer writes a title that nobody signs. Some characters do not show and
 * change what the reader sees: a "right-to-left override" turns the address
 * printed after a name around, a zero-width space makes two names look alike.
 *
 * Three answers, by what the text is and where it goes:
 *  - a label (`shownLine`, `shownNote`): the hidden characters are dropped.
 *  - a value that is signed or that names something exactly (`visibleText`):
 *    nothing is dropped, each hidden character is written out, so that what
 *    is on screen is what is in the action.
 *  - a label inside a sentence (`isolated`): letters written right to left
 *    reorder the digits, brackets and dots beside them with no hidden
 *    character at all, so such a label is closed off from its neighbours.
 *
 * What none of this does: tell a letter from its look-alike in another
 * script. A label is never the proof of anything; the address beside it is.
 */

/** The braille pattern with no dot: a symbol by its category, and nothing to see. */
const BRAILLE_BLANK = String.fromCodePoint(0x2800);

/**
 * What does not show: controls (Cc), "format" characters (Cf: zero-width
 * ones, direction marks, overrides and isolates, the byte-order mark, the
 * soft hyphen), line and paragraph separators (Zl, Zp), halves of a surrogate
 * pair (Cs), private-use characters (Co), and everything Unicode marks as
 * ignorable by default (fillers that count as letters, variation selectors,
 * the combining grapheme joiner).
 *
 * Zero-width joiners go with the rest, which costs a label its joined emoji
 * and some Persian and Indic spellings their exact form. For a label nobody
 * signed that is the cheaper mistake.
 */
const HIDDEN = new RegExp(
	String.raw`[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Default_Ignorable_Code_Point}${BRAILLE_BLANK}]`,
	"gu",
);
const LINE_BREAK = /\r\n|[\r\n\p{Zl}\p{Zp}]/u;
/** More combining marks on one letter than any spelling needs: they pile up over the lines around. */
const MARK_RUN = /(\p{M}{3})\p{M}+/gu;

/** A text cut to `max` characters, never inside one: a cut by code units can leave half a surrogate pair. */
export function cutTo(text: string, max: number | undefined): string {
	if (max === undefined) return text;
	const chars = [...text];
	return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

/**
 * A label on one line: white space of every kind made one space, hidden
 * characters dropped, then composed (in that order, so that doing it twice
 * changes nothing), cut to `max` characters.
 */
export function shownLine(raw: string, max?: number): string {
	const line = raw
		.replace(/\s+/g, " ")
		.replace(HIDDEN, "")
		.normalize("NFC")
		.replace(MARK_RUN, "$1")
		.replace(/ {2,}/g, " ")
		.trim();
	return cutTo(line, max);
}

/** A label of several lines: each line as `shownLine` has it, the line breaks kept. */
export function shownNote(raw: string, max?: number): string {
	const note = raw
		.split(LINE_BREAK)
		.map((line) => shownLine(line))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return cutTo(note, max);
}

/** Whether a text holds a character that does not show. */
export function hasHidden(raw: string): boolean {
	return raw.search(HIDDEN) !== -1;
}

/** A value as it is, with each character that does not show written out, as in "a\u{202e}b". */
export function visibleText(raw: string): string {
	return raw.replace(
		HIDDEN,
		(c) => `\\u{${(c.codePointAt(0) as number).toString(16)}}`,
	);
}

/** Where the scripts written right to left live: Hebrew to Arabic Extended, their presentation forms, and the two supplementary ranges. */
const RIGHT_TO_LEFT: readonly (readonly [number, number])[] = [
	[0x0590, 0x08ff],
	[0xfb1d, 0xfdff],
	[0xfe70, 0xfeff],
	[0x10800, 0x10fff],
	[0x1e800, 0x1efff],
];
const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068);
const POP_ISOLATE = String.fromCodePoint(0x2069);

/**
 * A label about to be put into a sentence. One that holds letters written
 * right to left is closed off in an isolate, so that it cannot move the
 * address, the bracket or the amount printed next to it; any other label is
 * returned as it is. For the text of a sentence only: never store the result.
 */
export function isolated(label: string): string {
	for (const ch of label) {
		const c = ch.codePointAt(0) as number;
		if (RIGHT_TO_LEFT.some(([from, to]) => c >= from && c <= to))
			return `${FIRST_STRONG_ISOLATE}${label}${POP_ISOLATE}`;
	}
	return label;
}
