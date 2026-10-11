/**
 * Every sentence of "Change signers": the form that replaces a treasury's
 * signer list and the number that must sign, through one proposal. Kept here
 * so the wording is tested like the wizard's (`create.ts`) and uses the same
 * three levels: blocked only where Hyperliquid would refuse, a warning as one
 * line with no click, and plain facts.
 */

export const CHANGE = {
	/** On the treasury's Signers card. */
	linkLabel: "Change signers",
	signersTitle: "Signers after the change",
	remove: "Remove",
	undo: "Undo",
	you: "you",
	added: "new",
	whatChanges: "What changes",
	nothing: "Nothing changes yet.",
	/** Who has to approve it: the signers of now, by the number of now. */
	whoDecides: (k: number, n: number) =>
		`The current signers decide this: ${
			n === 1
				? "the one signer"
				: k === n
					? `all ${n} of them`
					: `any ${k} of the ${n}`
		}. Someone who is being removed can still sign it.`,
	takesEffect:
		"It takes effect the moment Hyperliquid accepts the proposal. Until then nothing changes.",
	/** On the proposal's page: what the comparison is made with. */
	againstNow:
		"Compared with the signers Hyperliquid reports for this treasury now.",
	// What the change does to the proposals still waiting.
	affectedTitle: "Waiting proposals this changes",
	affectedNone: "No waiting proposal is affected.",
	affectedReading: "Reading the waiting proposals…",
	/** The record kept with the relay could not be read. */
	affectedPartial:
		"Only the proposals kept in this browser could be checked. The others could not be read just now.",
	/** Nothing but this browser's copies exists to check (links and files). */
	affectedLocal:
		"Checked against the proposals this browser has opened. One that was passed around as a link or a file and never opened here is not known.",
} as const;
