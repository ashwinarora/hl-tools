/**
 * The amount a sentence about an action names, so a page can set it as the
 * largest figure. Only the action's own amount counts: the figure right
 * after the verb ("Send 1 USDC to …", "Stake 100 HYPE with …"), and never
 * one inside words somebody else wrote. Names and titles (an API wallet's
 * name, a validator's, a vault's) are quoted in these sentences, so nothing
 * from the first quotation mark on is looked at: an API wallet named
 * "pay 50 USDC daily" must not read as a payment of 50 USDC.
 */

/** Where somebody else's words begin. */
const QUOTED = /["“”«»]/;

/** At most two words (the verb), then a figure and its unit. */
const OWN_AMOUNT =
	/^((?:\S+ ){0,2})(\d[\d,]*(?:\.\d+)?) ([A-Z][A-Z0-9]{1,11})(?=$|[\s),.;:])/;

export interface AmountCut {
	/** The words before the figure, as written ("Send"); empty when it opens the sentence. */
	readonly before: string;
	readonly figure: string;
	readonly unit: string;
	/** The rest of the sentence, word for word. */
	readonly after: string;
}

/** The sentence cut around its own amount, the words kept exactly; null when it names none. */
export function amountIn(text: string): AmountCut | null {
	const quote = text.search(QUOTED);
	const own = quote === -1 ? text : text.slice(0, quote);
	const m = OWN_AMOUNT.exec(own);
	if (!m) return null;
	return {
		before: (m[1] ?? "").trimEnd(),
		figure: m[2] ?? "",
		unit: m[3] ?? "",
		after: text.slice(m[0].length).trimStart(),
	};
}
