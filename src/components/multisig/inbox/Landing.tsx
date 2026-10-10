import { Link } from "@tanstack/react-router";
import { useWalletBusy } from "#/store/walletBusyStore";
import { RELAY_COPY } from "../model/relay/copy";
import { useRelay } from "../relay/useRelay";
import { Btn, Card, linkButton, SignsTag } from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";
import { SmallPrint } from "../shell/WalletBox";

/**
 * What the section says to someone who is not signed in: the two ways to use
 * it, side by side. Signing in is offered, never required.
 */
export function Landing() {
	const relay = useRelay();
	const busy = useWalletBusy((b) => b.busy);
	const waiting = relay.mode === "restoring";
	return (
		<ShellPage
			title="Multisig"
			meta={
				<>
					<span>{RELAY_COPY.landingMeta}</span>
					<SignsTag />
				</>
			}
		>
			<div className="grid grid-cols-1 items-start gap-4 min-[861px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
				<Card title={RELAY_COPY.teamTitle}>
					<div className="flex flex-col gap-4">
						<span className="text-sm text-muted-foreground">
							{RELAY_COPY.teamBody}
						</span>
						<div className="flex flex-wrap items-center gap-2">
							<Btn
								variant="brand"
								disabled={busy || waiting}
								onClick={relay.signIn}
							>
								{relay.signingIn
									? "Waiting for your wallet…"
									: waiting
										? "Checking your session…"
										: RELAY_COPY.signInButton}
							</Btn>
						</div>
						{relay.issue && (
							<p
								role="alert"
								className={
									relay.issue.severity === "error"
										? "text-sm text-danger"
										: "text-sm text-warning"
								}
							>
								{relay.issue.message}
								{relay.issue.fix ? ` ${relay.issue.fix}` : ""}
							</p>
						)}
						<span className="text-xs text-subtle-foreground">
							{RELAY_COPY.teamSmall} <SmallPrint className="text-xs" />
						</span>
					</div>
				</Card>
				<Card title={RELAY_COPY.soloTitle}>
					<div className="flex flex-col gap-4">
						<span className="text-sm text-muted-foreground">
							{RELAY_COPY.soloBody}
						</span>
						<div className="flex flex-wrap items-center gap-2">
							<Link to="/multisig/open" className={linkButton}>
								Open or start a proposal
							</Link>
						</div>
					</div>
				</Card>
			</div>
		</ShellPage>
	);
}
