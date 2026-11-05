/**
 * The drawn wallet prompts of the docs: what a wallet shows when a signer
 * signs, field by field, with the ones to check numbered. The page draws them
 * (`src/components/docs/WalletPrompt.tsx`) and the Markdown copy lists the
 * same rows (`remark.ts`). No React here.
 *
 * The field names are Hyperliquid's own (core `rules/signing.ts`); the values
 * are made up and only have the right shape.
 */

export interface PromptRow {
	readonly field: string;
	readonly value: string;
	/** Set on a row to check: what to compare it with, in a few words. */
	readonly check?: string;
}

export interface Prompt {
	/** The network line at the top, when the prompt names one. */
	readonly network?: { readonly value: string; readonly check?: string };
	/** The message's type, as the wallet titles it. */
	readonly message: string;
	readonly rows: readonly PromptRow[];
	/** One line on what the picture shows (its alt text and the Markdown's). */
	readonly alt: string;
}

const TREASURY = "0x7a1c5e0b2d94f3a8c61e07b9d24f58a3e9c0b417";
const FINALISER = "0x3f9be12a7c40d58e6b21a93c0f7d4e85b2a61c90";
const DESTINATION = "0xb52e8d0c47a19f36e2d5b08a4c71f9e3d6a20c58";
/** USDC's token name and id on testnet (mainnet's is in the send prompt). */
const TESTNET_USDC = "USDC:0xeb62eee3685fc4c43992febcd9e75443";

export const PROMPTS = {
	send: {
		message: "HyperliquidTransaction:SendAsset",
		alt: "A wallet asking to sign a payment from the treasury: the treasury, the finaliser, the destination, the token and the amount are the fields to check.",
		rows: [
			{ field: "hyperliquidChain", value: "Mainnet" },
			{
				field: "payloadMultiSigUser",
				value: TREASURY,
				check: "The treasury, as on the page",
			},
			{
				field: "outerSigner",
				value: FINALISER,
				check: "The finaliser, as on the page",
			},
			{
				field: "destination",
				value: DESTINATION,
				check: "The destination, every character",
			},
			{ field: "sourceDex", value: "" },
			{ field: "destinationDex", value: "" },
			{
				field: "token",
				value: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
				check: "The token",
			},
			{ field: "amount", value: "2500", check: "The amount" },
			{ field: "fromSubAccount", value: "" },
			{ field: "nonce", value: "1761734205118" },
		],
	},
	finaliser: {
		message: "HyperliquidTransaction:SendMultiSig",
		alt: "A wallet asking the finaliser to sign the send: a hash of the proposal and its signatures, and the proposal number.",
		rows: [
			{ field: "hyperliquidChain", value: "Mainnet" },
			{
				field: "multiSigActionHash",
				value:
					"0x9c41e0d7a25b63f8e1c094ab7d52f3e6081b4c9da7e2f5306b8c1d4e9a72f0b3",
				check: "The proposal and its signatures, as one hash",
			},
			{
				field: "nonce",
				value: "1761734205118",
				check: "The proposal number (under For experts)",
			},
		],
	},
	vault: {
		network: {
			value: "Chain 1337",
			check: "The signing network: nothing is sent on it",
		},
		message: "Agent",
		alt: "A wallet asking to sign a vault step on the signing network 1337: the source letter and the code, which must match the code on the page.",
		rows: [
			{ field: "source", value: "a", check: "a for mainnet, b for testnet" },
			{
				field: "connectionId",
				value:
					"0x4be2a09f1d7c35e86b0a2d4f97c1e3b5a86d02f4c7e91b3d5a08f6c2e4b17d9a",
				check: "The code: it must match the page",
			},
		],
	},
} as const satisfies Record<string, Prompt>;

export type PromptKind = keyof typeof PROMPTS;

export function isPromptKind(kind: string): kind is PromptKind {
	return Object.hasOwn(PROMPTS, kind);
}

/** The same prompt as a testnet signer sees it. */
export function onTestnet(prompt: Prompt): Prompt {
	return {
		...prompt,
		rows: prompt.rows.map((row) =>
			row.field === "hyperliquidChain"
				? { ...row, value: "Testnet" }
				: row.field === "source"
					? { ...row, value: "b" }
					: row.field === "token"
						? { ...row, value: TESTNET_USDC }
						: row,
		),
	};
}

/** The things to check, in order: the network first, then the rows. */
export function checksOf(prompt: Prompt): readonly string[] {
	const out: string[] = [];
	if (prompt.network?.check) out.push(prompt.network.check);
	for (const row of prompt.rows) if (row.check) out.push(row.check);
	return out;
}

/** The prompt as Markdown: the fields, then what to check. */
export function promptMarkdown(prompt: Prompt): string {
	const lines = [`*(Picture: ${prompt.alt})*`, ""];
	if (prompt.network) lines.push(`- Network: \`${prompt.network.value}\``);
	lines.push(`- Message: \`${prompt.message}\``);
	for (const row of prompt.rows)
		lines.push(
			`- \`${row.field}\`: ${row.value ? `\`${row.value}\`` : "(empty)"}`,
		);
	lines.push("", "Check:", "");
	checksOf(prompt).forEach((c, i) => {
		lines.push(`${i + 1}. ${c}`);
	});
	return lines.join("\n");
}
