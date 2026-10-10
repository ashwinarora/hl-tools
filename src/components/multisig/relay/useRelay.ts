import type { Address, Issue } from "@hl-tools/core";
import { createContext, useContext } from "react";
import type { RelayClient } from "./client";
import type { ChannelState } from "./realtime";

/**
 * off          this build has no relay: links and files only
 * signed-out   a relay exists; nobody is signed in in this browser
 * restoring    a stored session is being checked (or the wallet is still reconnecting)
 * on           the connected wallet is the one signed in: the relay is in use
 * suspended    signed in, but as another wallet than the one connected (or none is):
 *              nothing is read from or sent to the relay until that is resolved
 * unreachable  a session is stored but the relay did not answer
 */
export type RelayMode =
	| "off"
	| "signed-out"
	| "restoring"
	| "on"
	| "suspended"
	| "unreachable";

export interface RelayValue {
	readonly mode: RelayMode;
	/** The wallet the stored session speaks for (modes on and suspended). */
	readonly sessionWallet: Address | null;
	/** The wallet both connected and signed in; set in mode "on" only. */
	readonly wallet: Address | null;
	/** Set in mode "on" only: nothing else may talk to the relay. */
	readonly client: RelayClient | null;
	readonly signingIn: boolean;
	/** Why the last sign-in did not happen, until the next attempt. */
	readonly issue: Issue | null;
	readonly channel: ChannelState | null;
	/** Opens the wallet picker first when no wallet is connected. */
	signIn(): void;
	signOut(): void;
	/** Check a stored session again after the relay was unreachable. */
	retry(): void;
}

export const RELAY_OFF: RelayValue = {
	mode: "off",
	sessionWallet: null,
	wallet: null,
	client: null,
	signingIn: false,
	issue: null,
	channel: null,
	signIn: () => {},
	signOut: () => {},
	retry: () => {},
};

export const RelayContext = createContext<RelayValue>(RELAY_OFF);

export function useRelay(): RelayValue {
	return useContext(RelayContext);
}

/** Thrown by relay queries so the last good data stays on screen next to the problem. */
export class RelayQueryError extends Error {
	readonly issue: Issue;
	constructor(issue: Issue) {
		super(issue.message);
		this.name = "RelayQueryError";
		this.issue = issue;
	}
}

/** The issue behind a failed relay query, if that is what failed. */
export function queryIssue(error: unknown): Issue | null {
	return error instanceof RelayQueryError ? error.issue : null;
}
