/**
 * Vault deposits and withdrawals, read off the measured table
 * (rules/vaults.ts; fixtures/multisig/vaults.json): what Hyperliquid reports
 * about a vault and about an account's deposits, which actions bring a
 * deposit about, and what Hyperliquid would answer to them as things stand.
 *
 * USDC amounts are decimal strings in their canonical form, as everywhere in
 * the account data; the action carries them as an integer of millionths.
 * Parsers are total: a wrong shape gives null, a bad row is left out.
 */
import { Decimal } from "../decimal.ts";
import type { Network } from "../network.ts";
import {
	HLP_VAULT,
	VAULT_ACTION_TYPE,
	VAULT_LOCKUP,
	VAULT_MIN_DEPOSIT_USDC,
	VAULT_USD_DECIMALS,
} from "../rules/vaults.ts";
import { shownLine } from "./shown.ts";

/** The longest vault name shown. */
const VAULT_NAME_MAX = 80;

const ADDRESS = /^0x[0-9a-f]{40}$/;
const UNIT = 10 ** VAULT_USD_DECIMALS;

const record = (v: unknown): Record<string, unknown> | null =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
const addressOf = (v: unknown): string | null =>
	typeof v === "string" && ADDRESS.test(v.toLowerCase())
		? v.toLowerCase()
		: null;
const timeOf = (v: unknown): number | null =>
	typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const dec = (v: string): Decimal => Decimal.parse(v);
/**
 * A decimal Hyperliquid gave as a string or as a number, in canonical form;
 * null for anything else. A string is taken exactly. A JSON number (as
 * `maxWithdrawable` comes) is read as the shortest text that is that number,
 * which is what Hyperliquid wrote, exponent form included, and then cut down
 * to a vault amount's 6 decimals: never rounded, so a figure is never more
 * than Hyperliquid said (`toFixed` would round 4.9999995 up to 5).
 */
function amountOf(v: unknown): string | null {
	if (typeof v === "string") return Decimal.tryParse(v)?.toString() ?? null;
	if (typeof v !== "number" || !Number.isFinite(v)) return null;
	// a finite number's text is always one Decimal reads, "1e+21" and "5e-7" included
	return Decimal.parse(String(v))
		.roundToDecimals(VAULT_USD_DECIMALS, "floor")
		.toString();
}

// ------------------------------------------------------------------ amounts

/** The integer an action carries, as USDC: 5000000 is "5". Null for anything that is not a whole, positive number. */
export function usdToUsdc(usd: unknown): string | null {
	if (typeof usd !== "number" || !Number.isSafeInteger(usd) || usd <= 0)
		return null;
	const whole = Math.floor(usd / UNIT);
	const frac = String(usd % UNIT)
		.padStart(VAULT_USD_DECIMALS, "0")
		.replace(/0+$/, "");
	return frac ? `${whole}.${frac}` : String(whole);
}

/** A USDC amount as the integer an action carries. Null when it is not positive, has more than six decimals, or is too large to carry exactly. */
export function usdcToUsd(amount: string): number | null {
	const d = Decimal.tryParse(amount);
	if (!d?.isPositive()) return null;
	const [whole = "0", frac = ""] = d.toString().split(".");
	if (frac.length > VAULT_USD_DECIMALS) return null;
	const n = Number(`${whole}${frac.padEnd(VAULT_USD_DECIMALS, "0")}`);
	return Number.isSafeInteger(n) ? n : null;
}

// ------------------------------------------------------------------ the action

/** A deposit into a vault, or a withdrawal from one. */
export interface VaultAction {
	readonly kind: "deposit" | "withdraw";
	readonly vault: string;
	/** USDC. */
	readonly amount: string;
}

/** An action as posted, read as a vault action. Null for any other action, and for one whose amount or vault cannot be read. */
export function vaultActionOf(action: unknown): VaultAction | null {
	const a = record(action);
	if (!a || a.type !== VAULT_ACTION_TYPE) return null;
	const vault = addressOf(a.vaultAddress);
	const amount = usdToUsdc(a.usd);
	if (vault === null || amount === null || typeof a.isDeposit !== "boolean")
		return null;
	return { kind: a.isDeposit ? "deposit" : "withdraw", vault, amount };
}

/**
 * The action Hyperliquid takes for a deposit or a withdrawal, in the order
 * of fields it is hashed in. Null when the amount cannot be carried exactly.
 */
export function vaultFields(a: VaultAction): Record<string, unknown> | null {
	const usd = usdcToUsd(a.amount);
	return usd === null
		? null
		: {
				type: VAULT_ACTION_TYPE,
				vaultAddress: a.vault,
				isDeposit: a.kind === "deposit",
				usd,
			};
}

/** The network on which an address is HLP, Hyperliquid's own vault; null for any other address. */
export function hlpNetwork(vault: string): Network | null {
	const v = vault.toLowerCase();
	return v === HLP_VAULT.mainnet
		? "mainnet"
		: v === HLP_VAULT.testnet
			? "testnet"
			: null;
}

/**
 * One line for a deposit or a withdrawal: HLP by its name, any other vault
 * by its address. `what` is the amount with its unit ("5 USDC").
 */
export function vaultHeadline(
	kind: VaultAction["kind"],
	what: string,
	vault: string,
): string {
	return `${kind === "deposit" ? "Deposit" : "Withdraw"} ${what} ${kind === "deposit" ? "into" : "from"} ${hlpNetwork(vault) ? "HLP, Hyperliquid's own vault," : "vault"} ${vault}`;
}

/** Whether an address is Hyperliquid's own vault (HLP) on that network. */
export function isHlp(vault: string, network: Network): boolean {
	return hlpNetwork(vault) === network;
}

/** How long a new deposit into this vault is held, and whether that length was measured. */
export function vaultLockup(
	vault: string,
	network: Network,
): { readonly ms: number; readonly measured: boolean } {
	return (isHlp(vault, network) ? VAULT_LOCKUP.hlp : VAULT_LOCKUP.user)[
		network
	];
}

// ------------------------------------------------------------------ what Hyperliquid reports

/** One of an account's deposits (`userVaultEquities`). */
export interface VaultDeposit {
	readonly vault: string;
	/** What the deposit is worth now, in USDC. */
	readonly equity: string;
	/** Until when it cannot be withdrawn. */
	readonly lockedUntil: number;
}

/** `userVaultEquities`: every vault the account has money in. Null when the answer is not a list. */
export function parseVaultEquities(raw: unknown): VaultDeposit[] | null {
	if (!Array.isArray(raw)) return null;
	const out: VaultDeposit[] = [];
	for (const row of raw) {
		const r = record(row);
		const vault = addressOf(r?.vaultAddress);
		const equity = amountOf(r?.equity);
		const lockedUntil = timeOf(r?.lockedUntilTimestamp);
		if (vault === null || equity === null || lockedUntil === null) continue;
		out.push({ vault, equity, lockedUntil });
	}
	return out;
}

/** What Hyperliquid reports about a vault (`vaultDetails`), as far as a depositor needs it. */
export interface VaultInfo {
	readonly address: string;
	readonly name: string;
	readonly leader: string;
	/** The leader's share of a depositor's profit, as a fraction (0.1 is a tenth); null when not given. */
	readonly commission: number | null;
	/** The yearly rate Hyperliquid works out from the vault's past, as a fraction; null when not given. Past, not promised. */
	readonly apr: number | null;
	/** What the vault holds now, in USDC: the last point of its value history. Null when it has none. */
	readonly value: string | null;
	/** The first moment of its history: about when it was made. */
	readonly since: number | null;
	readonly closed: boolean;
	readonly takesDeposits: boolean;
	/** `parent`: a vault made of other vaults, as HLP is. */
	readonly relationship: "normal" | "parent" | "child" | null;
	/** The asking account's deposit, when the request named an account and it has one. */
	readonly mine: {
		readonly equity: string;
		/** Profit or loss so far, in USDC. */
		readonly pnl: string | null;
		/** When the money first went in. */
		readonly since: number | null;
		readonly lockedUntil: number | null;
	} | null;
	/** What that account could take out now; null when the request named none. */
	readonly maxWithdrawable: string | null;
}

/**
 * vault        Hyperliquid has a vault at the address
 * none         it has none there ("Vault not registered")
 * unreadable   the answer is not what this version reads
 */
export type VaultLookup =
	| { readonly kind: "vault"; readonly vault: VaultInfo }
	| { readonly kind: "none" }
	| { readonly kind: "unreadable" };

/** The value history of one span of `portfolio` ("day", "allTime"…), as points in time order. */
function history(
	portfolio: unknown,
	span: string,
): readonly [number, string][] {
	if (!Array.isArray(portfolio)) return [];
	for (const entry of portfolio) {
		if (!Array.isArray(entry) || entry[0] !== span) continue;
		const points = record(entry[1])?.accountValueHistory;
		if (!Array.isArray(points)) return [];
		const out: [number, string][] = [];
		for (const p of points) {
			const at = Array.isArray(p) ? timeOf(p[0]) : null;
			const value = Array.isArray(p) ? amountOf(p[1]) : null;
			if (at !== null && value !== null) out.push([at, value]);
		}
		return out;
	}
	return [];
}

const fraction = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

/** `vaultDetails`, which answers `null` for an address that is no vault. */
export function parseVaultDetails(raw: unknown): VaultLookup {
	if (raw === null) return { kind: "none" };
	const r = record(raw);
	const address = addressOf(r?.vaultAddress);
	const leader = addressOf(r?.leader);
	if (!r || address === null || leader === null || typeof r.name !== "string")
		return { kind: "unreadable" };
	const day = history(r.portfolio, "day");
	const all = history(r.portfolio, "allTime");
	const follower = record(r.followerState);
	const equity = amountOf(follower?.vaultEquity);
	const type = record(r.relationship)?.type;
	return {
		kind: "vault",
		vault: {
			address,
			// its leader's own word: nothing in it that does not show
			name: shownLine(r.name, VAULT_NAME_MAX),
			leader,
			commission: fraction(r.leaderCommission),
			apr: fraction(r.apr),
			value: (day.at(-1) ?? all.at(-1))?.[1] ?? null,
			since: all[0]?.[0] ?? null,
			closed: r.isClosed === true,
			// absent means the vault says nothing against it
			takesDeposits: r.allowDeposits !== false,
			relationship:
				type === "normal" || type === "parent" || type === "child"
					? type
					: null,
			mine:
				follower && equity !== null
					? {
							equity,
							pnl: amountOf(follower.allTimePnl),
							since: timeOf(follower.vaultEntryTime),
							lockedUntil: timeOf(follower.lockupUntil),
						}
					: null,
			maxWithdrawable: follower ? amountOf(r.maxWithdrawable) : null,
		},
	};
}

// ------------------------------------------------------------------ a deposit in one step or two

/** One step of a deposit: USDC from the spot balance to the perps balance, or the vault action. */
export type VaultStep =
	| { readonly kind: "toPerps"; readonly amount: string }
	| VaultAction;

/**
 * "This much into this vault". A deposit is taken from what the perps
 * balance can release; a manual account that holds the rest in spot moves
 * the missing part over first, so it is one step or two. A unified account
 * has one balance and always one step. Where a figure was not read, or spot
 * cannot make up the difference, it stays one step: the judge says why it
 * would be refused.
 */
export function planDeposit(i: {
	readonly amount: string;
	readonly vault: string;
	/** A unified account has one balance. */
	readonly unified: boolean;
	/** What the perps balance can release now; null when not read. */
	readonly perps: string | null;
	/** Spot USDC that is not on hold; null when not read. */
	readonly spot: string | null;
}): VaultStep[] {
	const deposit: VaultAction = {
		kind: "deposit",
		vault: i.vault,
		amount: i.amount,
	};
	if (i.unified || i.perps === null || i.spot === null) return [deposit];
	// the move has to cover the shortfall and carries 6 decimals: a perps figure
	// with more would make it uncarriable, so it is the smallest 6-decimal amount
	// that covers it (at most a millionth more, between the account's own
	// balances); the deposit itself stays exactly as typed
	const short = dec(i.amount)
		.sub(dec(i.perps))
		.roundToDecimals(VAULT_USD_DECIMALS, "ceil");
	if (!short.isPositive() || short.gt(dec(i.spot))) return [deposit];
	return [{ kind: "toPerps", amount: short.toString() }, deposit];
}

// ------------------------------------------------------------------ the judge

/**
 * What is known about the account and the vault when a step is judged. A
 * fact that could not be read is null, and an unknown fact refuses nothing.
 */
export interface VaultFacts {
	/** A unified account has one balance: `perps` is then that balance's free part, and `spot` is not used. */
	readonly unified: boolean;
	/** What a deposit can take from. */
	readonly perps: string | null;
	/** Spot USDC that is not on hold (a manual account's). */
	readonly spot: string | null;
	/** The vault as Hyperliquid reports it; null while not read. */
	readonly vault: VaultLookup | null;
	/** The account's deposit in that vault: `none` when it has none; null while not read. */
	readonly deposit: VaultDeposit | "none" | null;
	/** What the account could take out of it now, when Hyperliquid said so. */
	readonly maxWithdrawable?: string | null;
}

/** A refusal Hyperliquid would give, by its id in the error catalogue. */
export type VaultRefusal =
	| "vault-unregistered"
	| "vault-closed"
	| "vault-no-deposits"
	| "vault-min-deposit"
	| "deposit-funds"
	| "vault-lockup"
	| "vault-equity"
	// the first step of a two-step deposit: more than spot holds
	| "transfer-balance";

const exceeds = (amount: string, have: string | null): boolean =>
	have !== null && dec(amount).gt(dec(have));

/**
 * The refusal this step would meet as things stand at `now`, or null. Where
 * two reasons hold at once, which of them Hyperliquid names was not
 * measured; the one named here comes first in the code below.
 */
export function vaultRefusal(
	step: VaultStep,
	facts: VaultFacts,
	now: number,
): VaultRefusal | null {
	if (step.kind === "toPerps")
		return exceeds(step.amount, facts.spot) ? "transfer-balance" : null;
	const vault = facts.vault;
	if (vault?.kind === "none") return "vault-unregistered";
	if (step.kind === "deposit") {
		if (vault?.kind === "vault" && vault.vault.closed) return "vault-closed";
		if (vault?.kind === "vault" && !vault.vault.takesDeposits)
			return "vault-no-deposits";
		if (dec(step.amount).lt(dec(VAULT_MIN_DEPOSIT_USDC)))
			return "vault-min-deposit";
		return exceeds(step.amount, facts.perps) ? "deposit-funds" : null;
	}
	const deposit = facts.deposit;
	if (deposit === null) return null;
	if (deposit === "none") return "vault-equity";
	if (deposit.lockedUntil > now) return "vault-lockup";
	const limit = facts.maxWithdrawable ?? deposit.equity;
	return exceeds(step.amount, limit) ? "vault-equity" : null;
}

const plus = (have: string | null, amount: string): string | null =>
	have === null ? null : dec(have).add(dec(amount)).toString();
const minus = (have: string | null, amount: string): string | null =>
	have === null ? null : dec(have).sub(dec(amount)).toString();

/**
 * What stands after Hyperliquid has carried the step out at `now`. A deposit
 * (a first one or an addition) locks everything in that vault for its
 * lockup. A withdrawal's money is counted back in full: the leader's share
 * of the profit, which Hyperliquid keeps out of it, is not known beforehand.
 */
export function afterVaultStep(
	facts: VaultFacts,
	step: VaultStep,
	now: number,
	network: Network,
): VaultFacts {
	if (step.kind === "toPerps")
		return {
			...facts,
			spot: minus(facts.spot, step.amount),
			perps: plus(facts.perps, step.amount),
		};
	const held = facts.deposit === "none" ? null : facts.deposit;
	if (step.kind === "deposit")
		return {
			...facts,
			perps: minus(facts.perps, step.amount),
			deposit:
				facts.deposit === null
					? null
					: {
							vault: step.vault,
							equity: dec(held?.equity ?? "0")
								.add(dec(step.amount))
								.toString(),
							lockedUntil: now + vaultLockup(step.vault, network).ms,
						},
			maxWithdrawable: null,
		};
	const left = held ? dec(held.equity).sub(dec(step.amount)) : null;
	return {
		...facts,
		perps: plus(facts.perps, step.amount),
		deposit:
			!held || !left
				? facts.deposit
				: left.isPositive()
					? { ...held, equity: left.toString() }
					: "none",
		maxWithdrawable: null,
	};
}

/**
 * The first of these steps Hyperliquid would refuse when they are carried
 * out in order from `now`, each judged against what the ones before it leave
 * behind. Null when none would be.
 */
export function judgeVaultSteps(
	steps: readonly VaultStep[],
	facts: VaultFacts,
	now: number,
	network: Network,
): { readonly index: number; readonly refusal: VaultRefusal } | null {
	let state = facts;
	for (const [index, step] of steps.entries()) {
		const refusal = vaultRefusal(step, state, now);
		if (refusal) return { index, refusal };
		state = afterVaultStep(state, step, now, network);
	}
	return null;
}

/**
 * When the lockup of the deposit a withdrawal takes from ends; null for a
 * deposit and when the account has nothing in that vault. A withdrawal can
 * be signed before this and is refused if submitted before it.
 */
export function vaultLockupOf(
	action: VaultAction,
	deposits: readonly VaultDeposit[],
): number | null {
	return action.kind === "withdraw"
		? (deposits.find((d) => d.vault === action.vault)?.lockedUntil ?? null)
		: null;
}
