import type { Address } from "@hl-tools/core";
import { describe, expect, it } from "vitest";
import {
	type Identity,
	type IdentityEvent,
	identityStep,
	identityView,
	NO_IDENTITY,
	otherWallets,
	stillAsked,
} from "./identity";

const w = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const A = w(0xa1);
const B = w(0xb2);
const C = w(0xc3);

const run = (events: readonly IdentityEvent[], from: Identity = NO_IDENTITY) =>
	events.reduce(identityStep, from);
const wallet = (wallet: Address | null, stored: boolean): IdentityEvent => ({
	type: "wallet",
	wallet,
	stored,
});
const probed = (
	turn: number,
	result: "ready" | "none" | "unreachable",
): IdentityEvent => ({ type: "probed", turn, result });

const view = (
	identity: Identity,
	connected: Address | null,
	over: Partial<Parameters<typeof identityView>[0]> = {},
) =>
	identityView({
		mounted: true,
		walletStatus: connected ? "connected" : "disconnected",
		connected,
		identity,
		anyStored: true,
		...over,
	});

describe("connecting a wallet", () => {
	it("checks a stored session before using it", () => {
		const s = run([wallet(A, true)]);
		expect(s).toEqual({ wallet: A, slot: "restoring", turn: 1 });
		expect(view(s, A)).toEqual({ mode: "restoring", wallet: null });
		const ok = identityStep(s, probed(1, "ready"));
		expect(view(ok, A)).toEqual({ mode: "on", wallet: A });
	});

	it("is signed out for a wallet with no slot, whoever else is signed in here", () => {
		const s = run([wallet(B, false)]);
		expect(s.slot).toBe("none");
		expect(view(s, B)).toEqual({ mode: "signed-out", wallet: null });
	});

	it("says so when the relay does not answer, and keeps asking under the same question", () => {
		const s = run([wallet(A, true), probed(1, "unreachable")]);
		expect(view(s, A)).toEqual({ mode: "unreachable", wallet: null });
		// a quiet second try, same turn: its answer is taken
		expect(identityStep(s, probed(1, "ready")).slot).toBe("ready");
		// "Try again" asks afresh, and the earlier try's late answer is then dropped
		const again = identityStep(s, { type: "retry" });
		expect(again).toEqual({ wallet: A, slot: "restoring", turn: 2 });
		expect(identityStep(again, probed(1, "none"))).toBe(again);
		expect(identityStep(again, probed(2, "ready")).slot).toBe("ready");
	});

	it("finds a dead session and asks for a sign-in", () => {
		const s = run([wallet(A, true), probed(1, "none")]);
		expect(view(s, A)).toEqual({ mode: "signed-out", wallet: null });
	});
});

describe("switching wallets", () => {
	const onA = run([wallet(A, true), probed(1, "ready")]);

	it("uses the other wallet's own session, after checking it", () => {
		const toB = identityStep(onA, wallet(B, true));
		expect(toB).toEqual({ wallet: B, slot: "restoring", turn: 2 });
		expect(view(toB, B).wallet).toBeNull();
		const onB = identityStep(toB, probed(2, "ready"));
		expect(view(onB, B)).toEqual({ mode: "on", wallet: B });
		// and back, with no memory of A's earlier answer: it is asked again
		const back = identityStep(onB, wallet(A, true));
		expect(back.slot).toBe("restoring");
		expect(view(back, A).wallet).toBeNull();
	});

	it("never applies an answer about the wallet that was left", () => {
		// A is being checked, the wallet moves to B, A's answer arrives late
		const s = run([wallet(A, true), wallet(B, false)]);
		const late = identityStep(s, probed(1, "ready"));
		expect(late).toBe(s);
		expect(view(late, B)).toEqual({ mode: "signed-out", wallet: null });
	});

	it("A, B, A in quick succession: only the last question's answer counts", () => {
		const s = run([wallet(A, true), wallet(B, true), wallet(A, true)]);
		expect(s).toEqual({ wallet: A, slot: "restoring", turn: 3 });
		// answers to the first two questions, in any order, change nothing
		for (const stale of [
			probed(1, "ready"),
			probed(1, "none"),
			probed(2, "ready"),
			probed(2, "unreachable"),
		])
			expect(identityStep(s, stale)).toBe(s);
		expect(identityStep(s, probed(3, "ready")).slot).toBe("ready");
	});

	it("a sign-in that finishes after the wallet moved on is not applied to the new wallet", () => {
		// B has no session; its prompt is open (turn 2); the wallet goes back to A
		const s = run([wallet(B, false)], onA);
		expect(s.turn).toBe(2);
		const back = identityStep(s, wallet(A, true));
		const late = identityStep(back, { type: "signed-in", turn: 2 });
		expect(late).toBe(back);
		expect(view(late, A).wallet).toBeNull();
	});

	it("disconnecting uses nobody", () => {
		const off = identityStep(onA, wallet(null, false));
		expect(off).toEqual({ wallet: null, slot: "none", turn: 2 });
		expect(view(off, null)).toEqual({ mode: "signed-out", wallet: null });
		expect(identityStep(off, { type: "signed-in", turn: 2 })).toBe(off);
	});

	it("the same wallet announced again keeps its state", () => {
		expect(identityStep(onA, wallet(A, true))).toBe(onA);
		expect(identityStep(onA, wallet(A, false))).toBe(onA);
	});
});

describe("signing in and out", () => {
	it("a sign-in puts the connected wallet in use and voids what was asked before", () => {
		const s = run([wallet(B, false)]);
		const inB = identityStep(s, { type: "signed-in", turn: 1 });
		expect(inB).toEqual({ wallet: B, slot: "ready", turn: 2 });
		expect(identityStep(inB, probed(1, "none"))).toBe(inB);
	});

	it("signing out ends that wallet here, and a late answer cannot bring it back", () => {
		const s = run([wallet(A, true)]);
		// signed out while the check was still running
		const out = identityStep(s, { type: "ended", wallet: A });
		expect(out).toEqual({ wallet: A, slot: "none", turn: 2 });
		expect(identityStep(out, probed(1, "ready"))).toBe(out);
		expect(view(out, A)).toEqual({ mode: "signed-out", wallet: null });
	});

	it("another wallet's session ending does not touch the one in use", () => {
		const onA = run([wallet(A, true), probed(1, "ready")]);
		expect(identityStep(onA, { type: "ended", wallet: B })).toBe(onA);
		expect(identityStep(onA, { type: "appeared", wallet: B })).toBe(onA);
	});

	it("a session that another tab opened for the connected wallet is checked, then used", () => {
		const s = run([wallet(A, false)]);
		const seen = identityStep(s, { type: "appeared", wallet: A });
		expect(seen).toEqual({ wallet: A, slot: "restoring", turn: 2 });
		expect(identityStep(seen, probed(2, "ready")).slot).toBe("ready");
		// one that is already known is not asked about again
		const onA = run([wallet(A, true), probed(1, "ready")]);
		expect(identityStep(onA, { type: "appeared", wallet: A })).toBe(onA);
	});

	it("retry means something only after the relay did not answer", () => {
		for (const s of [
			NO_IDENTITY,
			run([wallet(A, true)]),
			run([wallet(A, true), probed(1, "ready")]),
			run([wallet(A, false)]),
		])
			expect(identityStep(s, { type: "retry" })).toBe(s);
	});
});

describe("what the screens are told", () => {
	const onA = run([wallet(A, true), probed(1, "ready")]);

	it("nothing is in use in the render where the wallet has changed and the state has not", () => {
		// the extension already says B; the state still says "A, ready"
		expect(view(onA, B)).toEqual({ mode: "restoring", wallet: null });
		expect(view(onA, null)).toEqual({ mode: "signed-out", wallet: null });
	});

	it("is checking, not signed out, before storage is known and while the wallet reconnects", () => {
		expect(view(NO_IDENTITY, null, { mounted: false }).mode).toBe("restoring");
		expect(view(onA, A, { mounted: false }).wallet).toBeNull();
		expect(view(NO_IDENTITY, null, { walletStatus: "reconnecting" }).mode).toBe(
			"restoring",
		);
		expect(view(NO_IDENTITY, null, { walletStatus: "connecting" }).mode).toBe(
			"restoring",
		);
	});

	it("is signed out while a wallet is being picked and nobody is signed in here", () => {
		expect(
			view(NO_IDENTITY, null, { walletStatus: "connecting", anyStored: false })
				.mode,
		).toBe("signed-out");
		expect(view(NO_IDENTITY, null, { walletStatus: "disconnected" }).mode).toBe(
			"signed-out",
		);
	});

	it("lists the other wallets signed in here, never the connected one", () => {
		expect(otherWallets([A, B, C], B)).toEqual([A, C]);
		expect(otherWallets([A, B], null)).toEqual([A, B]);
		expect(otherWallets([], A)).toEqual([]);
	});

	it("tells an answer that is still wanted from one that is not", () => {
		expect(stillAsked(onA, A, 1)).toBe(true);
		expect(stillAsked(onA, A, 0)).toBe(false);
		expect(stillAsked(onA, B, 1)).toBe(false);
	});
});

describe("every order of events", () => {
	// A small generator with a fixed seed: the same thousands of histories on every run.
	function* histories(seed: number, count: number, length: number) {
		let x = seed;
		const next = (n: number) => {
			x = (x * 1103515245 + 12345) & 0x7fffffff;
			return x % n;
		};
		const wallets = [A, B, C, null] as const;
		const results = ["ready", "none", "unreachable"] as const;
		for (let h = 0; h < count; h++) {
			const events: IdentityEvent[] = [];
			for (let i = 0; i < length; i++) {
				const turn = next(length + 2);
				switch (next(6)) {
					case 0:
						events.push(
							wallet(wallets[next(4)] as Address | null, next(2) === 0),
						);
						break;
					case 1:
						events.push(probed(turn, results[next(3)] ?? "none"));
						break;
					case 2:
						events.push({ type: "signed-in", turn });
						break;
					case 3:
						events.push({ type: "ended", wallet: wallets[next(3)] as Address });
						break;
					case 4:
						events.push({
							type: "appeared",
							wallet: wallets[next(3)] as Address,
						});
						break;
					default:
						events.push({ type: "retry" });
				}
			}
			yield events;
		}
	}

	it("the wallet in use is always the connected one, and only after the relay confirmed it under the current question", () => {
		let checked = 0;
		for (const events of histories(20261012, 4000, 14)) {
			let s = NO_IDENTITY;
			/** The connected wallet, as the events say. */
			let connected: Address | null = null;
			/** The turn under which the current wallet was last confirmed, if it still is. */
			let confirmedAt: number | null = null;
			for (const e of events) {
				const before = s;
				s = identityStep(s, e);
				if (e.type === "wallet") connected = e.wallet;
				// the count never goes back, and moves whenever the wallet or the slot's meaning does
				expect(s.turn).toBeGreaterThanOrEqual(before.turn);
				if (s.wallet !== before.wallet) expect(s.turn).toBe(before.turn + 1);
				expect(s.wallet).toBe(connected);
				// "ready" is only ever reached by an answer or a sign-in under the question that stood
				if (s.slot === "ready" && before.slot !== "ready") {
					expect(e.type === "probed" || e.type === "signed-in").toBe(true);
					expect((e as { turn: number }).turn).toBe(before.turn);
					expect(before.wallet).toBe(connected);
					confirmedAt = s.turn;
				}
				if (s.slot !== "ready") confirmedAt = null;
				if (s.slot === "ready") expect(confirmedAt).toBe(s.turn);
				const v = view(s, connected);
				expect(v.wallet === null || v.wallet === connected).toBe(true);
				expect(v.mode === "on").toBe(s.slot === "ready" && connected !== null);
				// with no wallet connected nothing is ever in use
				if (connected === null) expect(v.wallet).toBeNull();
				// and whatever the extension says in a render, a state about another wallet is not used
				for (const other of [A, B, C, null])
					if (other !== s.wallet) expect(view(s, other).wallet).toBeNull();
				checked++;
			}
		}
		expect(checked).toBe(4000 * 14);
	});
});
