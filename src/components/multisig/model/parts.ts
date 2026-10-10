/**
 * A sentence as parts. The models build sentences that name addresses and
 * moments; a screen may then show an address with its nickname and a moment
 * in the reader's own time zone, while `text` stays the plain rendering (a
 * shortened address, UTC) that tests, exports and tooltips read.
 */
export interface Part {
	readonly text: string;
	/** This part names an address (`text` is how it reads without a nickname). */
	readonly who?: string;
	/** This part is a moment, unix ms (`text` is that moment in UTC). */
	readonly when?: number;
	/** The action line of a proposal. */
	readonly strong?: boolean;
	/** A proposal's title: unsigned, shown only to tell like actions apart. */
	readonly quiet?: boolean;
}

export const part = (text: string): Part => ({ text });

export function partsText(parts: readonly Part[]): string {
	return parts.map((p) => p.text).join("");
}

/** Parts joined by a separator, like `Array.join`. */
export function joinParts(
	items: readonly (readonly Part[])[],
	separator: string,
): Part[] {
	const out: Part[] = [];
	items.forEach((item, i) => {
		if (i > 0) out.push(part(separator));
		out.push(...item);
	});
	return out;
}

/**
 * A sentence from fixed text and parts: ``say`Withdrawn by ${who}.` ``. A
 * string value is fixed text too; an array is spliced in.
 */
export function say(
	strings: TemplateStringsArray,
	...values: readonly (Part | readonly Part[] | string)[]
): Part[] {
	const out: Part[] = [];
	const push = (p: Part) => {
		if (p.text === "") return;
		const last = out[out.length - 1];
		// neighbouring plain text is one part: a sentence reads the same either way
		if (last && isPlain(last) && isPlain(p))
			out[out.length - 1] = part(last.text + p.text);
		else out.push(p);
	};
	strings.forEach((s, i) => {
		push(part(s));
		const v = values[i];
		if (v === undefined) return;
		if (typeof v === "string") push(part(v));
		else if (Array.isArray(v)) for (const p of v as readonly Part[]) push(p);
		else push(v as Part);
	});
	return out;
}

const isPlain = (p: Part) =>
	p.who === undefined &&
	p.when === undefined &&
	p.strong === undefined &&
	p.quiet === undefined;
