/**
 * Switching a treasury between a manual account (separate perps and spot
 * balances) and a unified one (one balance): what the form builds, what
 * stands in its way and what it says. Pure.
 *
 * Measured through multi-sigs on testnet (core: rules/multisig 1.4.0,
 * fixtures/multisig/mode-switch.json): both directions are one action,
 * `userSetAbstraction`; to unified is taken with positions and orders open;
 * back to manual is refused while anything is open; asking for the mode the
 * account already has is accepted and changes nothing.
 */
import {
	ABSTRACTION_ENVELOPE_CODES,
	type AccountMode,
	accountMode,
	cutTo,
	isolated,
	type PlainObject,
	sendRefusal,
	visibleText,
} from "@hl-tools/core";

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

export type ModeTarget = "unified" | "manual";

/** The name each mode has in the action, as Hyperliquid takes it. */
export const MODE_NAME: Readonly<Record<ModeTarget, string>> = {
	unified: "unifiedAccount",
	manual: "disabled",
};

/** The mode a `userSetAbstraction` switches to; null for any other action or mode. */
export function modeTargetOf(action: PlainObject): ModeTarget | null {
	if (action.type !== "userSetAbstraction") return null;
	if (action.abstraction === MODE_NAME.unified) return "unified";
	if (action.abstraction === MODE_NAME.manual) return "manual";
	return null;
}

/**
 * A mode switch this page cannot finish: one to a mode nobody measured. The
 * finaliser's signature is made over a one-letter code for the mode (the
 * core's `hashedEnvelopeAction`) and only the measured modes have one: over
 * the long name Hyperliquid answered "Invalid multi-sig outer signer", which
 * uses the proposal's number up. Null for any other action.
 */
export function unmeasuredSwitch(action: PlainObject): string | null {
	if (action.type !== "userSetAbstraction") return null;
	const mode = action.abstraction;
	if (typeof mode === "string" && mode in ABSTRACTION_ENVELOPE_CODES)
		return null;
	return MODE_UNMEASURED(mode);
}

/** Said before any wallet prompt, and on the proposal's page before anyone signs. */
export const MODE_UNMEASURED = (mode: unknown): string =>
	`This page was not tested with the mode ${typeof mode === "string" ? `“${isolated(cutTo(visibleText(mode), 40))}”` : "named here"}, so it cannot sign a switch to it: Hyperliquid would refuse it and use up the proposal's number. Use the unified or the manual account.`;

/**
 * The switch a treasury in this mode would make: the other of the two. Null
 * when the mode is not read, or is one this tool was not tested with.
 */
export function otherMode(
	mode: AccountMode | null | undefined,
): ModeTarget | null {
	if (!mode?.verified) return null;
	return mode.kind === "unified"
		? "manual"
		: mode.kind === "manual"
			? "unified"
			: null;
}

export interface SwitchFacts {
	/** The treasury's mode now: undefined while it is being read, null when it could not be. */
	readonly mode: AccountMode | null | undefined;
	/** Open positions and resting orders; null while not read. */
	readonly positions: number | null;
	readonly orders: number | null;
	/** The proposals still waiting, with what each would do. */
	readonly waiting: readonly {
		readonly action: PlainObject;
		readonly title: string;
	}[];
}

export interface SwitchJudgement {
	/** Hyperliquid would refuse it as things stand: the reason. */
	readonly blocked: string | null;
	/** One amber line each. */
	readonly warnings: readonly string[];
}

const TARGET_WORDS: Readonly<Record<ModeTarget, string>> = {
	unified: "a unified account",
	manual: "a manual account",
};

/** What stands in the way of a switch, and what a signer should know first. */
export function judgeSwitch(
	target: ModeTarget,
	facts: SwitchFacts,
): SwitchJudgement {
	const warnings: string[] = [];
	const { mode } = facts;
	const open = [
		facts.positions
			? plural(facts.positions, "open position", "open positions")
			: null,
		facts.orders ? plural(facts.orders, "open order", "open orders") : null,
	].filter((x): x is string => x !== null);
	// back to manual with anything open: "Cannot disable unified account with open positions…"
	const blocked =
		target === "manual" && open.length > 0
			? `Hyperliquid switches back to a manual account only when nothing is open, and this treasury has ${open.join(" and ")}. Close them with an API wallet first.`
			: null;

	if (mode === null)
		warnings.push(
			`This treasury's account mode could not be read from Hyperliquid. If it is already ${TARGET_WORDS[target]}, this changes nothing.`,
		);
	else if (mode && !mode.verified)
		warnings.push(
			`Hyperliquid reports the mode "${mode.raw}" for this treasury, which was not tested with this tool: whether it takes this switch is not known.`,
		);
	else if (mode && mode.kind === target)
		warnings.push(
			`This treasury is already ${TARGET_WORDS[target]}: Hyperliquid accepts this and nothing changes.`,
		);

	// what the new mode refuses and the present one does not
	const next = accountMode(MODE_NAME[target]);
	const lost = facts.waiting.filter(
		(w) =>
			sendRefusal(next, w.action) !== null &&
			(mode ? sendRefusal(mode, w.action) === null : true),
	);
	if (lost.length > 0)
		warnings.push(
			`${plural(lost.length, "waiting proposal", "waiting proposals")} would be refused once this is carried out: ${lost.map((w) => `“${isolated(w.title)}”`).join(", ")}. Carry ${lost.length === 1 ? "it" : "them"} out first, or propose ${lost.length === 1 ? "it" : "them"} again afterwards.`,
		);
	return { blocked, warnings };
}

/** Every sentence of Switch account mode that is not a judgement. */
export const MODE_SWITCH = {
	label: "Switch to",
	choice: {
		unified: "Unified account",
		manual: "Manual account",
	} satisfies Record<ModeTarget, string>,
	choose:
		"Choose which mode to switch to: the treasury's own could not be read.",
	/** What carrying it out changes. */
	changes: {
		unified:
			"The perps balance and the spot USDC become one balance. Positions and open orders stay as they are. Afterwards payments are taken from that one balance, and nothing needs moving between perps and spot.",
		manual:
			"Perps and spot become separate balances again. The USDC stays in the spot balance: moving some of it to perps is a Perps ↔ spot proposal afterwards. A running TWAP order stops this switch too, and this page cannot see one.",
	} satisfies Record<ModeTarget, string>,
	/** `tag` is the mode in the Overview's words ("unified account"). */
	now: (tag: string) => `This treasury's mode now: ${tag}.`,
	reading: "Reading the account mode from Hyperliquid…",
} as const;
