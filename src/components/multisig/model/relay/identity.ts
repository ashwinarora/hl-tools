/**
 * Who the relay is used as: always the connected wallet, never another.
 *
 * Several wallets can stay signed in in one browser, each in its own slot
 * (`wallets.ts`). At any moment at most one of them is in use: the one the
 * wallet extension has connected. This file is the whole rule for that, with
 * no React and no network, so every order of events can be tested:
 *
 * - the state is about one wallet, the connected one, and what is known of
 *   its session;
 * - an answer that was asked for under an earlier state (another wallet, or
 *   the same wallet before it signed out) is dropped, never applied;
 * - what the screens get (`identityView`) names a wallet as in use only when
 *   it is the connected one and the relay has confirmed its session.
 */
import type { Address } from "@hl-tools/core";

/**
 * none         no session is stored for this wallet (or no wallet is connected)
 * restoring    a stored session is being checked with the relay
 * ready        the relay has said the stored session speaks for this wallet
 * unreachable  a session is stored but the relay did not answer
 */
export type Slot = "none" | "restoring" | "ready" | "unreachable";

export interface Identity {
	/** The connected wallet, in lowercase; null while none is connected. */
	readonly wallet: Address | null;
	readonly slot: Slot;
	/**
	 * Counts every change of who the state is about or of what it holds. An
	 * answer carries the count it was asked under, and is applied only while
	 * the count still stands.
	 */
	readonly turn: number;
}

export const NO_IDENTITY: Identity = { wallet: null, slot: "none", turn: 0 };

export type IdentityEvent =
	/** The wallet extension now has this wallet connected (or none); `stored`: it has a slot here. */
	| {
			readonly type: "wallet";
			readonly wallet: Address | null;
			readonly stored: boolean;
	  }
	/** The relay's answer about the stored session, asked under `turn`. */
	| {
			readonly type: "probed";
			readonly turn: number;
			readonly result: "ready" | "none" | "unreachable";
	  }
	/** A sign-in started under `turn` succeeded: the relay opened a session for the wallet. */
	| { readonly type: "signed-in"; readonly turn: number }
	/**
	 * `wallet`'s session ended: signed out here or in another tab, or the relay
	 * refused to renew it.
	 */
	| { readonly type: "ended"; readonly wallet: Address }
	/** A slot appeared for `wallet` from outside this page (another tab signed in). */
	| { readonly type: "appeared"; readonly wallet: Address }
	/** Ask the relay again after it did not answer. */
	| { readonly type: "retry" };

export function identityStep(s: Identity, e: IdentityEvent): Identity {
	switch (e.type) {
		case "wallet": {
			// the same wallet announced again changes nothing: its state stands
			if (e.wallet === s.wallet) return s;
			return {
				wallet: e.wallet,
				slot: e.wallet && e.stored ? "restoring" : "none",
				turn: s.turn + 1,
			};
		}
		case "probed": {
			// asked about another wallet, or about this one before something changed
			if (e.turn !== s.turn) return s;
			// only a question that is still open has an answer
			if (s.slot !== "restoring" && s.slot !== "unreachable") return s;
			return { ...s, slot: e.result };
		}
		case "signed-in": {
			// the wallet was switched while its prompt was open: the session is in
			// that wallet's slot and is found when it is connected again
			if (e.turn !== s.turn || s.wallet === null) return s;
			return { ...s, slot: "ready", turn: s.turn + 1 };
		}
		case "ended": {
			if (e.wallet !== s.wallet || s.slot === "none") return s;
			return { ...s, slot: "none", turn: s.turn + 1 };
		}
		case "appeared": {
			if (e.wallet !== s.wallet || s.slot !== "none") return s;
			return { ...s, slot: "restoring", turn: s.turn + 1 };
		}
		case "retry": {
			if (s.slot !== "unreachable") return s;
			return { ...s, slot: "restoring", turn: s.turn + 1 };
		}
	}
}

/** Whether an answer asked under `turn` for `wallet` would still be applied. */
export function stillAsked(
	s: Identity,
	wallet: Address,
	turn: number,
): boolean {
	return s.wallet === wallet && s.turn === turn;
}

export type IdentityMode = "signed-out" | "restoring" | "on" | "unreachable";

export interface IdentityView {
	readonly mode: IdentityMode;
	/**
	 * The wallet the relay is in use as. Set in mode "on" only, and then it is
	 * the connected wallet: no screen is ever handed another one.
	 */
	readonly wallet: Address | null;
}

/**
 * What the screens are told. `connected` is what the wallet extension says in
 * this very render; `identity` can be one render behind it (it follows in an
 * effect), and while it is, nothing is in use.
 */
export function identityView(i: {
	/** False on the server and in the first client render: storage is not known yet. */
	readonly mounted: boolean;
	readonly walletStatus:
		| "connected"
		| "connecting"
		| "reconnecting"
		| "disconnected";
	readonly connected: Address | null;
	readonly identity: Identity;
	/** Some wallet has a slot in this browser. */
	readonly anyStored: boolean;
	/**
	 * The wallet stack has started looking for the connection it remembered.
	 * It does so a moment after the page has mounted; until then "no wallet
	 * connected" is not known, only not yet looked at.
	 */
	readonly walletLooked: boolean;
}): IdentityView {
	const wait: IdentityView = { mode: "restoring", wallet: null };
	const out: IdentityView = { mode: "signed-out", wallet: null };
	if (!i.mounted) return wait;
	if (i.connected === null) {
		// The wallet stack brings its connection back a moment after load. Only
		// when somebody is signed in here is that worth waiting for: a wallet
		// that is being picked for the first time has nobody behind it.
		const returning =
			!i.walletLooked ||
			i.walletStatus === "reconnecting" ||
			i.walletStatus === "connecting";
		return i.anyStored && returning ? wait : out;
	}
	// the state has not caught up with the wallet yet: nothing is in use
	if (i.identity.wallet !== i.connected) return wait;
	switch (i.identity.slot) {
		case "none":
			return out;
		case "restoring":
			return wait;
		case "unreachable":
			return { mode: "unreachable", wallet: null };
		case "ready":
			return { mode: "on", wallet: i.connected };
	}
}

/** The other wallets signed in in this browser, for the list under the connected one. */
export function otherWallets(
	stored: readonly Address[],
	connected: Address | null,
): Address[] {
	return stored.filter((w) => w !== connected);
}
