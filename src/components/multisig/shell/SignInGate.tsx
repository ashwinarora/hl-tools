import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useWalletBusy } from "#/store/walletBusyStore";
import { gateOthers, RELAY_COPY } from "../model/relay/copy";
import { useRelay } from "../relay/useRelay";
import { Btn, Card, linkButton } from "./kit";
import { SmallPrint, useShellWallet } from "./WalletBox";

/**
 * For screens that only exist with the relay in use (a treasury, the add
 * form): while it is not, say why and offer the way in. Returns null when the
 * relay is in use and the screen should render.
 */
export function SignInGate({
	what,
	say,
}: {
	what: ReactNode;
	/** In place of "Sign in with your wallet to see …", for a screen that does something. */
	say?: string;
}) {
	const relay = useRelay();
	const busy = useWalletBusy((b) => b.busy);
	const { connected } = useShellWallet();
	if (relay.mode === "on") return null;
	if (relay.mode === "off") {
		return (
			<Card>
				<p className="text-sm text-muted-foreground">
					This build has no relay, so there is nothing to show here. Proposals
					still work as links and files.
				</p>
				<Link to="/multisig/open" className={`${linkButton} mt-3`}>
					Open or start a proposal
				</Link>
			</Card>
		);
	}
	if (relay.mode === "restoring") {
		return (
			<Card>
				<p className="text-sm text-muted-foreground" aria-busy="true">
					Checking your session…
				</p>
			</Card>
		);
	}
	return (
		<Card>
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					{relay.mode === "unreachable"
						? RELAY_COPY.unreachable
						: (say ?? `Sign in with your wallet to see ${what}.`)}
				</p>
				{/* the wallet was switched to one that is not signed in: say where the other went */}
				{relay.mode === "signed-out" && relay.others.length > 0 && (
					<p className="text-xs text-muted-foreground">
						{gateOthers(relay.others.length, connected)}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2">
					{relay.mode === "unreachable" ? (
						<Btn variant="outline" onClick={relay.retry}>
							Try again
						</Btn>
					) : (
						<Btn variant="brand" disabled={busy} onClick={relay.signIn}>
							{relay.signingIn
								? "Waiting for your wallet…"
								: RELAY_COPY.signInButton}
						</Btn>
					)}
					<Link to="/multisig/open" className={linkButton}>
						Open or start a proposal
					</Link>
				</div>
				{relay.mode !== "unreachable" && <SmallPrint />}
			</div>
		</Card>
	);
}
