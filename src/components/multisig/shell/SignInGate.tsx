import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useWalletBusy } from "#/store/walletBusyStore";
import { RELAY_COPY } from "../model/relay/copy";
import { useRelay } from "../relay/useRelay";
import { Btn, Card, linkButton } from "./kit";
import { SmallPrint } from "./WalletBox";

/**
 * For screens that only exist with the relay in use (a treasury, the add
 * form): while it is not, say why and offer the way in. Returns null when the
 * relay is in use and the screen should render.
 */
export function SignInGate({ what }: { what: ReactNode }) {
	const relay = useRelay();
	const busy = useWalletBusy((b) => b.busy);
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
						: relay.mode === "suspended"
							? `${RELAY_COPY.suspended} Sign in with the connected wallet to see ${what}.`
							: `Sign in with your wallet to see ${what}.`}
				</p>
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
