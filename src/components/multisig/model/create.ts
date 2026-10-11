/**
 * Every sentence of "Create a treasury": the wizard that converts the
 * signed-in wallet's own account into a multi-sig. Kept here, away from the
 * screens, so the wording is tested like the relay's copy and the help texts
 * (nothing promises secrecy, a price or the absence of a server).
 *
 * The same three levels as the signer list (`signerSet.ts`): blocked only
 * where Hyperliquid itself would refuse, a warning as one line with no click,
 * and plain facts.
 */
import { API_WALLET_CAN } from "./apiWallet";
import type { Line } from "./signerSet";
import { shortAddress } from "./stage";

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

export const CREATE = {
	title: "Create a treasury",
	meta: "Turn the account you are signed in with into a treasury that its signers control together.",
	/** The first thing on the page: which account this is about. */
	headline: (account: string) =>
		`You are converting your own account, ${shortAddress(account)}.`,
	otherAccount:
		"To convert a different account, sign out, choose that account in your wallet and sign in with it.",
	signOut: "Sign out",
	accountTitle: "The account you are converting",
	signersTitle: "Who signs",
	pasteHint: "Paste an address, or several at once.",
	/** So "in use" is not read as "verified to be that person". */
	signersNote:
		"The page can tell that an address is in use, not that anyone holds its key.",
	howManyTitle: "How many must sign",
	later:
		"The signers can change this number, and who signs, later with a proposal.",
	infoTitle: "What converting does and does not do",
	info: [
		"This changes the account on HyperCore only. On HyperEVM and on every other blockchain, this address stays under its own key and can transact exactly as before. Anything sent to it there is not protected by the signers.",
		"Converting moves no funds and costs nothing. Balances, positions and history stay as they are.",
		"Keep this account's key. It still controls the address outside HyperCore, and it is what gets the account back if the signers ever convert it back.",
		"Money can still be sent to this address on Hyperliquid as before.",
	],
	/** Above the button: what is about to change, in place of any confirmation. */
	before: (account: string, k: number, n: number) =>
		`After this, ${shortAddress(account)}'s own key can no longer send anything on Hyperliquid. ${
			n === 1
				? "The one signer above can."
				: k === n
					? `Only all ${n} signers above together can.`
					: `Any ${k} of the ${n} signers above can.`
		} Only they can undo it.`,
	button: (account: string, k: number, n: number) =>
		`Convert ${shortAddress(account)} into a ${k}-of-${n} treasury`,
	buttonIdle: "Convert this account",
	/** While the wallet prompt is open. */
	inWallet: (k: number, n: number) =>
		`Your wallet shows the ${plural(n, "signer address", "signer addresses")} and "threshold": ${k}. Check them there before you sign.`,
	checking: "Checking the signers on Hyperliquid…",
	doneTitle: "Your treasury is set up",
	done: (account: string, k: number, n: number) =>
		`${shortAddress(account)} is now a ${k}-of-${n} treasury.`,
	readBack: "Read back from Hyperliquid.",
	switchNow:
		"You are signed in as the treasury itself, which can no longer act. Sign out and sign in as one of its signers to use it.",
	firstProposal: "Create your first proposal",
} as const;

/** What stands on the account being converted, as far as it was read. */
export interface AccountFacts {
	/** `userRole`; null when it was not asked or could not be read. */
	readonly role:
		| "user"
		| "missing"
		| "agent"
		| "vault"
		| "subAccount"
		| "unknown"
		| null;
	/** Its signer set when it is a multi-sig already; null when it is not. */
	readonly multiSig: {
		readonly threshold: number;
		readonly signers: number;
	} | null;
	/** Approved API wallets; null when they could not be read. */
	readonly agents:
		| readonly { readonly name: string; readonly validUntil: number }[]
		| null;
	/** Open positions and resting orders; null when not read. */
	readonly positions: number | null;
	readonly orders: number | null;
	readonly now: number;
}

export interface AccountJudgement {
	readonly lines: readonly Line[];
	/** The reason the button is off because of the account itself, or null. */
	readonly blockedBy: string | null;
}

/** The lines under the account: what blocks the conversion, and what comes along with it. */
export function accountLines(f: AccountFacts): AccountJudgement {
	if (f.multiSig) {
		const text = `This account is already a ${f.multiSig.threshold}-of-${f.multiSig.signers} treasury. To change its signers, sign in as one of them and open the treasury.`;
		return {
			lines: [{ level: "blocked", code: "create.already", text }],
			blockedBy: text,
		};
	}
	if (f.role === "missing") {
		const text =
			"This account has never received anything on Hyperliquid, so it cannot send the conversion yet. Send it some USDC first.";
		return {
			lines: [{ level: "blocked", code: "create.never_used", text }],
			blockedBy: text,
		};
	}
	const lines: Line[] = [];
	const positions = f.positions ?? 0;
	const orders = f.orders ?? 0;
	if (positions > 0 || orders > 0) {
		const what = [
			positions > 0 ? plural(positions, "open position", "open positions") : "",
			orders > 0 ? plural(orders, "open order", "open orders") : "",
		]
			.filter(Boolean)
			.join(" and ");
		lines.push({
			level: "warning",
			code: "create.open",
			text: `${what[0]?.toUpperCase()}${what.slice(1)}. After converting, only an API wallet can trade or cancel for this account.`,
		});
	}
	if (f.agents === null) {
		lines.push({
			level: "warning",
			code: "create.agents_unread",
			text: "Its API wallets could not be read. If it has one, that wallet keeps acting for the account afterwards, without the signers.",
		});
	} else {
		const live = f.agents.filter((a) => a.validUntil > f.now);
		if (live.length > 0) {
			const names = live.map((a) => `"${a.name || "unnamed"}"`).join(", ");
			lines.push({
				level: "warning",
				code: "create.agents",
				text: `${plural(live.length, "API wallet", "API wallets")} (${names}) ${live.length === 1 ? "keeps" : "keep"} acting for this account afterwards, without the signers: ${live.length === 1 ? "it" : "they"} can ${API_WALLET_CAN}.`,
			});
		}
	}
	if (f.role === "agent") {
		lines.push({
			level: "warning",
			code: "create.is_agent",
			text: "This wallet is an API wallet of another account. Converting it changes this address only, not the account it acts for.",
		});
	}
	return { lines, blockedBy: null };
}

/**
 * Why Hyperliquid refused a conversion, for the wizard: by the id the core's
 * error catalogue gives the answer. (The catalogue's own advice is written
 * for proposals and envelopes.) Unknown answers are quoted as they came.
 */
const REFUSED: Readonly<Record<string, string>> = {
	"must-deposit":
		"This account has never received anything on Hyperliquid, so it cannot send the conversion.",
	"multisig-signer-missing":
		"One of the signers has never been used on Hyperliquid. Each signer has to have received something there first.",
	"multisig-signer-kind":
		"One of the signers is a vault or a sub-account. Hyperliquid refuses those as signers.",
	"multisig-self": "The account is in its own signer list.",
	"multisig-threshold-invalid":
		"The number that must sign does not fit the list of signers.",
	"multisig-too-many": "A treasury has at most 10 signers.",
	"multisig-required":
		"This account is already a multi-sig. Its own key can no longer change it.",
};

export function refusalText(id: string, message: string): string {
	return REFUSED[id] ?? `Hyperliquid answered: "${message}".`;
}

export const REFUSAL_IDS: readonly string[] = Object.keys(REFUSED);
