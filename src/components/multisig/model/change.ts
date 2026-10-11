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
} as const;
