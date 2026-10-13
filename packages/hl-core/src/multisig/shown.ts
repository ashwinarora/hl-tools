/**
 * Text that somebody else wrote, before it is put into a sentence. Pure.
 *
 * A validator names itself on chain, a vault's leader names the vault, a
 * proposer writes a title that nobody signs. Some characters do not show and
 * change what the reader sees: a "right-to-left override" turns the address
 * printed after a name around, a zero-width space makes two names look alike.
 *
 * Two answers, by what the text is:
 *  - a label (`shownLine`, `shownNote`): the hidden characters are dropped.
 *  - a value that is signed or that names something exactly (`visibleText`):
 *    nothing is dropped, each hidden character is written out, so that what
 *    is on screen is what is in the action.
 */

/**
 * Controls (Cc), line and paragraph separators (Zl, Zp), and every "format"
 * character (Cf): zero-width ones, direction marks, overrides and isolates,
 * the byte-order mark, the soft hyphen.
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const LINE_BREAK = /\r\n|[\r\n\p{Zl}\p{Zp}]/u;

function cut(text: string, max: number | undefined): string {
	if (max === undefined) return text;
	const chars = [...text];
	return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

/** A label on one line: hidden characters dropped, white space made one space, cut to `max` characters. */
export function shownLine(raw: string, max?: number): string {
	const line = raw
		.normalize("NFC")
		.replace(/\s+/g, " ")
		.replace(HIDDEN, "")
		.replace(/ {2,}/g, " ")
		.trim();
	return cut(line, max);
}

/** A label of several lines: each line as `shownLine` has it, the line breaks kept. */
export function shownNote(raw: string, max?: number): string {
	const note = raw
		.split(LINE_BREAK)
		.map((line) => shownLine(line))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return cut(note, max);
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
