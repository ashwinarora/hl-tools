import {
	type ActionPartyRole,
	type Address,
	describeAction,
	type Issue,
	orderMark,
	overtakenBy,
	type Proposal,
} from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useCallback, useMemo } from "react";
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
import { useChainMatch } from "../live/useChainMatch";
import { CONTROL_REFRESH_MS } from "../live/useControl";
import { explorerTxUrl } from "../model/chain/columns";
import { RELAY_COPY } from "../model/relay/copy";
import {
	deriveStage,
	type Phase,
	shortAddress,
	type WalletRole,
} from "../model/stage";
import { TreasuryNames, Who } from "../names/Names";
import { useTreasuries } from "../relay/queries";
import { useExecutionReporter } from "../relay/useExecutionReporter";
import { useRelay } from "../relay/useRelay";
import { Help } from "../shell/Help";
import {
	backLink,
	Card,
	linkButtonSm,
	NetTag,
	SignsTag,
	Tag,
} from "../shell/kit";
import { useNow } from "../shell/live";
import { ShellPage } from "../shell/ShellPage";
import { TreasuryStrip } from "../TreasuryStrip";
import { useKnownProposals } from "../treasury/useKnownProposals";
import { useTreasuryNames } from "../treasuryName";
import { useLiveTreasuryState } from "../useTreasuryState";
import { useWalletSigner } from "../useWalletSigner";
import { SharePanel } from "./SharePanel";
import { SignaturesPanel } from "./SignaturesPanel";
import { StageCallout } from "./StageCallout";
import { TellCoSigners } from "./TellCoSigners";
import type { ProposalDoc } from "./useProposalDoc";
import { useViewRecorder } from "./useViewRecorder";
import { YourPart } from "./YourPart";

/** Phases in which signing or finalising can still happen; elsewhere the stage line says it all. */
const ACTIONABLE: ReadonlySet<Phase> = new Set([
	"judging",
	"unknown",
	"collecting",
	"ready",
	"not-yet-valid",
	// nothing to sign, but its proposer can still withdraw it and a signer take a signature back
	"stuck",
	"overtaken",
]);
/** Phases after which nobody signs any more. */
const CLOSED: ReadonlySet<Phase> = new Set([
	"submitted",
	"carried-out",
	"closed",
	"withdrawn",
	"declined",
	"expired",
]);
/** Phases that end with "make a new one": the old action, a fresh nonce. */
const REPROPOSABLE: ReadonlySet<Phase> = new Set([
	"stuck",
	"overtaken",
	"expired",
	"withdrawn",
	"declined",
]);

/** What an address named in the action is to it, as a label. */
const PARTY: Record<ActionPartyRole, string> = {
	destination: "Destination",
	agent: "API wallet",
	signer: "Signer",
	vault: "Vault",
	subAccount: "Sub-account",
	builder: "Builder",
	validator: "Validator",
	user: "Account",
};
const NO_SIGNERS: readonly Address[] = [];

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
	const relay = useRelay();
	const wallet = useWalletSigner();
	const me = wallet.address as Address | null;
	const parsed = useMemo(
		() => documentToParsed(proposal, issues),
		[proposal, issues],
	);
	const state = useJudgement(parsed, { refetchInterval: CONTROL_REFRESH_MS });
	const relayNotes = useMemo(
		() => issues.filter((i) => i.code.startsWith("relay.")),
		[issues],
	);
	const target = useMemo<AccountTarget>(
		() => ({
			address: proposal.payload.multiSigUser,
			network: proposal.payload.network,
		}),
		[proposal.payload.multiSigUser, proposal.payload.network],
	);
	const row = doc.relay.row;
	// While the relay holds it as not carried out, this page follows the
	// treasury's ledger: if the finaliser sent it some other way, the transfer
	// shows up there, and the relay is pointed at its transaction.
	const unsettled =
		row?.status === "open" ||
		row?.status === "withdrawn" ||
		row?.status === "declined";
	const treasury = useLiveTreasuryState(target, { history: unsettled });
	const candidates = useMemo(
		() => [
			{
				digest: proposal.digest,
				action: proposal.payload.action,
				nonce: proposal.payload.nonce,
				finaliser: proposal.payload.outerSigner,
			},
		],
		[proposal],
	);
	const match = useChainMatch(
		target,
		unsettled ? treasury.live.ledger : null,
		candidates,
		unsettled,
	);
	const status = row?.status ?? null;
	const statusOf = useCallback(() => status, [status]);
	// A USDC send is shut out once a newer send of the treasury is carried out:
	// the other proposals on record say whether that has happened.
	const ordered = useMemo(
		() => orderMark(proposal.payload.action) !== null,
		[proposal.payload.action],
	);
	const settled =
		status === "accepted" || status === "carried_out" || status === "unknown";
	const known = useKnownProposals(
		target.network,
		target.address as Address,
		ordered && !settled,
	);
	const overtaken = useMemo(
		() =>
			ordered &&
			!settled &&
			overtakenBy(
				proposal.payload.action,
				known.proposals.filter(
					(p) => p.accepted && p.digest !== proposal.digest,
				),
			) !== null,
		[ordered, settled, proposal, known.proposals],
	);
	const clock = useNow();
	// While the signer set is still on its way, the page is "checking", not
	// "signer set not loaded": that is for a read that failed. The same holds for
	// the moment after it arrives, while signatures are re-counted against it.
	// (A later refresh of the signer set keeps the previous count on screen
	// until the new one is ready, so nothing flickers every minute.)
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
		carriedOut:
			row?.status === "carried_out"
				? { txHash: doc.relay.carriedOut?.txHash ?? null }
				: null,
		closedUnknown: row?.status === "unknown",
		overtaken,
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
	useExecutionReporter({
		network: target.network,
		treasury: target.address as Address,
		ledger: unsettled ? treasury.live.ledger : null,
		match,
		statusOf,
		signer: !!listed && !!relay.wallet && listed.signers.includes(relay.wallet),
		now: clock,
	});
	const mySignerHere =
		!!listed && !!relay.wallet && listed.signers.includes(relay.wallet);
	useViewRecorder({
		network: target.network,
		treasury: target.address as Address,
		digest: proposal.digest,
		known: doc.relay.known,
		open: row?.status === "open" && !doc.relay.expired,
		signer: mySignerHere,
		views: doc.relay.views,
		proposer: row?.createdBy ?? null,
	});
	const seen = useMemo(
		() =>
			row && doc.relay.views
				? {
						views: doc.relay.views,
						proposer: row.createdBy,
						createdAt: row.createdAt,
					}
				: null,
		[row, doc.relay.views],
	);
	const carriedTx = doc.relay.carriedOut?.txHash ?? null;
	const treasuryName = listed
		? nameOf(target.network, target.address as Address)
		: shortAddress(target.address);
	const proposer = row?.createdBy ?? proposal.meta.createdBy;
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

	// who signs, as far as this page trusts: the chain's list once it is read
	const signersNow =
		state.policy && state.policy.authorizedUsers.length > 0
			? state.policy.authorizedUsers
			: (listed?.signers ?? NO_SIGNERS);
	return (
		<TreasuryNames
			network={target.network}
			treasury={target.address as Address}
			signers={signersNow}
		>
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
						{proposer && (
							<span>
								proposed by{" "}
								{proposer === me ? "you" : <Who address={proposer} />}
							</span>
						)}
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
								listed ? (
									<Link
										to="/multisig/t/$network/$address"
										params={{
											network: target.network,
											address: target.address,
										}}
										search={{ tab: "chain" }}
										className={linkButtonSm}
									>
										See it on Hyperliquid's record
									</Link>
								) : (
									<Link
										to="/tools/multisig"
										search={{ view: "account", address: target.address }}
										className={linkButtonSm}
									>
										Check the ledger in the inspector
									</Link>
								)
							) : stage.phase === "carried-out" ? (
								<span className="flex flex-wrap items-center gap-2">
									{listed && (
										<Link
											to="/multisig/t/$network/$address"
											params={{
												network: target.network,
												address: target.address,
											}}
											search={{ tab: "chain" }}
											className={linkButtonSm}
										>
											See it on Hyperliquid's record
										</Link>
									)}
									{carriedTx && (
										<a
											href={explorerTxUrl(target.network, carriedTx)}
											target="_blank"
											rel="noopener noreferrer"
											className={linkButtonSm}
										>
											Transaction
											<ExternalLink className="size-3" aria-hidden />
										</a>
									)}
								</span>
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
							action={
								// "already used" often means it went through somewhere else: the ledger says
								stage.failedAttempt.id === "nonce-duplicate" ? (
									<Link
										to="/tools/multisig"
										search={{ view: "account", address: target.address }}
										className={linkButtonSm}
									>
										Check the ledger in the inspector
									</Link>
								) : undefined
							}
						>
							{stage.failedAttempt.cause} {stage.failedAttempt.fix}
						</Callout>
					)}
					{stage.policyChanged && (
						<Callout
							tone="warning"
							title="The signer set changed since this was proposed"
						>
							Signatures are counted against the signer set the chain reports
							now, not the one recorded in the document.
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
					{relayNotes.map((n) => (
						// what this browser refused to take from the relay's copy
						<Callout key={n.code + n.message} tone="warning" title={n.message}>
							{n.fix}
						</Callout>
					))}

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
									{description.parties.map((party) => (
										// Before anything is signed: the whole address, and where its
										// nickname comes from. A nickname is a label somebody typed.
										<div
											key={`${party.role}:${party.address}`}
											className="contents"
										>
											<dt className="pt-0.5 text-xs text-muted-foreground">
												{PARTY[party.role]}
											</dt>
											<dd className="text-[13px]">
												<Who address={party.address} full editable />
												{party.address === me && " (you)"}
											</dd>
										</div>
									))}
									<dt className="pt-0.5 text-xs text-muted-foreground">
										Treasury
									</dt>
									<dd className="font-mono text-[13px] [overflow-wrap:anywhere]">
										{target.address}
									</dd>
									<dt className="flex items-center gap-1 pt-0.5 text-xs text-muted-foreground">
										Finaliser <Help k="finaliser" />
									</dt>
									<dd className="text-[13px]">
										<Who address={proposal.payload.outerSigner} full />
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
										The title and note are not signed: whoever shared the
										proposal wrote them. The action above is what signers sign.
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
								seen={seen}
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
										proposal.receipt?.signatureChainId ??
										stage.requiredChain?.hex
									}
								/>
							</div>
						</div>
					</details>
				</div>
			</ShellPage>
		</TreasuryNames>
	);
}
