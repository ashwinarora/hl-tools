import type { Address, Issue } from "@hl-tools/core";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { generateSiweNonce } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import { useWalletBusy } from "#/store/walletBusyStore";
import { reconnectDelay } from "../model/relay/reconnect";
import { getRelayClient, hasStoredSession, type RelayClient } from "./client";
import { relayConfig } from "./config";
import { type ChannelState, subscribeWallet } from "./realtime";
import { probeSession, signIn, signOut } from "./session";
import {
	RELAY_OFF,
	RelayContext,
	type RelayMode,
	type RelayValue,
} from "./useRelay";

type Session =
	| { readonly status: "none" }
	| { readonly status: "restoring" }
	| { readonly status: "unreachable" }
	| {
			readonly status: "ready";
			readonly client: RelayClient;
			readonly wallet: Address;
	  };

/**
 * The relay session for the Multisig section: restore it when the section
 * opens, tie it to the connected wallet, and keep everything else away from
 * the relay unless the two agree.
 *
 * Sign-in is one message signed by the wallet. The session then belongs to
 * that wallet; connecting another one does not sign anybody out, it suspends
 * the relay (no reads, no writes, no token renewal, no channel) until the
 * wallets agree again or the other wallet signs in.
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
	const { address, chainId, status: walletStatus } = useAccount();
	const { signMessageAsync } = useSignMessage();
	const { openConnectModal } = useConnectModal();
	const connected = address ? (address.toLowerCase() as Address) : null;

	// The server renders "signed out"; whether a session is stored is only known after mount.
	const [session, setSession] = useState<Session>({ status: "none" });
	const [signingIn, setSigningIn] = useState(false);
	const [issue, setIssue] = useState<Issue | null>(null);
	const [channel, setChannel] = useState<ChannelState | null>(null);
	const wantsSignIn = useRef(false);

	const forget = useCallback(() => {
		setSession({ status: "none" });
		queries.removeQueries({ queryKey: ["relay"] });
	}, [queries]);

	// `quiet` asks again without flashing the "restoring" skeleton: the rail
	// keeps saying "unreachable" until the relay really answers.
	const probing = useRef(false);
	const [unanswered, setUnanswered] = useState(0);
	const restore = useCallback(
		async (quiet = false) => {
			if (probing.current) return;
			if (!hasStoredSession()) {
				setSession({ status: "none" });
				setUnanswered(0);
				return;
			}
			probing.current = true;
			try {
				if (!quiet) setSession({ status: "restoring" });
				const client = await getRelayClient(config);
				const probe = await probeSession(client);
				setSession(
					probe.status === "ready"
						? { status: "ready", client, wallet: probe.wallet }
						: { status: probe.status },
				);
				setUnanswered((n) => (probe.status === "unreachable" ? n + 1 : 0));
			} finally {
				probing.current = false;
			}
		},
		[config],
	);

	useEffect(() => {
		void restore();
	}, [restore]);

	// The relay not answering is usually brief. Ask again on a slowing schedule,
	// and at once when the browser is back online or the tab is looked at again.
	const down = session.status === "unreachable";
	useEffect(() => {
		if (!down) return;
		const again = () => void restore(true);
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
	}, [down, unanswered, restore]);

	const mode: RelayMode =
		session.status === "none"
			? "signed-out"
			: session.status === "restoring"
				? "restoring"
				: session.status === "unreachable"
					? "unreachable"
					: connected === session.wallet
						? "on"
						: // the wallet stack reconnects a moment after load: not a mismatch yet
							walletStatus === "reconnecting" || walletStatus === "connecting"
							? "restoring"
							: "suspended";

	const client = session.status === "ready" ? session.client : null;
	const sessionWallet = session.status === "ready" ? session.wallet : null;
	const active = mode === "on" ? client : null;

	// The session ending on its own (renewal refused, signed out elsewhere).
	useEffect(() => {
		if (!client) return;
		const { data } = client.auth.onAuthStateChange((event) => {
			if (event === "SIGNED_OUT") forget();
		});
		return () => data.subscription.unsubscribe();
	}, [client, forget]);

	// Token renewal and the wallet's channel run only while the relay is in use,
	// and stop when the section is left.
	useEffect(() => {
		if (!active || !sessionWallet) return;
		void active.auth.startAutoRefresh();
		const leave = subscribeWallet(
			active,
			sessionWallet,
			() => void queries.invalidateQueries({ queryKey: ["relay"] }),
			setChannel,
		);
		return () => {
			leave();
			setChannel(null);
			void active.auth.stopAutoRefresh();
		};
	}, [active, sessionWallet, queries]);

	const doSignIn = useCallback(async () => {
		if (!address) return;
		if (!useWalletBusy.getState().begin()) return;
		setSigningIn(true);
		setIssue(null);
		const waiting = toast.loading(
			"Waiting for your wallet: sign in to hl-tools",
		);
		try {
			const c = await getRelayClient(config);
			// another wallet's session in this browser ends here
			if (session.status === "ready") await signOut(c);
			const r = await signIn(
				c,
				{
					address,
					chainId: chainId ?? 1,
					signMessage: (message) => signMessageAsync({ message }),
				},
				{ origin: window.location.origin, nonce: generateSiweNonce() },
			);
			if (r.ok) {
				queries.removeQueries({ queryKey: ["relay"] });
				setSession({ status: "ready", client: c, wallet: r.wallet });
			} else {
				if (session.status === "ready") setSession({ status: "none" });
				setIssue(r.issue);
			}
		} finally {
			toast.dismiss(waiting);
			useWalletBusy.getState().end();
			setSigningIn(false);
		}
	}, [address, chainId, config, queries, session.status, signMessageAsync]);

	// "Sign in" with no wallet connected opens the picker; the sign-in follows the connection.
	useEffect(() => {
		if (wantsSignIn.current && address) {
			wantsSignIn.current = false;
			void doSignIn();
		}
	}, [address, doSignIn]);

	const value = useMemo<RelayValue>(
		() => ({
			mode,
			sessionWallet,
			wallet: mode === "on" ? sessionWallet : null,
			client: active,
			signingIn,
			issue,
			channel,
			signIn: () => {
				if (address) void doSignIn();
				else {
					wantsSignIn.current = true;
					openConnectModal?.();
				}
			},
			signOut: () => {
				setIssue(null);
				if (client) void signOut(client);
				forget();
			},
			retry: () => void restore(),
		}),
		[
			mode,
			sessionWallet,
			active,
			signingIn,
			issue,
			channel,
			address,
			doSignIn,
			openConnectModal,
			client,
			forget,
			restore,
		],
	);

	return (
		<RelayContext.Provider value={value}>{children}</RelayContext.Provider>
	);
}
