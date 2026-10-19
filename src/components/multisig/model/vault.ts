/**
 * Vault deposits and withdrawals, as the Multisig section says them.
 *
 * A form names the end ("50,000 USDC into this vault", "20,000 USDC out of
 * it") and this file works out the one or two actions that bring it about,
 * from what Hyperliquid says about the treasury and the vault now (the
 * core's planner and judge). It also holds every sentence about vaults.
 *
 * Three levels, as everywhere in the section. An error is where Hyperliquid
 * itself would refuse: the button stays off and the reason stands beside the
 * field. A warning is one amber line. Everything else is a plain fact. A
 * withdrawal inside the lockup is none of these: it can be proposed and
 * signed now, and submitted once the lockup has ended (`opensAt`). Unless
 * the lockup ends only after the proposal would have closed (HLP's four days
 * against a signing window of two or three): Hyperliquid would then refuse
 * it for as long as it is open, which is an error like any other. Nothing
 * here is a recommendation: which vault to use is the signers' choice.
 */
import {
	type AccountMode,
	cutTo,
	Decimal,
	type Issue,
	isHlp,
	isolated,
	issue,
	judgeVaultSteps,
	type LedgerRow,
	type Network,
	type PlainObject,
	planDeposit,
	VAULT_LOCKUP_MARGIN_MS,
	VAULT_MIN_DEPOSIT_USDC,
	VAULT_USD_DECIMALS,
	type VaultAction,
	type VaultDeposit,
	type VaultFacts,
	type VaultInfo,
	type VaultLookup,
	type VaultRefusal,
	type VaultStep,
	vaultActionOf,
	vaultFields,
	vaultLockup,
	waitWords,
} from "@hl-tools/core";
import { addressField, amountField } from "./fields";
import { shortAddress } from "./parts";
import { localDate, type TimeContext, untilWords } from "./time";

export type VaultKind = "vaultDeposit" | "vaultWithdraw";
export const VAULT_KINDS: readonly VaultKind[] = [
	"vaultDeposit",
	"vaultWithdraw",
];
export const isVaultKind = (kind: string): kind is VaultKind =>
	(VAULT_KINDS as readonly string[]).includes(kind);

/**
 * Whether a form of this kind is offered in this copy of the app. A vault
 * action is signed as a code under the signing network; a copy set up
 * without that network could make a vault proposal that nobody can sign
 * there, so it opens no vault form: not from the chooser, not from a link, a
 * kept draft or "propose again".
 */
export const kindOffered = (kind: string, canSignCodes: boolean): boolean =>
	canSignCodes || !isVaultKind(kind);

/** What Hyperliquid said about the treasury and about the vault the form names. A part that was not read is null. */
export interface VaultRead {
	/** The treasury's account mode: undefined while it is being read, null when it could not be. */
	readonly mode: AccountMode | null | undefined;
	/** What the perps balance can release now. */
	readonly perps: string | null;
	/** Spot USDC that is not on hold: in a unified account, the free part of its one balance. */
	readonly spot: string | null;
	/** Every vault the treasury has money in. */
	readonly deposits: readonly VaultDeposit[] | null;
	/** The vault at the address in the form; null while it is not read. */
	readonly vault: VaultLookup | null;
}

/** The fields of the two forms, as the inputs hold them. */
export interface VaultInput {
	readonly kind: VaultKind;
	readonly amount: string;
	readonly vault: string;
}

export interface VaultPlan {
	/** The steps in order, one or two; null while the form cannot be turned into them. */
	readonly steps: readonly VaultStep[] | null;
	readonly issues: readonly Issue[];
	/**
	 * A withdrawal from a deposit that is still locked: it can be proposed and
	 * signed now, and submitted from this moment (unix ms) on.
	 */
	readonly opensAt: number | null;
}

// ------------------------------------------------------------------- words

const usdc = (amount: string): string =>
	`${Decimal.tryParse(amount)?.toDisplay() ?? amount} USDC`;

/** How long a new deposit into a vault is held, in words, saying so when the length is the docs' and not a measurement. */
export function lockupWords(vault: string, network: Network): string {
	const { ms, measured } = vaultLockup(vault, network);
	return `${waitWords(ms)}${measured ? "" : " (as Hyperliquid's documentation gives it)"}`;
}

/**
 * A vault in a sentence: HLP by its name, another vault by the name it gave
 * itself where that is at hand, always with its address. A vault's name is
 * its leader's own word, and nothing stops two from using the same one.
 */
export function vaultLabel(
	address: string,
	network: Network,
	name?: string | null,
): string {
	if (isHlp(address, network)) return `HLP (${shortAddress(address)})`;
	const clean = name?.trim();
	return clean
		? `“${isolated(cutTo(clean, 40))}” (${shortAddress(address)})`
		: `vault ${shortAddress(address)}`;
}

/** What one step does, in plain words. */
export function vaultStepSentence(
	step: VaultStep,
	network: Network,
	name?: string | null,
): string {
	switch (step.kind) {
		case "toPerps":
			return `Move ${usdc(step.amount)} from the spot balance to the perps balance`;
		case "deposit":
			return `Deposit ${usdc(step.amount)} into ${vaultLabel(step.vault, network, name)}`;
		default:
			return `Withdraw ${usdc(step.amount)} from ${vaultLabel(step.vault, network, name)}`;
	}
}

export const VAULT = {
	label: "Vault",
	kinds: {
		vaultDeposit: {
			label: "Deposit",
			description:
				"USDC into a vault, to share in what its leader's trading makes or loses.",
		},
		vaultWithdraw: {
			label: "Withdraw",
			description: "USDC out of a vault the treasury has money in.",
		},
	} satisfies Record<VaultKind, { label: string; description: string }>,
	amount: {
		vaultDeposit: "How much should go into the vault",
		vaultWithdraw: "How much should come out",
	} satisfies Record<VaultKind, string>,
	address: "Vault",
	addressHint:
		"The vault's address on Hyperliquid, as its own page there shows it.",
	hlp: "HLP, Hyperliquid's own vault",
	/** The button that puts HLP's address in the field. */
	useHlp: "Use HLP",
	oneStep: "This makes one proposal:",
	twoSteps:
		"This makes two proposals. Signers sign both in one visit, and the finaliser sends the second only once Hyperliquid has accepted the first:",
	/** The same line for every vault. */
	risk: "A vault deposit can lose value: the vault's leader trades with it.",
	noRecommendation:
		"A vault is shown as Hyperliquid reports it. Which one to use is the signers' choice.",
	reading: "Reading the vault from Hyperliquid…",
	vaultUnread:
		"The vault could not be read from Hyperliquid, so this address was not checked.",
	modeUnread:
		"This treasury's account mode could not be read from Hyperliquid, so this is planned as one step. In a manual account a deposit is taken from the perps balance only.",
	depositsUnread:
		"The treasury's vault deposits could not be read from Hyperliquid, so the amount was not checked against them.",
	noDeposits: "The treasury has no money in any vault.",
	pick: "Withdraw from",
	/** A code, not the action: the wallet step every vault proposal has. */
	code: "A vault action is signed as a code: each signer's wallet shows the code, and the proposal's page shows the same one to compare.",
} as const;

/** What Hyperliquid would answer, said to someone about to submit. */
export const VAULT_REFUSALS: Readonly<Record<VaultRefusal, string>> = {
	"vault-unregistered":
		"There is no vault at this address on this network, and Hyperliquid refuses the request.",
	"vault-closed": "This vault is closed: it takes no more deposits.",
	"vault-no-deposits": "This vault's leader has switched deposits off.",
	"vault-min-deposit": `A vault deposit has to be at least ${VAULT_MIN_DEPOSIT_USDC} USDC.`,
	"deposit-funds":
		"This deposits more USDC than the treasury can move into a vault now.",
	"vault-lockup":
		"The deposit this takes from is still locked, and Hyperliquid refuses a withdrawal until the lockup has ended.",
	"vault-equity":
		"This withdraws more USDC than can come out of the treasury's deposit in that vault now.",
	"transfer-balance":
		"This moves more USDC to the perps balance than the spot balance can release now.",
};

/** The facts about a vault, one line each, as Hyperliquid reports them. Nothing here is a judgement. */
export function vaultFactLines(
	v: VaultInfo,
	network: Network,
	time: TimeContext = {},
): readonly string[] {
	const pct = (f: number) =>
		`${(f * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
	const lines: string[] = [];
	lines.push(
		isHlp(v.address, network)
			? "Hyperliquid's own vault (HLP). Nobody takes a share of the profit."
			: v.commission === null
				? `Led by ${shortAddress(v.leader)}.`
				: v.commission === 0
					? `Led by ${shortAddress(v.leader)}, who takes no share of the profit.`
					: `Led by ${shortAddress(v.leader)}, who keeps ${pct(v.commission)} of a depositor's profit.`,
	);
	if (v.value !== null)
		lines.push(
			`Holds ${usdc(Decimal.parse(v.value).roundToDecimals(0, "down").toString())} now.`,
		);
	if (v.apr !== null)
		lines.push(
			`Past yearly rate, as Hyperliquid works it out: ${pct(v.apr)}. A past rate promises nothing.`,
		);
	if (v.since !== null) lines.push(`In use since ${localDate(v.since, time)}.`);
	lines.push(
		v.closed
			? "Closed: it takes no more deposits."
			: v.takesDeposits
				? "Takes deposits."
				: "Its leader has switched deposits off.",
	);
	return lines;
}

// ------------------------------------------------------------------- the plan

const AMOUNT = "action.amount";
const ADDRESS = "action.vaultAddress";

/** What the judge needs, from what was read, for the vault at `vault`. */
export function vaultFacts(read: VaultRead, vault: string): VaultFacts {
	const unified = read.mode?.kind === "unified";
	const held = read.deposits?.find((d) => d.vault === vault);
	const info = read.vault?.kind === "vault" ? read.vault.vault : null;
	return {
		unified,
		// A unified account has one balance, reported with the spot balances.
		// With the mode unread, which balance a deposit draws on is not known.
		perps: !read.mode ? null : unified ? read.spot : read.perps,
		spot: read.spot,
		vault: read.vault,
		deposit: read.deposits === null ? null : (held ?? "none"),
		maxWithdrawable:
			info && info.address === vault ? info.maxWithdrawable : null,
	};
}

/** The figures behind a refusal, where they are known. */
function refusalDetail(
	refusal: VaultRefusal,
	step: VaultStep,
	facts: VaultFacts,
): string {
	if (refusal === "deposit-funds") {
		if (facts.unified && facts.perps !== null)
			return `Its balance can release ${usdc(facts.perps)}, and this deposits ${usdc(step.amount)}.`;
		if (facts.perps !== null && facts.spot !== null)
			return `The perps balance can release ${usdc(facts.perps)} and spot holds ${usdc(facts.spot)}, and this deposits ${usdc(step.amount)}.`;
	}
	if (refusal === "vault-equity") {
		const limit =
			facts.maxWithdrawable ??
			(facts.deposit && facts.deposit !== "none" ? facts.deposit.equity : null);
		return limit === null
			? "The treasury has nothing in this vault."
			: facts.maxWithdrawable !== null
				? `Hyperliquid releases ${usdc(limit)} from it now, and this withdraws ${usdc(step.amount)}.`
				: `It is worth ${usdc(limit)}, and this withdraws ${usdc(step.amount)}.`;
	}
	return "";
}

/**
 * A deposit's lockup ends only after a proposal made now has closed, so a
 * withdrawal from it could not be submitted at any moment it is open.
 */
export function lockupOutlasts(
	opensAt: number,
	closesAt: number,
	now: number,
): string {
	return `The deposit this takes from is locked longer than this proposal would stay open: it can be withdrawn ${untilWords(opensAt, now)}, and a proposal made now closes ${untilWords(closesAt, now)}. Hyperliquid would refuse it the whole time. Make this proposal once the lockup has less time left than the signing window.`;
}

/**
 * The steps a form asks for and everything to say about them. `read` is null
 * while nothing has been read; `now` is the page's clock; `closesAt` is when
 * a proposal made now stops being submittable (left out, no lockup is held
 * against it).
 */
export function planVault(
	form: VaultInput,
	read: VaultRead | null | undefined,
	network: Network,
	now: number,
	closesAt?: number,
): VaultPlan {
	const issues: Issue[] = [];
	const none = (): VaultPlan => ({ steps: null, issues, opensAt: null });
	const warn = (code: string, message: string, path?: string) =>
		issues.push(issue(code, "warning", message, path ? { path } : {}));
	const block = (code: string, message: string, path: string) =>
		issues.push(issue(code, "error", message, { path }));

	const amount = amountField(
		form.amount,
		VAULT_USD_DECIMALS,
		"USDC",
		issues,
		AMOUNT,
	)?.toString();
	const vault = addressField(form.vault, ADDRESS, "The vault", issues, false);
	if (!amount || !vault || !read) return none();

	// what was read has to be about the address in the form: an answer for
	// the address typed a moment ago says nothing about this one
	const lookup =
		read.vault?.kind === "vault" && read.vault.vault.address !== vault
			? null
			: read.vault;
	if (!lookup || lookup.kind === "unreadable")
		warn("vault.unread", VAULT.vaultUnread, ADDRESS);

	const deposit = form.kind === "vaultDeposit";
	let steps: VaultStep[];
	if (deposit) {
		if (read.mode === null) warn("mode.unread", VAULT.modeUnread, "mode");
		steps = planDeposit({
			amount,
			vault,
			unified: read.mode?.kind === "unified",
			perps: read.mode ? read.perps : null,
			spot: read.spot,
		});
	} else {
		if (read.deposits === null)
			warn("deposits.unread", VAULT.depositsUnread, AMOUNT);
		steps = [{ kind: "withdraw", vault, amount }];
	}

	// A deposit that is still locked is no reason against proposing a
	// withdrawal: the proposal has two days, and the lockup ends by itself.
	// Everything else is judged as of the moment the lockup is over.
	const facts = vaultFacts({ ...read, vault: lookup }, vault);
	const held = facts.deposit && facts.deposit !== "none" ? facts.deposit : null;
	const locked =
		!deposit && held && held.lockedUntil > now ? held.lockedUntil : null;
	const verdict = judgeVaultSteps(steps, facts, locked ?? now, network);
	if (verdict) {
		const step = steps[verdict.index] as VaultStep;
		const path =
			verdict.refusal === "vault-unregistered" ||
			verdict.refusal === "vault-closed" ||
			verdict.refusal === "vault-no-deposits"
				? ADDRESS
				: AMOUNT;
		block(
			`vault.${verdict.refusal}`,
			`${VAULT_REFUSALS[verdict.refusal]} ${refusalDetail(verdict.refusal, step, facts)}`.trim(),
			path,
		);
		return none();
	}

	const opensAt = locked === null ? null : locked + VAULT_LOCKUP_MARGIN_MS;
	if (opensAt !== null && closesAt !== undefined && opensAt >= closesAt) {
		block(
			"vault.lockup_outlasts",
			lockupOutlasts(opensAt, closesAt, now),
			ADDRESS,
		);
		return none();
	}

	if (deposit && held)
		warn(
			"vault.relocks",
			`The treasury already has ${usdc(held.equity)} in this vault. Adding to it locks all of it again: none of it can be withdrawn for ${lockupWords(vault, network)}.`,
			AMOUNT,
		);
	if (!deposit && held) {
		// a deposit's worth moves with the vault between now and the submission
		const worth = Decimal.parse(facts.maxWithdrawable ?? held.equity);
		const asked = Decimal.parse(amount);
		if (asked.mul(Decimal.parse("100")).gte(worth.mul(Decimal.parse("99"))))
			warn(
				"vault.nearly_all",
				`This is nearly all of the deposit, which is worth ${usdc(worth.toString())} now. Its worth moves with the vault: if it is below the amount when this is sent, Hyperliquid refuses it.`,
				AMOUNT,
			);
	}
	return { steps, issues, opensAt };
}

/**
 * The actions of a plan as Hyperliquid takes them. The move to perps is a
 * user-signed action with the chain fields and its own number; the vault
 * action carries neither (its number stands beside it, in the proposal).
 */
export function vaultActions(
	steps: readonly VaultStep[],
	head: {
		readonly signatureChainId: string;
		readonly hyperliquidChain: string;
	},
	nonce: number,
): PlainObject[] {
	return steps.flatMap((step, i) => {
		if (step.kind === "toPerps")
			return [
				{
					type: "usdClassTransfer",
					...head,
					amount: step.amount,
					toPerp: true,
					nonce: nonce + i,
				} as PlainObject,
			];
		const fields = vaultFields(step);
		return fields ? [fields as PlainObject] : [];
	});
}

/** A vault action as a line in a list; null for any other action. */
export function vaultActionLine(
	action: PlainObject,
	network: Network,
	name?: string | null,
): string | null {
	const step: VaultAction | null = vaultActionOf(action);
	return step ? vaultStepSentence(step, network, name) : null;
}

// ------------------------------------------------------------------- the Vaults tab

/** One vault the treasury has money in, as its row shows it. */
export interface VaultRow {
	readonly vault: string;
	/** The vault's own name; empty while it is not read. */
	readonly name: string;
	readonly hlp: boolean;
	/** What the deposit is worth now, in USDC. */
	readonly equity: string;
	/** Profit or loss so far, in USDC; null while the vault is not read. */
	readonly pnl: string | null;
	/** When the money first went in; null while not read. */
	readonly since: number | null;
	readonly lockedUntil: number;
	/** Still inside the lockup at `now`. */
	readonly locked: boolean;
	/** The vault is closed, or its leader has switched deposits off: nothing more can go in. */
	readonly shut: boolean;
}

export interface VaultsView {
	/** Null while the deposits are not read. */
	readonly rows: readonly VaultRow[] | null;
	/** Everything in vaults, in USDC; null while not read. */
	readonly total: string | null;
}

/** What the Vaults tab shows, from the deposits and what is read about each vault. */
export function vaultsView(
	deposits: readonly VaultDeposit[] | null,
	details: ReadonlyMap<string, VaultLookup>,
	network: Network,
	now: number,
): VaultsView {
	if (!deposits) return { rows: null, total: null };
	const rows = deposits
		.map((d): VaultRow => {
			const l = details.get(d.vault);
			const info = l?.kind === "vault" ? l.vault : null;
			return {
				vault: d.vault,
				name: info?.name.trim() ?? "",
				hlp: isHlp(d.vault, network),
				equity: d.equity,
				pnl: info?.mine?.pnl ?? null,
				since: info?.mine?.since ?? null,
				lockedUntil: d.lockedUntil,
				locked: d.lockedUntil > now,
				shut: info ? info.closed || !info.takesDeposits : false,
			};
		})
		.sort((a, b) =>
			Decimal.parse(b.equity).gt(Decimal.parse(a.equity)) ? 1 : -1,
		);
	const total = deposits
		.reduce((sum, d) => sum.add(Decimal.parse(d.equity)), Decimal.parse("0"))
		.toString();
	return { rows, total };
}

/**
 * A USDC figure of a deposit as the screens show it: two decimals, cut and
 * never rounded up (a deposit must not read as more than it is); below a cent
 * (what "withdraw everything" leaves behind, a first hour's profit) up to six.
 */
export function usdcShown(v: string): string {
	const d = Decimal.tryParse(v);
	if (!d) return v;
	const small = !d.isZero() && d.abs().lt(Decimal.parse("0.01"));
	return small
		? d.roundToDecimals(VAULT_USD_DECIMALS, "down").toDisplay()
		: d.roundToDecimals(2, "down").toDisplay({ minDecimals: 2 });
}

/**
 * The one line the Overview gives vaults, so money in a vault never looks as
 * if it had left the treasury. Null when nothing is in a vault, or not read.
 */
export function vaultsSummaryLine(
	deposits: readonly VaultDeposit[] | null,
): string | null {
	if (!deposits || deposits.length === 0) return null;
	const total = deposits.reduce(
		(sum, d) => sum.add(Decimal.parse(d.equity)),
		Decimal.parse("0"),
	);
	if (!total.isPositive()) return null;
	return `${usdcShown(total.toString())} USDC in ${deposits.length === 1 ? "1 vault" : `${deposits.length} vaults`}`;
}

// ------------------------------------------------------------------- the history

/** What a vault row of the ledger records. */
export type VaultEventKind =
	| "deposit"
	| "withdrawal"
	| "distribution"
	| "created";

const EVENT_OF: Readonly<Record<string, VaultEventKind>> = {
	vaultDeposit: "deposit",
	vaultWithdraw: "withdrawal",
	vaultDistribution: "distribution",
	vaultCreate: "created",
};

/** How the history names each kind. */
export const VAULT_EVENT: Readonly<Record<VaultEventKind, string>> = {
	deposit: "Deposit",
	withdrawal: "Withdrawal",
	distribution: "Distribution",
	created: "Vault created",
};

/** One vault row of an account's ledger, as the Vaults tab's history shows it. */
export interface VaultEvent {
	readonly key: string;
	readonly time: number;
	readonly kind: VaultEventKind;
	/** The vault's address; null when the row names none. */
	readonly vault: string | null;
	/** What moved, in USDC: what went in, or what came back. Null when the row does not say. */
	readonly amount: string | null;
	/** A withdrawal: the leader's share of the profit, kept back. Null when there was none. */
	readonly leaderShare: string | null;
	/** A withdrawal: what closing positions for it cost. Null when it cost nothing. */
	readonly closingCost: string | null;
	/** The ledger's own row: its transaction, and what the "Proposal" cell is worked out from. */
	readonly row: LedgerRow;
}

/** An amount a row gives, when it is more than nothing. */
const more = (v: unknown): string | null => {
	const d = typeof v === "string" ? Decimal.tryParse(v) : null;
	return d?.isPositive() ? d.toString() : null;
};

/** Whether a ledger row is about a vault. */
export const isVaultRow = (row: LedgerRow): boolean => row.type in EVENT_OF;

/**
 * The vault rows of an account's ledger, the newest first: every deposit,
 * withdrawal and distribution Hyperliquid has on record for it, whoever made
 * it (a proposal, another tool, an API wallet). Null while the ledger is not
 * read. Nothing here is asked for: the ledger is what Hyperliquid pushes.
 */
export function vaultHistory(
	ledger: readonly LedgerRow[] | null,
): readonly VaultEvent[] | null {
	if (ledger === null) return null;
	return ledger
		.filter(isVaultRow)
		.map(
			(row): VaultEvent => ({
				key: row.key,
				time: row.time,
				kind: EVENT_OF[row.type] as VaultEventKind,
				vault: row.counterparty,
				amount: row.amount,
				leaderShare:
					row.type === "vaultWithdraw" ? more(row.delta.commission) : null,
				closingCost:
					row.type === "vaultWithdraw" ? more(row.delta.closingCost) : null,
				row,
			}),
		)
		.sort((a, b) => b.time - a.time || (a.key < b.key ? -1 : 1));
}

/** Every sentence of the history. */
export const VAULT_HISTORY = {
	title: "History",
	about:
		"Every vault deposit and withdrawal in Hyperliquid's record of this account, whoever made it.",
	gap: "Rows from while this page was disconnected may be missing.",
	all: "All transfers",
	reading: "Reading from Hyperliquid…",
	none: "No vault deposit or withdrawal in Hyperliquid's record of this account.",
	matched:
		"The last column says which proposal a row came from, when one on record agrees with it.",
	unmatched:
		"The last column says which proposal a row came from. The record of proposals cannot be read right now, so rows are not matched.",
} as const;
