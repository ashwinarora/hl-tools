/**
 * Numbered marks drawn over the docs' screenshots, kept apart from the
 * pictures so a re-shot picture only needs its boxes moved. The page draws a
 * thin outline and a numbered dot for each, and lists the labels under the
 * picture; the Markdown copy lists the same labels (`src/lib/docs/remark.ts`).
 *
 * Boxes are in the picture's own pixels: [left, top, width, height].
 * No React here: the docs' tests and the remark step read this file too.
 */

export interface Mark {
	readonly box: readonly [number, number, number, number];
	/** What to look at, in a few words, as it reads on screen. */
	readonly label: string;
}

export const MARKS: Readonly<Record<string, readonly Mark[]>> = {
	"/docs/img/ms-treasury.webp": [
		{ box: [1849, 63, 277, 68], label: "Propose an action" },
		{ box: [16, 220, 2192, 248], label: "What the treasury holds, live" },
		{
			box: [16, 506, 1086, 75],
			label: "Pending, Staking, Vaults and the record",
		},
		{ box: [1492, 617, 715, 723], label: "Signers, and how many must sign" },
	],
	"/docs/img/ms-inbox.webp": [
		{
			box: [576, 167, 2193, 188],
			label: "Ready for you to finish: you send it",
		},
		{ box: [576, 432, 2193, 185], label: "Waiting for your signature" },
		{ box: [576, 649, 2193, 233], label: "Waiting on others" },
		{ box: [17, 419, 495, 279], label: "My treasuries" },
	],
	"/docs/img/ms-propose-send.webp": [
		{
			box: [42, 440, 1270, 352],
			label: "The destination, and what Hyperliquid knows of it",
		},
		{ box: [42, 1062, 1270, 117], label: "The amount, or Max" },
		{
			box: [1388, 11, 813, 802],
			label: "Preview: what every signer will sign",
		},
		{ box: [1416, 957, 728, 68], label: "Create and sign, or sign later" },
	],
	"/docs/img/ms-create.webp": [
		{ box: [17, 213, 1335, 401], label: "The account you are converting" },
		{
			box: [17, 648, 1335, 698],
			label: "Who signs, each checked on Hyperliquid",
		},
		{
			box: [17, 1380, 1335, 438],
			label: "How many must sign, and what it means",
		},
		{ box: [1395, 923, 813, 278], label: "What changes, then Convert" },
	],
	"/docs/img/ms-proposal-sign.webp": [
		{ box: [20, 169, 1424, 138], label: "Where it stands: 1 of 2 signatures" },
		{
			box: [28, 456, 905, 256],
			label: "The amount and the destination, in full",
		},
		{
			box: [34, 964, 1392, 300],
			label: "The treasury, destination and finaliser, written out",
		},
		{ box: [50, 1777, 484, 79], label: "Sign as 0x…, or Say no" },
	],
	"/docs/img/ms-vault-code.webp": [
		{ box: [43, 322, 1323, 258], label: "The code your wallet must show" },
		{ box: [1193, 171, 147, 43], label: "The network: testnet shows source b" },
		{
			box: [42, 605, 530, 67],
			label: "Switch to the signing network and sign",
		},
	],
	"/docs/img/tool-signing.webp": [
		{
			box: [47, 510, 875, 559],
			label: "Paste the action or the whole request",
		},
		{ box: [997, 21, 422, 189], label: "Which signing scheme applies" },
		{
			box: [1446, 21, 870, 189],
			label: "The address the signature recovers to",
		},
		{
			box: [1031, 419, 1251, 162],
			label: "What Hyperliquid would hash or refuse",
		},
	],
	"/docs/img/tool-trace.webp": [
		{ box: [14, 12, 2302, 167], label: "The network and when it was read" },
		{
			box: [14, 307, 2302, 315],
			label: "Four steps, each observed or inferred",
		},
		{ box: [14, 655, 1135, 861], label: "What the action should have done" },
		{ box: [1182, 655, 1133, 861], label: "What HyperCore shows it did" },
	],
	"/docs/img/tool-orders.webp": [
		{
			box: [14, 12, 434, 65],
			label: "Compose an order, or explain a response",
		},
		{ box: [47, 370, 875, 372], label: "Paste the response or the error" },
		{ box: [997, 283, 1319, 524], label: "The cause and the fix, per order" },
		{ box: [47, 1187, 797, 117], label: "Samples to try it with" },
	],
};

export function marksOf(src: string): readonly Mark[] {
	return MARKS[src] ?? [];
}
