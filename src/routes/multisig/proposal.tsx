import type { Issue } from "@hl-tools/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileQuestion, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "#/components/hub/layout";
import { Callout, IssueList } from "#/components/hub/status";
import { RELAY_COPY } from "#/components/multisig/model/relay/copy";
import {
	documentFromFragment,
	openText,
} from "#/components/multisig/model/transport";
import { ProposalView } from "#/components/multisig/proposal/ProposalView";
import { useProposalDoc } from "#/components/multisig/proposal/useProposalDoc";
import { useRelay } from "#/components/multisig/relay/useRelay";
import { Btn, SignsTag } from "#/components/multisig/shell/kit";
import { ShellPage } from "#/components/multisig/shell/ShellPage";
import { clearShared } from "#/lib/share";
import { useWalletBusy } from "#/store/walletBusyStore";

export const Route = createFileRoute("/multisig/proposal")({
	// the digest is a public identifier; the document itself never enters the query string
	validateSearch: (s: Record<string, unknown>): { digest?: string } => ({
		digest: typeof s.digest === "string" ? s.digest : undefined,
	}),
	component: ProposalScreen,
});

const backLink =
	"inline-flex h-8 items-center rounded-md border border-border-strong bg-surface px-3 text-sm hover:bg-surface-2";

function ProposalScreen() {
	const { digest } = Route.useSearch();
	const navigate = useNavigate();
	const doc = useProposalDoc(digest);
	const { store } = doc;
	/** A link was opened: its fragment is being decoded, or could not be. */
	const [link, setLink] = useState<
		| { state: "checking" }
		| { state: "none" }
		| { state: "failed"; issues: readonly Issue[] }
	>({ state: "checking" });

	// A link's fragment carries the whole document. Read it once, merge it into the history,
	// strip it from the address bar and continue under the digest.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the fragment is read once, on arrival
	useEffect(() => {
		const text = documentFromFragment(window.location.hash);
		if (text === null) {
			setLink({ state: "none" });
			return;
		}
		clearShared();
		const decoded = openText(text);
		if (!decoded.proposal) {
			setLink({ state: "failed", issues: decoded.issues });
			return;
		}
		let cancelled = false;
		void store(decoded.proposal).then((saved) => {
			if (cancelled) return;
			setLink({ state: "none" });
			void navigate({
				to: "/multisig/proposal",
				search: { digest: saved.proposal.digest },
				replace: true,
			});
		});
		return () => {
			cancelled = true;
		};
	}, []);

	if (doc.proposal && link.state !== "failed")
		return (
			<ProposalView proposal={doc.proposal} issues={doc.issues} doc={doc} />
		);

	return (
		<ShellPage title="Proposal" meta={<SignsTag />}>
			{link.state === "failed" ? (
				<Callout
					tone="danger"
					title="This link does not carry a proposal this page can open"
					action={
						<Link to="/multisig/open" className={backLink}>
							Back to the start
						</Link>
					}
				>
					<IssueList issues={link.issues} />
				</Callout>
			) : link.state === "checking" || doc.loading ? (
				<div
					className="flex items-center gap-2 text-sm text-muted-foreground"
					aria-busy="true"
				>
					<Loader2 className="size-4 animate-spin" aria-hidden /> Opening the
					proposal…
				</div>
			) : (
				<Missing
					digest={digest}
					issues={doc.issues}
					relayIssue={doc.relay.issue}
				/>
			)}
		</ShellPage>
	);
}

/**
 * Nothing to show for this digest. Who to ask depends on where the reader
 * stands: with no relay, the link or the file; signed out, signing in is the
 * other way; signed in, the relay has no such proposal for this wallet (which
 * is also what it says when the wallet may not see it).
 */
function Missing({
	digest,
	issues,
	relayIssue,
}: {
	digest: string | undefined;
	issues: readonly Issue[];
	relayIssue: Issue | null;
}) {
	const relay = useRelay();
	const busy = useWalletBusy((b) => b.busy);
	const open = (
		<Link to="/multisig/open" className={backLink}>
			Open a proposal
		</Link>
	);
	if (!digest) {
		return (
			<EmptyState
				icon={FileQuestion}
				title="No proposal selected"
				description="Open a proposal from a link, a file or your history."
				action={open}
			/>
		);
	}
	if (relay.mode === "on") {
		// the relay has a row for this digest, but this browser will not take it
		const refused = issues.some(
			(i) => i.code === "relay.row_invalid" || i.code === "relay.row_mismatch",
		);
		return (
			<div className="space-y-4">
				{refused ? (
					<EmptyState
						icon={FileQuestion}
						title="The relay's copy of this proposal does not verify"
						description="This browser checks every document against its digest before showing it, and this one does not match, so it was ignored. Ask whoever proposed it for the link or the file, and paste it on the start page."
						sample={digest}
						action={open}
					/>
				) : (
					<EmptyState
						icon={FileQuestion}
						title="No proposal with that digest, here or on the relay"
						description="This browser has not seen it, and the relay has none your wallet can open: it was never shared, or your wallet is not a signer of its treasury in the relay's copy of the signer list. If you were sent the document, paste it on the start page."
						sample={digest}
						action={open}
					/>
				)}
				{relayIssue && (
					<Callout
						tone={relayIssue.severity === "error" ? "danger" : "warning"}
						title={relayIssue.message}
					>
						{relayIssue.fix}
					</Callout>
				)}
				{issues.length > 0 && <IssueList issues={issues} />}
			</div>
		);
	}
	if (relay.mode === "off") {
		return (
			<EmptyState
				icon={FileQuestion}
				title="This browser has no proposal with that digest"
				description="Proposals live in the link or file you were sent, and in the history of the browser that opened them. Open the link again, or paste the document on the start page."
				sample={digest}
				action={open}
			/>
		);
	}
	return (
		<EmptyState
			icon={FileQuestion}
			title="This browser has no proposal with that digest"
			description={
				relay.mode === "restoring"
					? "Checking your session…"
					: relay.mode === "unreachable"
						? RELAY_COPY.unreachable
						: relay.mode === "suspended"
							? `${RELAY_COPY.suspended} Sign in with the connected wallet to open it, or paste the document.`
							: "Sign in to open it, or paste the document you were sent."
			}
			sample={digest}
			action={
				<div className="flex flex-wrap items-center justify-center gap-2">
					{relay.mode === "unreachable" ? (
						<Btn variant="outline" onClick={relay.retry}>
							Try again
						</Btn>
					) : relay.mode !== "restoring" ? (
						<Btn variant="brand" disabled={busy} onClick={relay.signIn}>
							{relay.signingIn
								? "Waiting for your wallet…"
								: RELAY_COPY.signInButton}
						</Btn>
					) : null}
					{open}
				</div>
			}
		/>
	);
}
