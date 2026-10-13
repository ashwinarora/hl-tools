/**
 * Two things a signer should know before a send is signed or submitted: what
 * it costs (Hyperliquid charges 1 USDC for the first send to an address it
 * has never seen), and whether Hyperliquid would refuse it as things stand.
 * A refusal uses up the proposal's number, so the page stops before sending
 * rather than after. Pure: the page reads the facts and passes them in.
 *
 * The rules are the core's (`multisig/transfer`, measured on testnet).
 */
import {
	type AccountMode,
	accountMode,
	activationCharge,
	Decimal,
	landsIn,
	multiSigEvmRefusal,
	overtakenBy,
	type PlainObject,
	sendRefusal,
	sendShape,
	WITHDRAWAL_FEE_USDC,
	withdrawalOutcome,
} from "@hl-tools/core";
import type { Receiver } from "./actions";
import { selfRefusal } from "./selfSend";

export interface SendFacts {
	/** The treasury's mode; null when it could not be read. */
	readonly mode: AccountMode | null;
	/** What can leave the perps balance now; null when not read. */
	readonly perpsUsdc: string | null;
	/** The spot balances; null when not read. What can be sent is total − hold. */
	readonly spot:
		| readonly {
				readonly coin: string;
				readonly total: string;
				readonly hold?: string;
		  }[]
		| null;
	/** What is known about the destination; null when it was not looked up. */
	readonly receiver: Receiver | null;
	/** Sends the treasury has carried out, as far as the page knows them. */
	readonly done?: readonly { readonly action: unknown }[];
	/** The treasury's own address: Hyperliquid refuses some sends to oneself. */
	readonly self?: string;
}

/** What can be sent of a spot token: its total less what is held. Null when not known. */
export function spotAvailable(
	spot: SendFacts["spot"],
	coin: string,
): string | null {
	if (!spot) return null;
	const b = spot.find((x) => x.coin === coin);
	if (!b) return "0";
	const total = Decimal.tryParse(b.total);
	const hold = Decimal.tryParse(b.hold ?? "0");
	return total && hold ? total.sub(hold).toString() : null;
}

/**
 * The larger of two figures, or null when either is not known.
 *
 * For a bridge withdrawal from a unified account: Hyperliquid reports such an
 * account's money as its spot balance, and its "withdrawable" there is a
 * figure of its own (0.29 beside a balance of 16.6 on a lab treasury on
 * 2026-10-13). Which of the two a withdrawal is held to has not been measured,
 * so one is stopped only when it is above both.
 */
export function largerOf(a: string | null, b: string | null): string | null {
	const x = a === null ? null : Decimal.tryParse(a);
	const y = b === null ? null : Decimal.tryParse(b);
	if (!x || !y) return null;
	return (x.gt(y) ? x : y).toString();
}

/**
 * What Hyperliquid's two answers about an address make of it as a receiver:
 * `userRole` (is it new, an account, an API wallet…) and `userAbstraction`
 * (its mode; an address never used answers `default`).
 */
export function receiverOf(role: unknown, modeRaw: unknown): Receiver {
	const r =
		role && typeof role === "object"
			? (role as { role?: unknown; data?: { user?: unknown } })
			: {};
	const mode = typeof modeRaw === "string" ? accountMode(modeRaw) : null;
	switch (r.role) {
		case "missing":
			return { status: "new", mode };
		case "user":
			return { status: "active", mode };
		case "agent":
			return {
				status: "agent",
				mode,
				agentOf: typeof r.data?.user === "string" ? r.data.user : null,
			};
		case "vault":
		case "subAccount":
			return { status: "other", mode };
		default:
			return { status: "unknown", mode };
	}
}

/**
 * How soon to ask about a receiver again on a page that stays open: only an
 * address that was new (or could not be told) can turn into one in use, and
 * an address in use stays so. False: never.
 */
export function receiverRecheckMs(
	receiver: Receiver | null | undefined,
	everyMs: number,
): number | false {
	return receiver?.status === "new" || receiver?.status === "unknown"
		? everyMs
		: false;
}

export interface Refusal {
	/** The error catalogue's id for what Hyperliquid would answer. */
	readonly code: string;
	readonly message: string;
}

/**
 * A destination that is one of HyperEVM's own addresses: a send to it asks
 * Hyperliquid to move the token to HyperEVM, which it does not do for a
 * multi-sig account (core: `multiSigEvmRefusal`).
 */
export const TO_HYPEREVM =
	"The destination is one of HyperEVM's own addresses: a send to it would move the token to HyperEVM, and Hyperliquid refuses that from a multi-sig account. A treasury's tokens can only be sent to accounts on Hyperliquid.";

const MODE_REFUSALS: Readonly<Record<string, string>> = {
	"unified-disabled":
		"This treasury is a unified account, and Hyperliquid switches this kind of action off there. Propose it again as Send USDC or Send spot token.",
	"unified-spot-only":
		"This treasury is a unified account now: it sends only from its one balance, and this action takes the money from the perps balance. Propose it again.",
	"token-invalid":
		"Only USDC moves into or out of a perps balance. Hyperliquid refuses any other token there.",
	"self-transfer":
		"This sends from the treasury to itself, and Hyperliquid refuses that kind of send to oneself. Propose it again with another destination.",
	"send-invalid":
		"This sends from one of the treasury's balances into the same balance of itself, and Hyperliquid refuses that. To move USDC between its perps and spot balances, propose Perps ↔ spot.",
	"evm-multisig": TO_HYPEREVM,
};

const MODE_TITLES: Readonly<Record<string, string>> = {
	"unified-disabled": "Cannot be sent while the treasury is a unified account",
	"unified-spot-only": "Cannot be sent while the treasury is a unified account",
	"token-invalid": "Hyperliquid refuses this token in a perps balance",
	"self-transfer": "Hyperliquid refuses a send from an account to itself",
	"send-invalid": "Hyperliquid refuses a send into the balance it comes from",
	"evm-multisig": "Hyperliquid refuses a send to HyperEVM from a multi-sig",
};

/**
 * What the treasury's mode alone says against an action. It is known as soon
 * as the mode is read, so a proposal's page can say it before anyone signs.
 * Null when the mode allows the action, or was not read.
 */
export function modeRefusal(
	mode: AccountMode | null,
	action: PlainObject,
	/** The sending account: a send to itself is refused whatever the mode. */
	self?: string,
): (Refusal & { readonly title: string }) | null {
	// first what no mode changes: the destination is not an account at all
	const refusal =
		multiSigEvmRefusal(action) ??
		(mode ? sendRefusal(mode, action) : null) ??
		(self ? selfRefusal(self, action) : null);
	return refusal
		? {
				code: refusal,
				title: MODE_TITLES[refusal] as string,
				message: MODE_REFUSALS[refusal] as string,
			}
		: null;
}

/**
 * Why Hyperliquid would refuse this action right now, as far as the facts
 * tell. Empty when nothing known stands in its way: a fact that was not read
 * is no reason to stop.
 */
export function preflight(action: PlainObject, facts: SendFacts): Refusal[] {
	const out: Refusal[] = [];
	const blocked = modeRefusal(facts.mode, action, facts.self);
	const refusal = blocked?.code ?? null;
	if (blocked) out.push({ code: blocked.code, message: blocked.message });

	// `checkBeforeSubmit` passes no `done`: by then the page has already
	// judged the order from the record (`overtaken` in the stage), and where
	// that could not be told the submission is let through, since a send that
	// was overtaken can never go through anyway and only its own number is
	// lost. This branch serves callers that do hold the record.
	if (overtakenBy(action, facts.done ?? []))
		out.push({
			code: "nonce-used",
			message:
				"A newer USDC send of this treasury has been carried out, and Hyperliquid takes them only in order. Propose it again.",
		});

	// the bridge keeps its fee out of the amount; at the fee or below Hyperliquid refuses
	if (withdrawalOutcome(action)?.refusal) {
		out.push({
			code: "withdrawal-below-fee",
			message: `This withdraws ${String(action.amount)} USDC, and the bridge keeps ${WITHDRAWAL_FEE_USDC} USDC of every withdrawal as its fee: a withdrawal has to be more than that.`,
		});
		return out;
	}
	// a bridge withdrawal leaves the perps balance like a send does
	const shape =
		sendShape(action) ??
		(action.type === "withdraw3"
			? {
					from: "perps" as const,
					token: "USDC",
					amount: Decimal.tryParse(String(action.amount)),
				}
			: null);
	if (!shape?.amount || refusal) return out;
	const unified = facts.mode?.kind === "unified";
	const source =
		action.type === "withdraw3" && unified
			? largerOf(facts.perpsUsdc, spotAvailable(facts.spot, "USDC"))
			: shape.from === "perps"
				? facts.perpsUsdc
				: shape.from === "spot"
					? spotAvailable(facts.spot, shape.token)
					: null;
	const held = source === null ? null : Decimal.tryParse(source);
	if (held && shape.amount.gt(held)) {
		out.push({
			code: shape.from === "perps" ? "transfer-balance" : "token-balance",
			message: `This sends ${shape.amount.toString()} ${shape.token}, and the treasury can move ${held.toString()} from its ${unified ? "balance" : shape.from === "perps" ? "perps balance" : "spot balance"} right now.`,
		});
		return out;
	}
	if (facts.receiver?.status !== "new") return out;
	const charge = activationCharge({
		action,
		receiverNew: true,
		spotUsdc: spotAvailable(facts.spot, "USDC"),
		perpsUsdc: facts.perpsUsdc,
	});
	if (charge.refusal === "transfer-below-fee")
		out.push({
			code: charge.refusal,
			message:
				"The destination has never been used on Hyperliquid, and this kind of send pays the 1 USDC for that out of the amount: an amount of 1 USDC or less is refused.",
		});
	if (charge.refusal === "transfer-gas")
		out.push({
			code: charge.refusal,
			message:
				"The destination has never been used on Hyperliquid, so this costs 1 USDC on top of the amount, and the treasury cannot pay both right now.",
		});
	return out;
}

export interface CostLine {
	/**
	 * plain  nothing to pay
	 * fee    1 USDC will be charged
	 * warn   something the proposer should look at before going on
	 * muted  not known (yet)
	 */
	readonly tone: "plain" | "fee" | "warn" | "muted";
	readonly text: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "It arrives in their perps balance.", for a send that names where it goes. */
function arrival(action: PlainObject, receiver: Receiver): string {
	if (!receiver.mode) return "";
	const lands = landsIn(receiver.mode, action);
	if (lands === "balance")
		return " It arrives in their one balance: the receiver is a unified account.";
	if (lands === "perps" || lands === "spot")
		return ` It arrives in their ${lands} balance.`;
	return "";
}

/**
 * The line under a destination: what sending to it costs. Null for an action
 * that pays nobody (a move inside the account, an approval, a withdrawal).
 * `receiver`: "loading" while it is being looked up, null when it could not be.
 */
export function costLine(input: {
	readonly action: PlainObject | null;
	readonly receiver: Receiver | "loading" | null;
	readonly mode: AccountMode | null;
	readonly perpsUsdc: string | null;
	readonly spot: SendFacts["spot"];
}): CostLine | null {
	const { action, receiver } = input;
	const shape = action ? sendShape(action) : null;
	if (!action || !shape || shape.destination === null) return null;
	// not an account: the form says so under the destination, and nothing is paid
	if (multiSigEvmRefusal(action)) return null;
	if (receiver === "loading")
		return {
			tone: "muted",
			text: "Checking whether this address is in use on Hyperliquid…",
		};
	if (!receiver || receiver.status === "unknown")
		return {
			tone: "muted",
			text: "Whether this address is in use on Hyperliquid could not be checked. If it is new, the first send to it costs 1 USDC.",
		};
	if (receiver.status === "active")
		return {
			tone: "plain",
			text: `This address is in use on Hyperliquid: sending to it costs nothing.${arrival(action, receiver)}`,
		};
	if (receiver.status === "agent")
		return {
			tone: "warn",
			text: `This address is an API wallet${receiver.agentOf ? ` of ${short(receiver.agentOf)}` : ""}, not an account people are paid into. If it has never held funds, the send also costs 1 USDC.`,
		};
	if (receiver.status === "other")
		return {
			tone: "warn",
			text: "This address is a vault or a sub-account. Money goes into those with their own actions, not with a send.",
		};
	const charge = activationCharge({
		action,
		receiverNew: true,
		spotUsdc: spotAvailable(input.spot, "USDC"),
		perpsUsdc: input.perpsUsdc,
	});
	const first =
		"This address has never been used on Hyperliquid, so the first send to it costs 1 USDC, once.";
	if (charge.paidFrom === "amount")
		return charge.refusal
			? {
					tone: "warn",
					text: `${first} This kind of send pays it out of the amount, and Hyperliquid refuses an amount of 1 USDC or less.`,
				}
			: {
					tone: "fee",
					text: `${first} This kind of send pays it out of the amount${charge.receiverGets ? `: the receiver gets ${charge.receiverGets.toString()} ${shape.token}` : ""}.`,
				};
	if (charge.refusal)
		return {
			tone: "warn",
			text: `${first} It is charged on top of the amount, and the treasury cannot pay both right now: Hyperliquid would refuse it.`,
		};
	const from =
		input.mode?.kind === "unified"
			? ", from its balance"
			: charge.paidFrom === "spot"
				? ", from its spot USDC"
				: charge.paidFrom === "perps"
					? ", from its perps balance"
					: "";
	return {
		tone: "fee",
		text: `${first} The receiver gets the full amount, and the treasury pays 1 USDC on top${from}.${arrival(action, receiver)}`,
	};
}
