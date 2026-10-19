import type { Address, Issue } from "@hl-tools/core";
import { createContext, useContext } from "react";
import type { RelayClient } from "./client";
import type { ChannelState } from "./realtime";

/**
 * off          this build has no relay: links and files only
 * signed-out   a relay exists; the connected wallet is not signed in here (or no wallet is connected)
 * restoring    the connected wallet's stored session is being checked (or the wallet is still reconnecting)
 * on           the connected wallet is signed in: the relay is in use, as that wallet
 * unreachable  the connected wallet has a stored session but the relay did not answer
 *
 * Several wallets can stay signed in in one browser. Only the connected one
 * is ever in use; the others are listed in `others` and nothing is read,
 * sent or renewed for them until they are connected again.
 */
export type RelayMode =
	| "off"
	| "signed-out"
	| "restoring"
	| "on"
	| "unreachable";

export interface RelayValue {
	readonly mode: RelayMode;
	/** The wallet the relay is in use as: connected and signed in. Set in mode "on" only. */
	readonly wallet: Address | null;
	/** That wallet's own client. Set in mode "on" only: nothing else may talk to the relay. */
	readonly client: RelayClient | null;
	/**
	 * The other wallets signed in in this browser, most recently used first.
	 * With no wallet connected, all of them.
	 */
	readonly others: readonly Address[];
	readonly signingIn: boolean;
	/** Why the last sign-in did not happen, until the next attempt. */
	readonly issue: Issue | null;
	readonly channel: ChannelState | null;
	/** Opens the wallet picker first when no wallet is connected. */
	signIn(): void;
	/** Signs the connected wallet out of this browser; the others stay signed in. */
	signOut(): void;
	/** Signs one wallet out of this browser, connected or not. */
	signOutWallet(wallet: Address): void;
	/** Signs every wallet out of this browser. */
	signOutAll(): void;
	/** Check a stored session again after the relay was unreachable. */
	retry(): void;
}

const NOBODY: readonly Address[] = [];

export const RELAY_OFF: RelayValue = {
	mode: "off",
	wallet: null,
	client: null,
	others: NOBODY,
	signingIn: false,
	issue: null,
	channel: null,
	signIn: () => {},
	signOut: () => {},
	signOutWallet: () => {},
	signOutAll: () => {},
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
