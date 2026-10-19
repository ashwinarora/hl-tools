import {
	type Address,
	cutTo,
	describeAction,
	type Hex,
	type Issue,
	orderMark,
	overtakenBy,
	type Proposal,
	parseSignersString,
	type SignerSet,
	sendShape,
	vaultActionOf,
} from "@hl-tools/core";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
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
import { useChainMatch, useTxLookups } from "../live/useChainMatch";
import { CONTROL_REFRESH_MS } from "../live/useControl";
import { useReceiver } from "../live/useReceiver";
import { useRecord } from "../live/useRecord";
import { explorerTxUrl } from "../model/chain/columns";
import { ledgerEvidence } from "../model/chain/match";
import { laterSends, shutOutByTx } from "../model/chain/overtaken";
import { recordQuestion } from "../model/chain/record";
import { CHANGE } from "../model/change";
import { receiptOk } from "../model/history";
import {
	copyNotesShown,
	type NoticeId,
	nextStepLabel,
	planNotices,
} from "../model/notices";
import { labelledLine } from "../model/parts";
import { proposalTimeline, recordEntries } from "../model/proposalTimeline";
import { refusalNote } from "../model/refusal";
import { RELAY_COPY } from "../model/relay/copy";
import { costLine, modeRefusal, standingRefusals } from "../model/send";
import { changeSummary } from "../model/signerSet";
import { signingNetwork } from "../model/signingNetwork";
import {
	deriveStage,
	FINISHED,
	type Phase,
	shortAddress,
	type WalletRole,
} from "../model/stage";
import { TreasuryNames, Who } from "../names/Names";
import { Sentence } from "../names/Sentence";
import { CostNote } from "../propose/ActionFields";
import { useTreasuries } from "../relay/queries";
import { useExecutionReporter } from "../relay/useExecutionReporter";
import { useRelay } from "../relay/useRelay";
import { AddressFact, Fact, Facts } from "../shell/Facts";
import { Headline } from "../shell/Headline";
import { Help } from "../shell/Help";
import {
	backLink,
	Card,
	linkButtonSm,
	NetTag,
	SignsTag,
	Tag,
} from "../shell/kit";
import { useNow, When } from "../shell/live";
import { ShellPage } from "../shell/ShellPage";
import { Split } from "../shell/Split";
import { AffectedList } from "../signers/AffectedList";
import { useAffected } from "../signers/useAffected";
import { TreasuryStrip } from "../TreasuryStrip";
import { useKnownProposals } from "../treasury/useKnownProposals";
import { useTreasuryNames } from "../treasuryName";
import { useLiveTreasuryState } from "../useTreasuryState";
import { useWalletSigner } from "../useWalletSigner";
import { ActionBar } from "./ActionBar";
import { CopyNotes } from "./CopyNotes";
import { FirstSign } from "./FirstSign";
import { Notices } from "./Notices";
import { OlderSends, useOlderSends } from "./OlderSends";
import { PARTY } from "./parties";
import { RecordNote } from "./RecordNote";
import { SharePanel } from "./SharePanel";
import { SignaturesPanel } from "./SignaturesPanel";
import { StageCallout } from "./StageCallout";
import { TellCoSigners } from "./TellCoSigners";
import { TimelineCard } from "./TimelineCard";
import type { ProposalDoc } from "./useProposalDoc";
import { useStakingStep } from "./useStakingStep";
import { useVaultStep } from "./useVaultStep";
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
	// held up by a no: still open, and the no can be taken back
	"cannot-pass",
	"finaliser-no",
	"refused",
]);
/** Phases in which what the send costs is still worth saying. */
const COSTED: ReadonlySet<Phase> = new Set([
	"collecting",
	"ready",
	"not-yet-valid",
]);
/** Phases after which nobody signs any more. */
const CLOSED: ReadonlySet<Phase> = new Set([
	"submitted",
	"carried-out",
	"in-effect",
	"closed",
	"withdrawn",
	"declined",
	"expired",
]);
/** Phases that end with "make a new one": the old action, a fresh nonce. */
const REPROPOSABLE: ReadonlySet<Phase> = new Set([
	"stuck",
	"overtaken",
	// with a different finaliser, or once the signers agree
	"cannot-pass",
	"finaliser-no",
	"refused",
	"expired",
	"withdrawn",
	"declined",
]);

/** What an address named in the action is to it, as a label. */
const NO_SIGNERS: readonly Address[] = [];

/** The stop notices' titles, said in full above the action and again beside the buttons. */
const SHORTFALL_TITLE = "Hyperliquid would refuse this as things stand";
const SIGNERS_CHANGED_TITLE = "The signers changed since this was proposed";
const NOT_SAVED_TITLE = "Not saved in this browser";

const ROLE: Record<WalletRole, string | null> = {
	disconnected: null,
	unknown: null,
	outsider: "not a signer",
	treasury: "the treasury itself",
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
	aside,
	notes,
}: {
	proposal: Proposal;
	issues: readonly Issue[];
	doc: ProposalDoc;
	/** Something the page that opened this has to say about it: said once, above the action. */
	aside?: { readonly title: string; readonly body: string };
	/** What opening the copy that brought this here left out (a link or a file). */
	notes?: readonly Issue[];
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
	// A proposal the relay does not hold (a link, a file) is followed the same
	// way until this copy says it was accepted: what its receipt reports of a
	// refusal is outside the receipt's signature, and Hyperliquid's own record
	// of the account is what says whether the action was carried out.
	const unsettled = row
		? row.status === "open" ||
			row.status === "withdrawn" ||
			row.status === "declined"
		: !(proposal.receipt && receiptOk(proposal.receipt));
	// A vault step is followed in the ledger also when it is not shared: the
	// ledger is the only place that shows a submission whose answer was lost.
	const vaultPending =
		vaultActionOf(proposal.payload.action) !== null &&
		row?.status !== "accepted" &&
		!(proposal.receipt && receiptOk(proposal.receipt));
	const treasury = useLiveTreasuryState(target, {
		ledger: unsettled || vaultPending,
	});
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
	// What Hyperliquid's ledger of the account says of this very proposal: a
	// row tied to it by its number (the transaction was read from the
	// explorer), or a row like it that could not be compared.
	const ledgerRows = unsettled ? treasury.live.ledger : null;
	const onLedger = useMemo(
		() => ledgerEvidence(ledgerRows, match.of, proposal.digest),
		[ledgerRows, match.of, proposal.digest],
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
	// A staking step: the lockup an unstake waits for, the state of the
	// validator a stake goes to, and whether Hyperliquid already has the step
	// (stake, unstake and the start of a return leave nothing in the ledger).
	const stakingStep = useStakingStep(
		proposal,
		!settled && !(proposal.receipt && receiptOk(proposal.receipt)),
	);
	const onRecord = stakingStep.record;
	// A vault step: the vault's name, the lockup a withdrawal waits for, that
	// adding to a deposit locks all of it again, and a row like it in the ledger.
	const vaultStep = useVaultStep(
		proposal,
		vaultPending,
		vaultPending ? treasury.live.ledger : null,
	);
	const vaultSeen = vaultStep.record;
	const stakingTx = useMemo(
		() =>
			onRecord?.kind === "matched"
				? [
						{
							time: onRecord.time,
							hash: onRecord.hash,
							digest: proposal.digest,
						},
					]
				: undefined,
		[onRecord, proposal.digest],
	);
	// A change of signers touches the other proposals still waiting: the same
	// record says which.
	const changeTo = useMemo<SignerSet | "revert" | null>(() => {
		if (proposal.payload.action.type !== "convertToMultiSigUser") return null;
		const asked = parseSignersString(proposal.payload.action.signers);
		return asked.revert ? "revert" : asked.set;
	}, [proposal.payload.action]);
	const known = useKnownProposals(
		target.network,
		target.address as Address,
		(ordered || changeTo !== null) && !settled,
	);
	const overtakenOnRecord = useMemo(
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
	// A send made some other way leaves no proposal here, only a row in the
	// treasury's ledger: its transaction says which number it carried.
	const ledger = treasury.live.ledger;
	const later = useMemo(
		() =>
			ordered && !settled && ledger
				? laterSends(ledger, proposal.payload.action).map((r) => ({
						account: target.address,
						hash: r.hash.toLowerCase(),
					}))
				: [],
		[ordered, settled, ledger, proposal.payload.action, target.address],
	);
	const laterTxs = useTxLookups(target.network, later);
	const overtakenOnChain = useMemo(() => {
		const txs = [...laterTxs.values()].flatMap((l) =>
			l.state === "found" ? [l.tx] : [],
		);
		return shutOutByTx(proposal.payload.action, target.address, txs) !== null;
	}, [laterTxs, proposal.payload.action, target.address]);
	const overtaken = overtakenOnRecord || overtakenOnChain;
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
	// The treasury's mode can rule the action out whatever else holds: said
	// before anyone signs, with the way out, and nothing is signed or sent.
	const refusal = modeRefusal(
		treasury.mode,
		proposal.payload.action,
		target.address,
	);
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
				: onRecord?.kind === "matched"
					? { txHash: onRecord.hash as Hex, seenBy: "page" }
					: onLedger.tied
						? { txHash: onLedger.tied as Hex, seenBy: "ledger" }
						: null,
		likeOnRecord: onLedger.like,
		heldUntil: stakingStep.heldUntil ?? vaultStep.heldUntil,
		codeSigning: signingNetwork() !== null,
		closedUnknown: row?.status === "unknown",
		overtaken,
		headerNetwork: header,
		// who said no: an objection, counted against the live signers like a signature
		objections: doc.relay.objections,
		// one clock for the page: the same event reads the same age wherever it is said
		now: clock,
		refusal: refusal?.title ?? null,
	});
	const role = ROLE[stage.role];
	const description = useMemo(
		// with its network: a vault action names none, and its lockup is the network's
		() =>
			describeAction(proposal.payload.action, {
				network: proposal.payload.network,
			}),
		[proposal.payload.action, proposal.payload.network],
	);
	// While it can still be signed or sent: who is being paid, and what that
	// costs now (an address that was new when this was proposed may be in use
	// by the time it is submitted).
	// For a change of signers still to be decided: what it does, against the
	// signers Hyperliquid reports now (never the document's unsigned note of
	// who they were when it was made).
	const liveSet =
		COSTED.has(stage.phase) &&
		state.policy &&
		state.policy.authorizedUsers.length > 0
			? state.policy
			: null;
	const touched = useAffected(
		known.proposals,
		liveSet,
		changeTo,
		proposal.digest,
	);
	const payee = useMemo(
		() => sendShape(proposal.payload.action)?.destination || null,
		[proposal.payload.action],
	);
	const lookup = useReceiver(
		target.network,
		COSTED.has(stage.phase) ? payee : null,
		{ settleMs: 0, recheckMs: CONTROL_REFRESH_MS },
	);
	const blocked = COSTED.has(stage.phase) ? refusal : null;
	// what the balances say against it now, as the form said when it was made
	const shortfall =
		COSTED.has(stage.phase) && !blocked
			? standingRefusals(proposal.payload.action, {
					mode: treasury.mode,
					perpsUsdc: treasury.perp?.withdrawable ?? null,
					spot: treasury.spot,
					receiver: null,
					self: target.address,
				})
			: [];
	const cost =
		blocked || lookup.state === "idle"
			? null
			: costLine({
					action: proposal.payload.action,
					receiver: lookup.state === "loading" ? "loading" : lookup.receiver,
					mode: treasury.mode,
					perpsUsdc: treasury.perp?.withdrawable ?? null,
					spot: treasury.spot,
				});

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
		also: stakingTx,
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
	const carriedTx =
		doc.relay.carriedOut?.txHash ??
		(onRecord?.kind === "matched" ? onRecord.hash : null) ??
		onLedger.tied;
	const treasuryName = listed
		? nameOf(target.network, target.address as Address)
		: shortAddress(target.address);
	// the relay's word, never the copy's: who proposed it is not signed
	const proposer = row?.createdBy ?? null;
	const ready = judged;
	// who did what, when: the sharing service's history, or the copy itself;
	// Hyperliquid's record only where the page already reads it (once sent)
	const recordAsk = useMemo(
		() => (stage.phase === "submitted" ? recordQuestion(proposal) : null),
		[stage.phase, proposal],
	);
	const record = useRecord(target.network, recordAsk);
	const timeline = useMemo(
		() =>
			proposalTimeline(
				[
					{
						proposal,
						events: doc.relay.history,
						counted: ready?.counted ?? null,
					},
				],
				me,
				recordEntries(record),
			),
		[proposal, doc.relay.history, ready, me, record],
	);
	const repropose = (
		<Link
			to="/multisig/propose"
			// the proposal's own network, never the header's: a testnet proposal
			// re-proposed under a mainnet header must open a testnet form
			search={{
				treasury: target.address,
				supersedes: proposal.digest,
				network: target.network,
			}}
			className={linkButtonSm}
		>
			Propose it again
		</Link>
	);

	// on a phone, the bar at the bottom brings this wallet's part into view
	const partRef = useRef<HTMLDivElement>(null);

	// The stop notices that apply, by title: shown in full above the action
	// and said again, one line each, right above the buttons that sign or send.
	const older = useOlderSends(proposal, COSTED.has(stage.phase));
	const rejectedTitle =
		stage.failedAttempt && stage.phase !== "carried-out"
			? `The last attempt to send it was refused: ${stage.failedAttempt.message}`
			: null;
	const signersChanged = stage.policyChanged && !CLOSED.has(stage.phase);
	const stopTitles: Partial<Record<NoticeId, string | null>> = {
		"refused-now": blocked?.title ?? null,
		shortfall: shortfall.length > 0 ? SHORTFALL_TITLE : null,
		"older-sends": older.title,
		rejected: rejectedTitle,
		"signers-changed": signersChanged ? SIGNERS_CHANGED_TITLE : null,
		"not-saved": doc.storageError ? NOT_SAVED_TITLE : null,
		"sharing-refused":
			doc.relay.issue?.severity === "error" ? doc.relay.issue.message : null,
	};
	const stops = planNotices(
		Object.fromEntries(
			Object.entries(stopTitles).map(([id, title]) => [id, title ? 1 : 0]),
		),
	).stops.flatMap((id) => stopTitles[id] ?? []);

	// the description's lines as the confirmation sets them: a field and its
	// value in the table, a sentence whole under the headline
	const pairs: { readonly label: string; readonly value: string }[] = [];
	const sentences: string[] = [];
	for (const line of description.lines) {
		const pair = labelledLine(line);
		if (pair) pairs.push(pair);
		else sentences.push(line);
	}

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
							<Tag
								tone={
									stage.role === "outsider" || stage.role === "treasury"
										? "gray"
										: "you"
								}
							>
								you: {role}
							</Tag>
						)}
						<SignsTag />
					</>
				}
			>
				<div className="flex flex-col gap-4">
					<Split
						top={
							<>
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
													Check Hyperliquid's record in the inspector
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
								{/* also for a copy that came by link or file: what it says of the
						    answer is its finaliser's report, whoever carried it here */}
								{stage.phase === "submitted" &&
									!stage.role.includes("finaliser") && (
										<p className="-mt-2 px-0.5 text-xs text-subtle-foreground">
											{RELAY_COPY.reportedReceipt}
										</p>
									)}
								{/* The confirmation, right under where it stands: the signed action
								    set like a transfer (the verb, the amount as the largest figure,
								    the address whole), then whom it names, each address in full.
								    The headline is the signed action; a title above it is not. */}
								<Card
									title="Action"
									actions={<NetTag network={target.network} />}
								>
									<Headline text={description.headline} />
									{(description.flags.length > 0 || !description.known) && (
										<div className="mt-3 flex flex-wrap gap-1.5">
											{description.flags.map((f) => (
												<Tag
													key={f}
													// a long one wraps on a narrow phone; 10 px is as round as a full radius on one line
													className="whitespace-normal rounded-[10px]"
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
									{sentences.length > 0 && (
										// a sentence about the action stays whole: which balance it leaves, where it arrives
										<ul className="mt-3 space-y-0.5 text-[13px] text-muted-foreground">
											{sentences.map((line) => (
												<li key={line} className="[overflow-wrap:anywhere]">
													{line}
												</li>
											))}
										</ul>
									)}
									<Facts className="mt-4 border-t border-border pt-3.5">
										<AddressFact label="Treasury" address={target.address} />
										{description.parties.map((party) => (
											// Before anything is signed: the whole address, and where its
											// nickname comes from. A nickname is a label somebody typed.
											<AddressFact
												key={`${party.role}:${party.address}`}
												label={PARTY[party.role]}
												address={party.address}
												room="1.75rem"
											>
												<Who address={party.address} full editable />
												{party.address === me && " (you)"}
												{party.role === "validator" &&
													stakingStep.validator?.address === party.address &&
													stakingStep.validator.name.trim() && (
														// the validator's own word for itself, as Hyperliquid lists it
														<span className="ml-1.5 text-muted-foreground">
															listed as “
															<bdi>{stakingStep.validator.name.trim()}</bdi>”
														</span>
													)}
												{party.role === "vault" &&
													vaultStep.vault?.address === party.address &&
													vaultStep.vault.name.trim() && (
														// the vault's own name, as Hyperliquid reports it
														<span className="ml-1.5 text-muted-foreground">
															named “
															<bdi>
																{cutTo(vaultStep.vault.name.trim(), 40)}
															</bdi>
															” on Hyperliquid
														</span>
													)}
											</AddressFact>
										))}
										{pairs.map((pair) => (
											// a field and its value side by side
											<Fact
												key={`${pair.label}:${pair.value}`}
												label={pair.label}
											>
												{pair.value}
											</Fact>
										))}
										<AddressFact
											label={
												<>
													Finaliser <Help k="finaliser" />
												</>
											}
											address={proposal.payload.outerSigner}
										>
											<Who address={proposal.payload.outerSigner} full />
											{proposal.payload.outerSigner === me ? " (you)" : ""}
										</AddressFact>
										{proposal.meta.note && (
											<Fact label="Note">{proposal.meta.note}</Fact>
										)}
									</Facts>
									<CostNote line={cost} />
									{COSTED.has(stage.phase) && stakingStep.noPay && (
										// read from Hyperliquid for every signer who opens this
										<p className="mt-3 flex items-start gap-1.5 text-[13px] text-warning">
											<span
												className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
												aria-hidden
											/>
											<span>{stakingStep.noPay}</span>
										</p>
									)}
									{COSTED.has(stage.phase) && vaultStep.relocks && (
										<p className="mt-3 flex items-start gap-1.5 text-[13px] text-warning">
											<span
												className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
												aria-hidden
											/>
											<span>{vaultStep.relocks}</span>
										</p>
									)}
									{stage.phase === "collecting" && stage.closesFirst && (
										// once it is ready the line under the title says this itself
										<p
											data-closes-first
											className="mt-3 flex items-start gap-1.5 text-[13px] text-warning"
										>
											<span
												className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
												aria-hidden
											/>
											<span>
												<Sentence parts={stage.closesFirst} />
											</span>
										</p>
									)}
									{COSTED.has(stage.phase) &&
										(vaultSeen?.kind === "likely" ||
											vaultSeen?.kind === "several") && (
											<p
												data-may-be-done
												className="mt-3 flex items-start gap-1.5 text-[13px] text-warning"
											>
												<span
													className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
													aria-hidden
												/>
												<span>
													{vaultSeen.kind === "likely" ? (
														<>
															Hyperliquid's record of this treasury shows a
															vault{" "}
															{vaultStep.step?.kind === "withdraw"
																? "withdrawal"
																: "deposit"}{" "}
															like this one on <When at={vaultSeen.time} />. It
															may be this proposal, already carried out: a vault
															action carries no number that would tell.{" "}
														</>
													) : (
														"Hyperliquid's record of this treasury shows several vault steps like this one since it was proposed. One of them may be this proposal, already carried out: a vault action carries no number that would tell. "
													)}
													<Link
														to="/multisig/t/$network/$address"
														params={{
															network: target.network,
															address: target.address,
														}}
														search={{ tab: "chain" }}
														className="underline underline-offset-2"
													>
														Look at On Hyperliquid
													</Link>{" "}
													before sending it.
												</span>
											</p>
										)}
									{COSTED.has(stage.phase) &&
										(onRecord?.kind === "likely" ||
											onRecord?.kind === "unchecked") && (
											<p className="mt-3 flex items-start gap-1.5 text-[13px] text-warning">
												<span
													className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
													aria-hidden
												/>
												<span>
													{onRecord.kind === "likely" ? (
														<>
															Hyperliquid's staking history shows a step like
															this one on <When at={onRecord.time} />. It may be
															this proposal, already carried out: the explorer
															did not say.{" "}
															<a
																href={explorerTxUrl(
																	target.network,
																	onRecord.hash,
																)}
																target="_blank"
																rel="noreferrer"
																className="underline underline-offset-2"
															>
																Look at that transaction
															</a>{" "}
															before sending it.
														</>
													) : (
														"Hyperliquid's staking history shows several steps like this one, and the explorer did not say whether one of them is this proposal. Look at the treasury's Staking history before sending it."
													)}
												</span>
											</p>
										)}
									{changeTo && liveSet && (
										<div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3">
											<h3 className="text-xs font-medium">
												{CHANGE.whatChanges}
											</h3>
											<p className="text-sm [overflow-wrap:anywhere]">
												<Sentence
													parts={changeSummary(
														liveSet,
														changeTo === "revert" ? null : changeTo,
													)}
												/>
											</p>
											<p className="text-xs text-muted-foreground">
												{CHANGE.againstNow}
											</p>
											<AffectedList
												affected={touched.affected}
												computing={touched.computing}
												state={known.state}
												relayInUse={relay.mode === "on"}
											/>
										</div>
									)}
									{(proposal.meta.title || proposal.meta.note) && (
										<p className="mt-3 text-xs text-subtle-foreground">
											The title and note are not signed: whoever shared the
											proposal wrote them. The action above is what signers
											sign.
										</p>
									)}
								</Card>
								<FirstSign
									canSign={ACTIONABLE.has(stage.phase) && stage.canSign}
								/>
								<Notices
									items={{
										// the report against Hyperliquid's record, from this browser
										record: stage.phase === "submitted" && (
											<RecordNote
												network={target.network}
												proposal={proposal}
											/>
										),
										"copy-refusal": stage.failedAttempt &&
											stage.phase === "carried-out" && (
												// the copy's answer against Hyperliquid's record: the record is above
												<Callout
													tone="warning"
													title={`This copy reports a refusal: ${stage.failedAttempt.message}`}
												>
													The answer in a copy is what was written into it.
													Hyperliquid's own record of the account, above, is
													what counts.
												</Callout>
											),
										rejected: rejectedTitle && (
											<Callout
												tone="danger"
												title={rejectedTitle}
												action={
													// "already used" often means it went through somewhere else: the ledger says
													stage.failedAttempt?.id === "nonce-duplicate" ? (
														<Link
															to="/tools/multisig"
															search={{
																view: "account",
																address: target.address,
															}}
															className={linkButtonSm}
														>
															Check Hyperliquid's record in the inspector
														</Link>
													) : undefined
												}
											>
												{stage.failedAttempt &&
													refusalNote(stage.failedAttempt)}
											</Callout>
										),
										aside: aside && (
											<Callout tone="info" title={aside.title}>
												{aside.body}
											</Callout>
										),
										"copy-notes": copyNotesShown(notes).length > 0 && (
											<CopyNotes notes={notes} />
										),
										"refused-now": blocked && (
											<Callout
												tone="warning"
												title={blocked.title}
												action={repropose}
											>
												{blocked.message}
											</Callout>
										),
										shortfall: shortfall.length > 0 && (
											<Callout tone="warning" title={SHORTFALL_TITLE}>
												{shortfall.map((r) => r.message).join(" ")} It can still
												be signed: the balances may change before it is sent.
											</Callout>
										),
										"older-sends": COSTED.has(stage.phase) && (
											<OlderSends older={older} />
										),
										// once nobody signs any more, how signatures are counted is moot
										"signers-changed": signersChanged && (
											<Callout tone="warning" title={SIGNERS_CHANGED_TITLE}>
												Signatures are counted against the signers Hyperliquid
												reports now, not the ones written in the proposal.
											</Callout>
										),
										"not-saved": doc.storageError && (
											<Callout tone="warning" title={NOT_SAVED_TITLE}>
												{doc.storageError} The proposal stays on this page until
												you close it; download the file to keep it.
											</Callout>
										),
										// a refused write is a stop: co-signers may not see what was done here
										[doc.relay.issue?.severity === "error"
											? "sharing-refused"
											: "sharing"]: doc.relay.issue && (
											<Callout
												tone={
													doc.relay.issue.severity === "error"
														? "danger"
														: "warning"
												}
												title={doc.relay.issue.message}
											>
												{doc.relay.issue.fix}
											</Callout>
										),
										// what this browser refused to take from the relay's copy
										"sharing-notes": relayNotes.map((n) => (
											<Callout
												key={n.code + n.message}
												tone="warning"
												title={n.message}
											>
												{n.fix}
											</Callout>
										)),
									}}
								/>
							</>
						}
						main={
							ACTIONABLE.has(stage.phase) && (
								<div
									ref={partRef}
									tabIndex={-1}
									className="scroll-mt-20 outline-none"
								>
									<YourPart
										// what one wallet did ("Signature added", a refusal) is not
										// said to the next one that connects
										key={wallet.address ?? "nobody"}
										proposal={proposal}
										stage={stage}
										wallet={wallet}
										doc={doc}
										have={ready?.have ?? 0}
										need={ready?.need ?? null}
										signers={state.policy?.authorizedUsers ?? NO_SIGNERS}
										now={clock}
										// what is signed, said again where it is signed, and every stop
										restate={{
											headline: description.headline,
											network: target.network,
										}}
										stops={stops}
									/>
								</div>
							)
						}
						side={
							<>
								<SignaturesPanel
									proposal={proposal}
									policy={state.policy}
									counted={ready ? ready.counted : null}
									me={me}
									closed={CLOSED.has(stage.phase)}
									seen={seen}
									objected={stage.standing?.objected}
									now={clock}
								/>
								<TimelineCard timeline={timeline} network={target.network} />
								<TellCoSigners proposal={proposal} doc={doc} />
								<SharePanel
									proposal={proposal}
									store={doc.store}
									secondary={doc.relay.known}
									finished={FINISHED.has(stage.phase)}
								/>
							</>
						}
					/>

					<details className="group min-w-0">
						<summary className="cursor-pointer list-none text-[13px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
							<span className="group-open:hidden">
								{/* jargon: the expert fold, named by what it holds */}▸ For
								experts: treasury, digests, each signature, the envelope
							</span>
							<span className="hidden group-open:inline">▾ For experts</span>
						</summary>
						{/* the treasury as a strip across the top, the expert reading below it */}
						<div className="mt-4 flex flex-col gap-5">
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
					<ActionBar
						label={ACTIONABLE.has(stage.phase) ? nextStepLabel(stage) : null}
						target={partRef}
					/>
				</div>
			</ShellPage>
		</TreasuryNames>
	);
}
