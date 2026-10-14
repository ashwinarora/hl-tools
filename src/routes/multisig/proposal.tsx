import {
	type Issue,
	judgeMove,
	otherStep,
	type Proposal,
	stepNumber,
} from "@hl-tools/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileQuestion, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "#/components/hub/layout";
import { Callout, IssueList } from "#/components/hub/status";
import { saveProposal } from "#/components/multisig/model/history";
import { gateOthers, RELAY_COPY } from "#/components/multisig/model/relay/copy";
import {
	documentsFromFragment,
	openText,
} from "#/components/multisig/model/transport";
import { MoveView } from "#/components/multisig/proposal/MoveView";
import { ProposalView } from "#/components/multisig/proposal/ProposalView";
import { useProposalDoc } from "#/components/multisig/proposal/useProposalDoc";
import { useRelay } from "#/components/multisig/relay/useRelay";
import { Btn, SignsTag } from "#/components/multisig/shell/kit";
import { ShellPage } from "#/components/multisig/shell/ShellPage";
import { Slow } from "#/components/multisig/shell/Slow";
import { useShellWallet } from "#/components/multisig/shell/WalletBox";
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
	/** The further steps a link carried, kept for where this browser cannot store them. */
	const [arrived, setArrived] = useState<readonly Proposal[]>([]);

	// the latest `store`: a link opened later is shared as the wallet signed in then
	const storeNow = useRef(store);
	storeNow.current = store;

	// A link's fragment carries the whole document. Read it on arrival, and again
	// when another link is opened in this tab (only the fragment changes, so the
	// page stays): merge it into the history, strip it from the address bar and
	// continue under the digest as soon as it is saved; the relay hears of it after.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `navigate` is stable and `store` is read through its ref
	useEffect(() => {
		let run = 0;
		let gone = false;
		const open = (arriving: boolean) => {
			const texts = documentsFromFragment(window.location.hash);
			if (texts === null) {
				// another fragment (a "skip to content" link) is not a proposal
				if (arriving) setLink({ state: "none" });
				return;
			}
			const mine = ++run;
			clearShared();
			// one proposal, or the two steps of a move: every one has to open
			const decoded = texts.map((text) => openText(text));
			const [first, ...rest] = decoded.flatMap((d) =>
				d.proposal ? [d.proposal] : [],
			);
			if (!first || rest.length + 1 !== decoded.length) {
				setLink({
					state: "failed",
					issues: decoded.flatMap((d) => (d.proposal ? [] : d.issues)),
				});
				return;
			}
			setLink({ state: "checking" });
			setArrived(rest);
			void (async () => {
				// the other step first, so the page finds the move whole when it opens;
				// where nothing can be stored, `arrived` is the copy the page shows
				for (const other of rest) await saveProposal(other).catch(() => null);
				const saved = await storeNow.current(first, { pushLater: true });
				if (gone || mine !== run) return;
				setLink({ state: "none" });
				void navigate({
					to: "/multisig/proposal",
					search: { digest: saved.proposal.digest },
					replace: true,
				});
			})();
		};
		open(true);
		const again = () => open(false);
		window.addEventListener("hashchange", again);
		return () => {
			gone = true;
			window.removeEventListener("hashchange", again);
		};
	}, []);

	// A proposal that says it is one step of a move: the other step is opened
	// too, and the two are shown as one page when they bear the claim out.
	const otherDigest = doc.proposal ? otherStep(doc.proposal) : null;
	const other = useProposalDoc(
		otherDigest ?? undefined,
		arrived.find((p) => p.digest === otherDigest) ?? null,
	);
	if (doc.proposal && link.state !== "failed") {
		if (otherDigest && other.loading && !other.proposal)
			return (
				<ShellPage title="Proposal" meta={<SignsTag />}>
					<Slow>
						<div
							className="flex items-center gap-2 text-sm text-muted-foreground"
							aria-busy="true"
						>
							<Loader2 className="size-4 animate-spin" aria-hidden /> Opening
							both steps…
						</div>
					</Slow>
				</ShellPage>
			);
		// who proposed each is the relay's word where it has both, never the documents'
		const rows = [doc.relay.row, other.relay.row] as const;
		const judged = other.proposal
			? judgeMove(
					doc.proposal,
					other.proposal,
					rows[0] && rows[1]
						? { a: rows[0].createdBy, b: rows[1].createdBy }
						: undefined,
				)
			: null;
		if (judged?.move) {
			const firstIsThis = judged.move.steps[0].digest === doc.proposal.digest;
			return (
				<MoveView
					move={judged.move}
					docs={firstIsThis ? [doc, other] : [other, doc]}
					issues={
						firstIsThis
							? [doc.issues, other.issues]
							: [other.issues, doc.issues]
					}
				/>
			);
		}
		return (
			<ProposalView
				proposal={doc.proposal}
				issues={doc.issues}
				doc={doc}
				aside={
					otherDigest
						? {
								title: `This says it is step ${stepNumber(doc.proposal)} of a move of two steps`,
								body: other.proposal
									? "The other step is here too, but the two do not bear that out (they differ in treasury, finaliser or proposer, or are not the two steps of one staking move), so each is shown by itself."
									: "The other step is not in this browser, so this one is shown by itself. Open the other step's link or file to see the move as one.",
							}
						: undefined
				}
			/>
		);
	}

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
					<IssueList plain issues={link.issues} />
				</Callout>
			) : link.state === "checking" || doc.loading ? (
				<Slow
					wayOut={
						<>
							<Btn
								size="sm"
								variant="outline"
								onClick={() => window.location.reload()}
							>
								Reload the page
							</Btn>
							<Link to="/multisig/open" className={backLink}>
								Open from a link or file
							</Link>
						</>
					}
				>
					<div
						className="flex items-center gap-2 text-sm text-muted-foreground"
						aria-busy="true"
					>
						<Loader2 className="size-4 animate-spin" aria-hidden /> Opening the
						proposal…
					</div>
				</Slow>
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
	const { connected } = useShellWallet();
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
				{issues.length > 0 && <IssueList plain issues={issues} />}
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
						: relay.others.length > 0
							? `${gateOthers(relay.others.length, connected)} Or paste the document you were sent.`
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
					) : (
						<Slow>{null}</Slow>
					)}
					{open}
				</div>
			}
		/>
	);
}
