import type { Issue } from "@hl-tools/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileQuestion, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "#/components/hub/layout";
import { Callout, IssueList } from "#/components/hub/status";
import {
	documentFromFragment,
	openText,
} from "#/components/multisig/model/transport";
import { ProposalView } from "#/components/multisig/proposal/ProposalView";
import { useProposalDoc } from "#/components/multisig/proposal/useProposalDoc";
import { SignerPage } from "#/components/multisig/SignerPage";
import { clearShared } from "#/lib/share";

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
		<SignerPage>
			{link.state === "failed" ? (
				<Callout
					tone="danger"
					title="This link does not carry a proposal this page can open"
					action={
						<Link to="/multisig" className={backLink}>
							Back to the signer
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
				<EmptyState
					icon={FileQuestion}
					title={
						digest
							? "This browser has no proposal with that digest"
							: "No proposal selected"
					}
					description={
						digest
							? "Proposals live in the link or file you were sent, and in the history of the browser that opened them. Open the link again, or paste the document on the start page."
							: "Open a proposal from a link, a file or your history."
					}
					sample={digest}
					action={
						<Link to="/multisig" className={backLink}>
							Open a proposal
						</Link>
					}
				/>
			)}
		</SignerPage>
	);
}
