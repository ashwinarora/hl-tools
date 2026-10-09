import {
	type Address,
	describeAction,
	type Issue,
	type Proposal,
} from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Callout } from "#/components/hub/status";
import {
	FLAG_TEXT,
	ProposalResult,
} from "#/components/tools/multisig/EnvelopeView";
import {
	type AccountTarget,
	documentToParsed,
} from "#/components/tools/multisig/model";
import { useJudgement } from "#/components/tools/multisig/useJudgement";
import { useNetwork } from "#/store/networkStore";
import { RELAY_COPY } from "../model/relay/copy";
import {
	deriveStage,
	type Phase,
	shortAddress,
	type WalletRole,
} from "../model/stage";
import { useTreasuries } from "../relay/queries";
import {
	backLink,
	Card,
	linkButtonSm,
	NetTag,
	SignsTag,
	Tag,
} from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";
import { TreasuryStrip } from "../TreasuryStrip";
import { useTreasuryNames } from "../treasuryName";
import { REFRESH_MS, useTreasuryState } from "../useTreasuryState";
import { useWalletSigner } from "../useWalletSigner";
import { SharePanel } from "./SharePanel";
import { SignaturesPanel } from "./SignaturesPanel";
import { StageCallout } from "./StageCallout";
import { TellCoSigners } from "./TellCoSigners";
import type { ProposalDoc } from "./useProposalDoc";
import { YourPart } from "./YourPart";

/** Phases in which signing or finalising can still happen; elsewhere the stage line says it all. */
const ACTIONABLE: ReadonlySet<Phase> = new Set([
	"judging",
	"unknown",
	"collecting",
	"ready",
	"not-yet-valid",
]);
/** Phases after which nobody signs any more. */
const CLOSED: ReadonlySet<Phase> = new Set([
	"submitted",
	"withdrawn",
	"declined",
	"expired",
]);
/** Phases that end with "make a new one": the old action, a fresh nonce. */
const REPROPOSABLE: ReadonlySet<Phase> = new Set([
	"expired",
	"withdrawn",
	"declined",
]);

const ROLE: Record<WalletRole, string | null> = {
	disconnected: null,
	outsider: "not a signer",
	signer: "signer",
	finaliser: "finaliser",
	"signer-finaliser": "signer · finaliser",
};

/**
 * One proposal, for the wallet looking at it: where it stands, what it does,
 * what this wallet can do about it, and who has signed. Everything is judged
 * here, in the browser: the document is re-hashed, each signature recovered,
 * and readiness counted against the signer set the chain reports now. The
 * relay only says who shared what and how it ended.
 */
export function ProposalView({
	proposal,
	issues,
	doc,
}: {
	proposal: Proposal;
	issues: readonly Issue[];
	doc: ProposalDoc;
}) {
	const header = useNetwork();
	const wallet = useWalletSigner();
	const me = wallet.address as Address | null;
	const parsed = useMemo(
		() => documentToParsed(proposal, issues),
		[proposal, issues],
	);
	const state = useJudgement(parsed, { refetchInterval: REFRESH_MS });
	const target = useMemo<AccountTarget>(
		() => ({
			address: proposal.payload.multiSigUser,
			network: proposal.payload.network,
		}),
		[proposal.payload.multiSigUser, proposal.payload.network],
	);
	const treasury = useTreasuryState(target, { live: true });
	const row = doc.relay.row;
	// While the signer set is still on its way, the page is "checking", not
	// "signer set not loaded": that is for a read that failed. The same holds for
	// the moment after it arrives, while signatures are re-counted against it.
	// (A later refresh of the signer set keeps the previous count on screen
	// until the new one is ready, so nothing flickers every 30 seconds.)
	const waitingForPolicy =
		state.policyQuery.isPending ||
		(state.judgement?.policy === null && state.policy !== null);
	const judged = waitingForPolicy ? null : (state.judgement?.ready ?? null);
	const stage = deriveStage({
		proposal,
		readiness: judged,
		policy: state.policy,
		wallet: me,
		walletChainId: wallet.chainId,
		ended: row?.ending
			? { kind: row.ending.kind, by: row.ending.endedBy }
			: null,
		headerNetwork: header,
	});
	const role = ROLE[stage.role];
	const description = useMemo(
		() => describeAction(proposal.payload.action),
		[proposal.payload.action],
	);

	// the treasury page, when the relay lists this treasury for the wallet
	const { rows: mine } = useTreasuries();
	const nameOf = useTreasuryNames();
	const listed = mine.find(
		(t) => t.network === target.network && t.address === target.address,
	);
	const treasuryName = listed
		? nameOf(target.network, target.address as Address)
		: shortAddress(target.address);
	const proposer = row?.createdBy ?? proposal.meta.createdBy;
	const who = (a: string) => (a === me ? "you" : shortAddress(a));
	const ready = judged;
	const repropose = (
		<Link
			to="/multisig/propose"
			search={{ treasury: target.address, supersedes: proposal.digest }}
			className={linkButtonSm}
		>
			Re-propose
		</Link>
	);

	return (
		<ShellPage
			title={proposal.meta.title ?? description.headline}
			back={
				listed ? (
					<Link
						to="/multisig/t/$network/$address"
						params={{ network: target.network, address: target.address }}
						className={backLink}
					>
						◂ {treasuryName}
					</Link>
				) : (
					<Link to="/multisig/open" className={backLink}>
						◂ Open or start
					</Link>
				)
			}
			meta={
				<>
					<span
						className={listed ? undefined : "font-mono"}
						title={target.address}
					>
						{treasuryName}
					</span>
					<NetTag network={target.network} />
					{proposer && <span>proposed by {who(proposer)}</span>}
					{role && (
						<Tag tone={stage.role === "outsider" ? "gray" : "you"}>
							you: {role}
						</Tag>
					)}
					<SignsTag />
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<StageCallout
					stage={stage}
					action={
						stage.phase === "submitted" ? (
							<Link
								to="/tools/multisig"
								search={{ view: "account", address: target.address }}
								className={linkButtonSm}
							>
								Check the ledger in the inspector
							</Link>
						) : REPROPOSABLE.has(stage.phase) ? (
							repropose
						) : undefined
					}
				/>
				{stage.phase === "submitted" &&
					doc.relay.known &&
					!stage.role.includes("finaliser") && (
						<p className="-mt-2 px-0.5 text-xs text-subtle-foreground">
							{RELAY_COPY.reportedReceipt}
						</p>
					)}
				{stage.failedAttempt && (
					<Callout
						tone="danger"
						title={`The last submission was rejected: ${stage.failedAttempt.message}`}
					>
						{stage.failedAttempt.cause} {stage.failedAttempt.fix}
					</Callout>
				)}
				{stage.policyChanged && (
					<Callout
						tone="warning"
						title="The signer set changed since this was proposed"
					>
						Signatures are counted against the signer set the chain reports now,
						not the one recorded in the document.
					</Callout>
				)}
				{doc.storageError && (
					<Callout tone="warning" title="Not saved in this browser">
						{doc.storageError} The proposal stays on this page until you close
						it; download the file to keep it.
					</Callout>
				)}
				{doc.relay.issue && (
					<Callout
						tone={doc.relay.issue.severity === "error" ? "danger" : "warning"}
						title={doc.relay.issue.message}
					>
						{doc.relay.issue.fix}
					</Callout>
				)}

				<div className="grid grid-cols-1 items-start gap-4 min-[861px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
					<div className="flex min-w-0 flex-col gap-4">
						<Card title="Action">
							<p className="text-balance text-[17px] font-medium [overflow-wrap:anywhere]">
								{description.headline}
							</p>
							{(description.flags.length > 0 || !description.known) && (
								<div className="mt-2 flex flex-wrap gap-1.5">
									{description.flags.map((f) => (
										<Tag
											key={f}
											tone={
												FLAG_TEXT[f]?.tone === "danger"
													? "danger"
													: FLAG_TEXT[f]?.tone === "info"
														? "info"
														: "warn"
											}
										>
											{FLAG_TEXT[f]?.label ?? f}
										</Tag>
									))}
									{!description.known && <Tag>unknown action type</Tag>}
								</div>
							)}
							<dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
								{description.lines.map((line) => {
									const cut = line.indexOf(": ");
									return cut > 0 ? (
										<div key={line} className="contents">
											<dt className="pt-0.5 text-xs text-muted-foreground">
												{line.slice(0, cut)}
											</dt>
											<dd className="[overflow-wrap:anywhere]">
												{line.slice(cut + 2)}
											</dd>
										</div>
									) : (
										<dd
											key={line}
											className="col-span-2 [overflow-wrap:anywhere]"
										>
											{line}
										</dd>
									);
								})}
								<dt className="pt-0.5 text-xs text-muted-foreground">
									Treasury
								</dt>
								<dd className="font-mono text-[13px] [overflow-wrap:anywhere]">
									{target.address}
								</dd>
								<dt className="pt-0.5 text-xs text-muted-foreground">
									Finaliser
								</dt>
								<dd className="font-mono text-[13px] [overflow-wrap:anywhere]">
									{proposal.payload.outerSigner}
									{proposal.payload.outerSigner === me ? " (you)" : ""}
								</dd>
								{proposal.meta.note && (
									<>
										<dt className="pt-0.5 text-xs text-muted-foreground">
											Note
										</dt>
										<dd className="[overflow-wrap:anywhere]">
											{proposal.meta.note}
										</dd>
									</>
								)}
							</dl>
							{(proposal.meta.title || proposal.meta.note) && (
								<p className="mt-3 text-xs text-subtle-foreground">
									The title and note are not signed: whoever shared the proposal
									wrote them. The action above is what signers sign.
								</p>
							)}
						</Card>
						{ACTIONABLE.has(stage.phase) && (
							<YourPart
								proposal={proposal}
								stage={stage}
								wallet={wallet}
								doc={doc}
								have={ready?.have ?? 0}
								need={ready?.need ?? null}
							/>
						)}
					</div>
					<div className="flex min-w-0 flex-col gap-4">
						<SignaturesPanel
							proposal={proposal}
							policy={state.policy}
							counted={ready ? ready.counted : null}
							me={me}
							closed={CLOSED.has(stage.phase)}
						/>
						<TellCoSigners proposal={proposal} doc={doc} />
						<SharePanel
							proposal={proposal}
							store={doc.store}
							secondary={doc.relay.known}
						/>
					</div>
				</div>

				<details className="group min-w-0">
					<summary className="cursor-pointer list-none text-[13px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<span className="group-open:hidden">
							▸ Details: treasury, digests, each signature, the envelope
						</span>
						<span className="hidden group-open:inline">▾ Details</span>
					</summary>
					<div className="mt-4 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
						<TreasuryStrip state={treasury} wallet={me} />
						<div className="min-w-0 space-y-5">
							<ProposalResult
								parsed={parsed}
								toggle={header}
								state={state}
								// the finaliser signs the envelope under the same chain as the inner action
								envelopeChainId={
									proposal.receipt?.signatureChainId ?? stage.requiredChain?.hex
								}
							/>
						</div>
					</div>
				</details>
			</div>
		</ShellPage>
	);
}
