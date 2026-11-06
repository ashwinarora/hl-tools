/**
 * An API wallet's expiry, as `approveAgent` carries it: the docs' " valid_until
 * <ms>" after the name. Measured through a multi-sig on testnet
 * (fixtures/multisig/agent-expiry.json): Hyperliquid lists the wallet under the
 * name without the suffix, with `validUntil` exactly the moment asked, and
 * refuses a moment past or more than `AGENT_MAX_VALID_MS` ahead.
 */

import { AGENT_MAX_VALID_MS } from "../rules/multisig.ts";

const SUFFIX = / valid_until (\d{1,16})$/;

export interface AgentNameParts {
	/** The name Hyperliquid lists the wallet under. */
	readonly name: string;
	/** The moment it stops acting, when the name asks for one. */
	readonly validUntil: number | null;
}

/**
 * The name as Hyperliquid stores it and the moment the suffix asks for. Only
 * the measured form counts: a name, one space, `valid_until`, one space and
 * the milliseconds. Anything else is a plain name.
 */
export function agentNameParts(agentName: string): AgentNameParts {
	const m = SUFFIX.exec(agentName);
	if (!m || m.index === 0) return { name: agentName, validUntil: null };
	const ms = Number(m[1]);
	if (!Number.isSafeInteger(ms)) return { name: agentName, validUntil: null };
	return { name: agentName.slice(0, m.index), validUntil: ms };
}

/** The name to sign for a wallet that stops acting at `validUntil`. */
export function agentNameWithExpiry(name: string, validUntil: number): string {
	return `${name} valid_until ${Math.trunc(validUntil)}`;
}

/**
 * Whether Hyperliquid takes this moment when the approval is carried out at
 * `at`: still ahead, and not more than the limit ahead.
 */
export function agentExpiryTaken(validUntil: number, at: number): boolean {
	return validUntil > at && validUntil - at <= AGENT_MAX_VALID_MS;
}
