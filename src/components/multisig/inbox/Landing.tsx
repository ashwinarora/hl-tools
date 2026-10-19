import { Link } from "@tanstack/react-router";
import { useNetwork } from "#/store/networkStore";
import { useWalletBusy } from "#/store/walletBusyStore";
import { CREATE } from "../model/create";
import { FIRST_RUN, START } from "../model/guide";
import { RELAY_COPY } from "../model/relay/copy";
import { useRelay } from "../relay/useRelay";
import { Help } from "../shell/Help";
import { Btn, Card, linkButton, SignsTag } from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";
import { Slow } from "../shell/Slow";
import { SmallPrint } from "../shell/WalletBox";
import { FirstRun } from "./FirstRun";

/**
 * What the section says to someone who is not signed in: how it works (until
 * hidden), the two ways to use it side by side, and the two ways in that need
 * no wallet at all. Signing in is offered, never required.
 */
export function Landing() {
	const relay = useRelay();
	const network = useNetwork();
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
			<div className="mb-4">
				<FirstRun sharing />
			</div>
			{/* the four ways in, two by two, each row's cards of one height */}
			<div className="grid grid-cols-1 gap-4 min-[861px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:grid-cols-2 xl:gap-5">
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
						{waiting && !relay.signingIn && <Slow>{null}</Slow>}
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
							{RELAY_COPY.teamSmall} <Help k="signIn" />{" "}
							<SmallPrint className="text-xs" />
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
				<Card title={CREATE.title}>
					<div className="flex flex-col gap-4">
						<span className="text-sm text-muted-foreground">
							{START.createBody}
						</span>
						<div className="flex flex-wrap items-center gap-2">
							<Link
								to="/multisig/create"
								search={{ network }}
								className={linkButton}
							>
								{CREATE.title}
							</Link>
						</div>
					</div>
				</Card>
				<Card title={START.lookTitle}>
					<div className="flex flex-col gap-4">
						<span className="text-sm text-muted-foreground">
							{START.lookBody}
						</span>
						<div className="flex flex-wrap items-center gap-2">
							<Link
								to="/tools/multisig"
								search={{ view: "account" }}
								className={linkButton}
							>
								{START.lookButton}
							</Link>
						</div>
					</div>
				</Card>
			</div>
			<p className="mt-4 text-[13px] text-muted-foreground">
				<Link
					to="/multisig/glossary"
					className="underline underline-offset-2 hover:text-foreground"
				>
					{FIRST_RUN.glossary}
				</Link>
			</p>
		</ShellPage>
	);
}
