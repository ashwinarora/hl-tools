import type { Address, Issue } from "@hl-tools/core";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { generateSiweNonce } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import { NO_WALLET, walletInBrowser } from "#/lib/signerWallets";
import { useWalletBusy } from "#/store/walletBusyStore";
import { relayIssue, SESSION_ENDED } from "../model/relay/errors";
import {
	connectedWallet,
	identityStep,
	identityView,
	NO_IDENTITY,
	otherWallets,
	stillAsked,
} from "../model/relay/identity";
import { reconnectDelay } from "../model/relay/reconnect";
import {
	adoptLegacy,
	forgetWallet,
	hasSlot,
	overLimit,
	RELAY_USED_KEY,
	storedWallets,
	touchWallet,
	walletOfSlot,
} from "../model/relay/wallets";
import {
	browserSlots,
	endStoredSession,
	getRelayClient,
	onSessionEnded,
	type RelayClient,
} from "./client";
import { relayConfig } from "./config";
import { type ChannelState, subscribeWallet } from "./realtime";
import { endSession, probeFor, signIn } from "./session";
import {
	RELAY_OFF,
	RelayContext,
	type RelayMode,
	type RelayValue,
} from "./useRelay";

/**
 * The relay sessions for the Multisig section.
 *
 * Sign-in is one message signed by the wallet, and the session it opens
 * belongs to that wallet. Several wallets can stay signed in in one browser,
 * each in its own slot with its own client; the one in use is always the
 * wallet that is connected right now, and only after the relay has said that
 * its stored session speaks for it. Connecting another wallet signs nobody
 * out: the one that was in use is parked (no reads, no writes, no token
 * renewal, no channel) and the newly connected one is used if it is signed
 * in, or offered a sign-in if it is not. The rule itself is
 * `model/relay/identity.ts`; this component is its hands.
 */
export function RelayProvider({ children }: { children: ReactNode }) {
	const config = useMemo(() => relayConfig(), []);
	if (!config) {
		return (
			<RelayContext.Provider value={RELAY_OFF}>
				{children}
			</RelayContext.Provider>
		);
	}
	return <RelaySession config={config}>{children}</RelaySession>;
}

function RelaySession({
	config,
	children,
}: {
	config: NonNullable<ReturnType<typeof relayConfig>>;
	children: ReactNode;
}) {
	const queries = useQueryClient();
	const account = useAccount();
	const { chainId, status: walletStatus } = account;
	const { signMessageAsync } = useSignMessage();
	const { openConnectModal } = useConnectModal();
	// one definition of "connected" for the relay and for the rail
	const connected = connectedWallet(account);
	const address = connected ? account.address : undefined;
	const slots = useMemo(() => browserSlots(), []);

	// Whether anything is stored is only known after mount. Until then the page
	// says it is checking, never "sign in": the server's HTML can stay on screen
	// for a while on a slow connection, in front of someone who is signed in.
	const [mounted, setMounted] = useState(false);
	const [identity, dispatch] = useReducer(identityStep, NO_IDENTITY);
	// what an answer that arrives later is checked against
	const latest = useRef(identity);
	latest.current = identity;
	/** Every wallet with a slot in this browser, most recently used first. */
	const [stored, setStored] = useState<readonly Address[]>([]);
	/** The clients whose stored session the relay has confirmed, by wallet. */
	const confirmed = useRef(new Map<Address, RelayClient>());
	const [signingIn, setSigningIn] = useState(false);
	const [issue, setIssue] = useState<Issue | null>(null);
	const [channel, setChannel] = useState<ChannelState | null>(null);
	const [unanswered, setUnanswered] = useState(0);
	const wantsSignIn = useRef(false);

	const readStored = useCallback(
		() => setStored(slots ? storedWallets(slots) : []),
		[slots],
	);

	useEffect(() => {
		// the one session of the time before there was a slot per wallet
		if (slots) adoptLegacy(slots, Date.now());
		readStored();
		setMounted(true);
	}, [slots, readStored]);

	// The state follows the wallet extension, one step behind it; until it has
	// caught up nothing is in use (`identityView`).
	useEffect(() => {
		if (!mounted) return;
		dispatch({
			type: "wallet",
			wallet: connected,
			stored: !!connected && !!slots && hasSlot(slots, connected),
		});
		// what was said about the wallet before does not concern this one
		setIssue(null);
		setUnanswered(0);
	}, [mounted, connected, slots]);

	const asking = useRef(new Set<string>());
	const probe = useCallback(
		async (wallet: Address, turn: number) => {
			if (!slots) return;
			const key = `${wallet}:${turn}`;
			if (asking.current.has(key)) return;
			asking.current.add(key);
			let result: "ready" | "none" | "unreachable";
			try {
				const client = await getRelayClient(config, wallet);
				result = await probeFor(client, wallet, slots);
				if (result === "ready") confirmed.current.set(wallet, client);
				else if (result === "none") confirmed.current.delete(wallet);
			} catch {
				// the client could not even be loaded
				result = "unreachable";
			} finally {
				asking.current.delete(key);
			}
			if (stillAsked(latest.current, wallet, turn)) {
				if (result === "ready") touchWallet(slots, wallet, Date.now());
				setUnanswered((n) => (result === "unreachable" ? n + 1 : 0));
			}
			readStored();
			// an answer nobody waits for any more is dropped by the rule itself
			dispatch({ type: "probed", turn, result });
		},
		[config, slots, readStored],
	);

	useEffect(() => {
		if (identity.slot === "restoring" && identity.wallet)
			void probe(identity.wallet, identity.turn);
	}, [identity.slot, identity.wallet, identity.turn, probe]);

	// The relay not answering is usually brief. Ask again on a slowing schedule,
	// and at once when the browser is back online or the tab is looked at again.
	// Asked under the same question, so the rail keeps saying "unreachable"
	// until the relay really answers.
	const down = identity.slot === "unreachable" ? identity.wallet : null;
	const downTurn = identity.turn;
	useEffect(() => {
		if (!down) return;
		const again = () => void probe(down, downTurn);
		const timer = setTimeout(again, reconnectDelay(unanswered - 1));
		const seen = () => {
			if (document.visibilityState === "visible") again();
		};
		window.addEventListener("online", again);
		document.addEventListener("visibilitychange", seen);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("online", again);
			document.removeEventListener("visibilitychange", seen);
		};
	}, [down, downTurn, unanswered, probe]);

	// The wallet stack starts looking for its remembered connection a moment
	// after mount, and says so by leaving "disconnected". Until then nothing is
	// said about there being no wallet. (The timer is for a stack that never looks.)
	const [walletLooked, setWalletLooked] = useState(false);
	useEffect(() => {
		if (walletStatus !== "disconnected") setWalletLooked(true);
	}, [walletStatus]);
	useEffect(() => {
		const timer = setTimeout(() => setWalletLooked(true), 1500);
		return () => clearTimeout(timer);
	}, []);

	const view = identityView({
		mounted,
		walletStatus,
		connected,
		identity,
		anyStored: stored.length > 0,
		walletLooked,
	});
	// "on" always comes with the client of that very wallet, or it is not "on"
	const active = view.wallet
		? (confirmed.current.get(view.wallet) ?? null)
		: null;
	const mode: RelayMode =
		view.mode === "on" && !active ? "restoring" : view.mode;
	const wallet = mode === "on" ? view.wallet : null;

	// What was read as one wallet is not kept once another is in use, or none.
	useEffect(() => {
		queries.removeQueries({
			predicate: (q) => q.queryKey[0] === "relay" && q.queryKey[1] !== wallet,
		});
	}, [wallet, queries]);

	/** A wallet's session is over, however that came about: the page lets go of it. */
	const letGo = useCallback(
		(gone: Address) => {
			confirmed.current.delete(gone);
			dispatch({ type: "ended", wallet: gone });
			queries.removeQueries({
				predicate: (q) => q.queryKey[0] === "relay" && q.queryKey[1] === gone,
			});
			readStored();
		},
		[queries, readStored],
	);

	/** Sign a wallet out of this browser: its slot first, then the relay's side. */
	const end = useCallback(
		(gone: Address) => {
			if (slots)
				void endSession(gone, slots, (raw) => endStoredSession(config, raw));
			letGo(gone);
		},
		[config, slots, letGo],
	);

	// The relay says a wallet's session has ended (signed out elsewhere, or
	// ended by whoever runs the relay): what its slot holds is dead. The wallet
	// is asked to sign in again, and told why.
	useEffect(() => {
		if (!slots) return;
		return onSessionEnded((gone) => {
			const now = latest.current;
			const wasInUse = now.wallet === gone && now.slot !== "none";
			forgetWallet(slots, gone);
			letGo(gone);
			if (wasInUse) setIssue(relayIssue({ message: SESSION_ENDED }));
		});
	}, [slots, letGo]);

	// The session ending on its own (renewal refused, signed out in another tab).
	useEffect(() => {
		if (!active || !wallet) return;
		const { data } = active.auth.onAuthStateChange((event) => {
			if (event === "SIGNED_OUT") end(wallet);
		});
		return () => data.subscription.unsubscribe();
	}, [active, wallet, end]);

	// Another tab signed a wallet in or out: this one follows.
	useEffect(() => {
		if (!slots) return;
		const on = (ev: StorageEvent) => {
			if (ev.storageArea !== slots) return;
			if (ev.key === null) {
				// everything was cleared
				const now = latest.current.wallet;
				if (now && !hasSlot(slots, now)) letGo(now);
				else readStored();
				return;
			}
			const changed = walletOfSlot(ev.key);
			if (!changed) {
				if (ev.key === RELAY_USED_KEY) readStored();
				return;
			}
			if (ev.newValue === null) letGo(changed);
			else {
				readStored();
				dispatch({ type: "appeared", wallet: changed });
			}
		};
		window.addEventListener("storage", on);
		return () => window.removeEventListener("storage", on);
	}, [slots, letGo, readStored]);

	// Token renewal and the wallet's channel run only for the wallet in use,
	// and stop when it is parked or the section is left.
	useEffect(() => {
		if (!active || !wallet) return;
		void active.auth.startAutoRefresh();
		const leave = subscribeWallet(
			active,
			wallet,
			() => void queries.invalidateQueries({ queryKey: ["relay"] }),
			setChannel,
		);
		return () => {
			leave();
			setChannel(null);
			void active.auth.stopAutoRefresh();
		};
	}, [active, wallet, queries]);

	const doSignIn = useCallback(async () => {
		if (!address || !slots) return;
		const me = address.toLowerCase() as Address;
		const { turn } = latest.current;
		// the button was for the wallet the state is about, and only while it is signed out
		if (latest.current.wallet !== me || latest.current.slot !== "none") return;
		if (!useWalletBusy.getState().begin()) return;
		setSigningIn(true);
		setIssue(null);
		const waiting = toast.loading(
			"Waiting for your wallet: sign in to hl-tools",
		);
		try {
			// this wallet's own client: no other wallet's session is touched
			const c = await getRelayClient(config, me);
			const r = await signIn(
				c,
				{
					address,
					chainId: chainId ?? 1,
					// asked of this very account: a wallet that was switched while the
					// prompt was open signs as the one that was asked, or not at all
					signMessage: (message) =>
						signMessageAsync({ account: address, message }),
				},
				{ origin: window.location.origin, nonce: generateSiweNonce() },
			);
			if (r.ok) {
				confirmed.current.set(me, c);
				touchWallet(slots, me, Date.now());
				// the number kept at rest is bounded: the least recently used go
				for (const gone of overLimit(storedWallets(slots), me)) end(gone);
				readStored();
				// dropped by the rule if the wallet was switched while its prompt was open
				dispatch({ type: "signed-in", turn });
			} else {
				// a session left behind by a sign-in the relay could not finish is asked about
				if (hasSlot(slots, me)) dispatch({ type: "appeared", wallet: me });
				if (stillAsked(latest.current, me, turn)) setIssue(r.issue);
			}
		} catch (e) {
			if (stillAsked(latest.current, me, turn)) setIssue(relayIssue(e));
		} finally {
			toast.dismiss(waiting);
			useWalletBusy.getState().end();
			setSigningIn(false);
		}
	}, [address, chainId, config, slots, end, readStored, signMessageAsync]);

	// "Sign in" with no wallet connected opens the picker; the sign-in follows
	// the connection, unless the wallet that was picked is signed in already.
	const settled =
		identity.wallet === connected && identity.slot !== "restoring";
	const slot = identity.slot;
	useEffect(() => {
		if (!wantsSignIn.current || !connected || !settled) return;
		wantsSignIn.current = false;
		if (slot === "none") void doSignIn();
	}, [connected, settled, slot, doSignIn]);

	const others = useMemo(
		() => otherWallets(stored, connected),
		[stored, connected],
	);

	const value = useMemo<RelayValue>(
		() => ({
			mode,
			wallet,
			client: mode === "on" ? active : null,
			others,
			signingIn,
			issue,
			channel,
			signIn: () => {
				if (address) void doSignIn();
				else if (!walletInBrowser()) {
					// the picker would open empty
					toast.warning(NO_WALLET);
				} else {
					wantsSignIn.current = true;
					openConnectModal?.();
				}
			},
			signOut: () => {
				setIssue(null);
				wantsSignIn.current = false;
				if (connected) end(connected);
			},
			signOutWallet: (gone) => end(gone),
			signOutAll: () => {
				setIssue(null);
				wantsSignIn.current = false;
				for (const gone of slots ? storedWallets(slots) : []) end(gone);
			},
			retry: () => dispatch({ type: "retry" }),
		}),
		[
			mode,
			wallet,
			active,
			others,
			signingIn,
			issue,
			channel,
			address,
			connected,
			slots,
			doSignIn,
			openConnectModal,
			end,
		],
	);

	return (
		<RelayContext.Provider value={value}>{children}</RelayContext.Provider>
	);
}
