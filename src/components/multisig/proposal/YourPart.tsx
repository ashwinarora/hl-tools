import {
	type Address,
	type Issue,
	type Network,
	type Proposal,
	stakingActionOf,
	vaultActionOf,
} from "@hl-tools/core";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { Callout, IssueList } from "#/components/hub/status";
import {
	agentsQueryOptions,
	modeQueryOptions,
} from "#/components/tools/multisig/policyQuery";
import { useNetworkStore } from "#/store/networkStore";
import { refreshStaking } from "../live/useStaking";
import { refreshVaults } from "../live/useVaults";
import { modeTargetOf } from "../model/modeSwitch";
import {
	cancelNote,
	finishHint,
	RELAY_COPY,
	SHARE_FIRST,
	signHint,
} from "../model/relay/copy";
import { objectionNote, ownPosition } from "../model/relay/positions";
import { relayActions } from "../model/relay/status";
import { CODE_COPY } from "../model/signingNetwork";
import {
	CANNOT_BE_SENT,
	FINALISER_AWAY,
	heldWhat,
	type Stage,
	shortAddress,
} from "../model/stage";
import { untilWords } from "../model/time";
import {
	done as doneToast,
	failed as failedToast,
	SEND_ANSWER,
	SENDING,
	TOAST_LINES,
	TOAST_TITLES,
	unsure as unsureToast,
} from "../model/toasts";
import { Sentence } from "../names/Sentence";
import { Headline } from "../shell/Headline";
import { Heard } from "../shell/Heard";
import { Help } from "../shell/Help";
import { Btn, Card, NetTag, Tag } from "../shell/kit";
import { When } from "../shell/live";
import { notify } from "../shell/notify";
import { SwitchToSigner } from "../shell/SwitchToSigner";
import type { WalletSigner } from "../useWalletSigner";
import {
	type FinaliseResult,
	finalise,
	type Outcome,
	type StepId,
	type StepState,
	signInner,
} from "./actions";
import { CodePanel } from "./CodePanel";
import type { ProposalDoc } from "./useProposalDoc";

const NO_STOPS: readonly string[] = [];

const FRESH: Record<StepId, StepState> = {
	inner: "todo",
	envelope: "todo",
	submit: "todo",
};

/**
 * What the connected wallet can do to this proposal: one primary button
 * (sign, or for the finaliser sign and submit), and next to it what the relay
 * offers besides: take a signature back, say no (an objection the others see,
 * which ends nothing) or take the no back, and for the proposer, withdraw.
 */
export function YourPart({
	proposal,
	stage,
	wallet,
	doc,
	have,
	need,
	signers,
	now,
	restate,
	stops = NO_STOPS,
}: {
	proposal: Proposal;
	stage: Stage;
	wallet: WalletSigner;
	doc: ProposalDoc;
	/** Verified signatures of current signers, and how many are needed (null while unknown). */
	have: number;
	need: number | null;
	/** The treasury's signers as Hyperliquid reports them now. */
	signers: readonly Address[];
	/** The page's clock: one for every age said on it. */
	now: number;
	/** What is signed, said again at the top of this part: the action's headline and its network. */
	restate?: { readonly headline: string; readonly network: Network };
	/** The titles of the stop notices that apply, said again right above the buttons. */
	stops?: readonly string[];
}) {
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const [steps, setSteps] = useState<Record<StepId, StepState> | null>(null);
	const [failure, setFailure] = useState<readonly Issue[] | null>(null);
	/** Hyperliquid's answer to this page's own send. */
	const [sent, setSent] = useState<"accepted" | "refused" | "used" | null>(
		null,
	);
	/** Sent with no clear answer: what was said, and the same request to post again. */
	const [unclear, setUnclear] = useState<{
		readonly issues: readonly Issue[];
		readonly retry: () => Promise<FinaliseResult>;
	} | null>(null);
	const [confirm, setConfirm] = useState(false);
	const [finishing, setFinishing] = useState(false);
	// the wallet answered that it lacks the signing network: the code panel offers to add it
	const [needsNetwork, setNeedsNetwork] = useState(false);
	const [addFailed, setAddFailed] = useState<string | null>(null);
	const queries = useQueryClient();

	const { network, outerSigner } = proposal.payload;
	const me = wallet.address as Address | null;
	const isFinaliser = !!me && me === outerSigner;
	const row = doc.relay.row;
	const actions = relayActions({
		known: doc.relay.known,
		status: row?.status ?? "open",
		expired: doc.relay.expired,
		me,
		createdBy: row?.createdBy ?? outerSigner,
		finaliser: outerSigner,
		relaySigners: row?.signatures.map((s) => s.signer) ?? [],
		isSigner: !!me && signers.includes(me),
		objected: doc.relay.objections.map((o) => o.signer),
		final: CANNOT_BE_SENT.has(stage.phase),
	});
	// What the reader is told about a no: their own, in their own words; the
	// others', as one amber line above the buttons. A fact, with no click.
	const mine = stage.standing
		? ownPosition({
				standing: stage.standing,
				me,
				finaliser: outerSigner,
				now,
			})
		: null;
	const theirs =
		stage.standing && (stage.canSign || stage.canExecute)
			? objectionNote(stage.standing, me, now)
			: null;
	const adds = stage.executeAddsSignature;
	const chain = stage.requiredChain;
	// what a submission that waits for a lockup takes from: a stake, or a vault deposit
	const held = heldWhat(proposal.payload.action);
	// this click asks the wallet for a code: a finaliser who only submits signs
	// none, even one who could still sign (the click on offer is Submit)
	const signsCodeNow =
		stage.signsCode && (stage.canExecute ? adds : stage.canSign);

	const doSign = async () => {
		setOutcome(null);
		setFailure(null);
		const done = (await signInner(proposal, stage, wallet, doc.store)).outcome;
		// not a failure: the wallet has to be given the network first
		if (!done.ok && done.needsNetwork) setNeedsNetwork(true);
		else {
			setNeedsNetwork(false);
			setOutcome(done);
			notify(
				done.ok
					? doneToast(TOAST_TITLES.signed, TOAST_LINES.signedOnly)
					: failedToast(TOAST_TITLES.notSigned, done.issues),
			);
		}
	};
	const sign = () => void wallet.run("Waiting for the wallet…", doSign);
	/** A relay button's result, in a toast. */
	const said = (title: string) => (problem: { message: string } | null) =>
		notify(
			problem
				? failedToast(TOAST_TITLES.sharingRefused, problem)
				: doneToast(title),
		);

	/** What a send came to, on the page and in a toast. */
	const heard = (result: FinaliseResult) => {
		if (!result.ok && result.needsNetwork) {
			setNeedsNetwork(true);
			return;
		}
		setNeedsNetwork(false);
		if (!result.ok && result.retry) {
			setUnclear({ issues: result.issues, retry: result.retry });
			notify(unsureToast(TOAST_TITLES.unclear, SEND_ANSWER.unclear));
			return;
		}
		setUnclear(null);
		if (!result.ok) {
			setFailure(result.issues);
			notify(failedToast(TOAST_TITLES.notSent, result.issues));
			return;
		}
		setSent(result.answer);
		notify(
			result.answer === "accepted"
				? doneToast(TOAST_TITLES.accepted, TOAST_LINES.final)
				: result.answer === "used"
					? unsureToast(TOAST_TITLES.used, SEND_ANSWER.used)
					: failedToast(TOAST_TITLES.refused, result.reason),
		);
		if (!result.accepted) return;
		// a staking step that went through changed what the treasury has in staking
		if (stakingActionOf(proposal.payload.action))
			void refreshStaking(
				queries,
				proposal.payload.network,
				proposal.payload.multiSigUser,
			);
		// a vault step that went through changed what the treasury has in vaults
		else if (vaultActionOf(proposal.payload.action))
			void refreshVaults(
				queries,
				proposal.payload.network,
				proposal.payload.multiSigUser,
			);
		// the same for the mode and the API wallets, which are read once a minute otherwise
		else if (modeTargetOf(proposal.payload.action))
			void queries.invalidateQueries({
				queryKey: modeQueryOptions(
					proposal.payload.network,
					proposal.payload.multiSigUser,
				).queryKey,
			});
		else if (proposal.payload.action.type === "approveAgent")
			void queries.invalidateQueries({
				queryKey: agentsQueryOptions(
					proposal.payload.network,
					proposal.payload.multiSigUser,
				).queryKey,
			});
	};

	const doSubmit = async () => {
		setOutcome(null);
		setFailure(null);
		setSent(null);
		setUnclear(null);
		setSteps(FRESH);
		setFinishing(true);
		const result = await finalise({
			proposal,
			stage,
			wallet,
			doc,
			mark: (id, state) => setSteps((s) => ({ ...(s ?? FRESH), [id]: state })),
		});
		setFinishing(false);
		heard(result);
	};
	/** The very same signed request once more: no wallet prompt, and it cannot pay twice. */
	const tryAgain = () =>
		void wallet.run(SEND_ANSWER.tryingAgain, async () => {
			const again = unclear?.retry;
			if (!again) return;
			heard(await again());
		});
	const submit = () => void wallet.run(SENDING, doSubmit);

	/** One approval in the wallet adds the network; then what was asked for goes on. */
	const addNetwork = () =>
		void wallet.run("Waiting for the wallet…", async () => {
			setAddFailed(null);
			const added = await wallet.addSigningNetwork();
			if (!added.ok) {
				setAddFailed(added.error);
				return;
			}
			setNeedsNetwork(false);
			await (stage.canExecute ? doSubmit() : doSign());
		});

	const rows: { id: StepId; label: string }[] = [
		...(adds || (steps && steps.inner !== "todo")
			? [{ id: "inner" as const, label: "Your signature on the action" }]
			: []),
		{ id: "envelope", label: "Your signature as finaliser" },
		{ id: "submit", label: `Sent to Hyperliquid ${network}` },
	];

	if (finishing && steps) {
		return (
			<Card title="Finishing">
				<ol className="flex flex-col gap-2">
					{rows.map((r, i) => {
						const state = steps[r.id];
						return (
							<li
								key={r.id}
								className={
									state === "todo"
										? "flex items-center gap-2.5 text-sm text-muted-foreground"
										: "flex items-center gap-2.5 text-sm"
								}
							>
								<span
									className={
										state === "done"
											? "grid size-5 shrink-0 place-items-center rounded-full bg-success text-[11px] text-surface"
											: state === "active"
												? "grid size-5 shrink-0 place-items-center rounded-full border border-brand text-[11px] text-brand"
												: "grid size-5 shrink-0 place-items-center rounded-full border border-border-strong text-[11px]"
									}
								>
									{state === "done" ? (
										<Check className="size-3" aria-hidden />
									) : (
										i + 1
									)}
								</span>
								{r.label}
								{state === "active" && (
									<span className="text-subtle-foreground">· waiting…</span>
								)}
								<span className="sr-only">: {state}</span>
							</li>
						);
					})}
				</ol>
				{stage.signsCode && adds && (
					// the first prompt shows the code: it has to be on the page to compare
					<div className="mt-3">
						<CodePanel payload={proposal.payload} />
					</div>
				)}
				<p className="mt-3 text-[13px] text-muted-foreground">
					{finishHint(proposal.payload.action, adds, stage.signsCode)}
				</p>
			</Card>
		);
	}

	const waiting = need !== null ? Math.max(0, need - have) : null;
	// only this browser holds it, as far as this page can tell: nobody else
	// will sign before it is passed on (audit F-125); while the hl-tools server
	// cannot be reached the page cannot tell, and says nothing either way
	const shareFirst =
		!doc.relay.known &&
		!doc.relay.loading &&
		!(doc.relay.active && doc.relay.issue);
	const note = unclear
		? SEND_ANSWER.tryAgainNote
		: stage.phase === "stuck"
			? actions.withdraw
				? "It cannot be sent, so nothing here needs a signature. Cancel it, then propose it again with another finaliser."
				: "It cannot be sent, so nothing here needs your signature. Its proposer can cancel it."
			: stage.phase === "used"
				? "Nothing here needs a signature: Hyperliquid already has this proposal's number. Check Hyperliquid's record."
				: stage.phase === "overtaken" || stage.phase === "refused"
					? actions.withdraw
						? "It cannot be sent, so nothing here needs a signature. Cancel it, then propose it again."
						: "It cannot be sent, so nothing here needs your signature. Its proposer can cancel it and propose it again."
					: stage.canExecute
						? adds
							? `Your signature completes the number needed. Two wallet prompts, then it is sent to Hyperliquid. ${RELAY_COPY.sendIsFinal}`
							: `One wallet prompt, then it is sent to Hyperliquid. ${RELAY_COPY.sendIsFinal} ${finishHint(proposal.payload.action, false)}`
						: stage.canSign
							? `${signHint(proposal.payload.action)}${stage.signsCode ? ` ${CODE_COPY.signedUnder}` : chain ? ` Your wallet may ask to switch to ${chain.label} first, then to sign. Nothing is sent or paid there.` : ""}`
							: stage.hasSigned
								? stage.phase === "finaliser-no"
									? // the status above says the finaliser said no: this part follows it (audit F-120)
										`You signed this, but ${isFinaliser ? "you" : shortAddress(outerSigner)}, the finaliser, said no: it will not be sent unless that no is taken back. ${isFinaliser ? "" : FINALISER_AWAY}`.trim()
									: stage.phase === "cannot-pass"
										? "You signed this, but a no holds it up: it cannot pass as things stand. The top of this page says what would change that."
										: stage.phase === "ready"
											? isFinaliser
												? "You signed this. It is waiting for you to send it."
												: `You signed this. Only ${shortAddress(outerSigner)}, the finaliser, can send it. ${FINALISER_AWAY}`
											: waiting
												? `You signed this. It needs ${waiting} more ${waiting === 1 ? "signature" : "signatures"}; then ${isFinaliser ? "you send" : `${shortAddress(outerSigner)} sends`} it. ${shareFirst ? SHARE_FIRST : "You can close this page."}`
												: "You signed this."
								: (stage.signReason ?? stage.executeReason ?? "");
	// the wallet is the treasury account: the same sentence as on its own page
	const itself = stage.role === "treasury" && note === stage.signReason;

	// Submit is shown switched off while only time stands in its way
	const waits = stage.opensAt !== null && !stage.canExecute;
	const any =
		stage.canExecute ||
		stage.canSign ||
		waits ||
		actions.takeBack ||
		actions.withdraw ||
		actions.sayNo ||
		actions.takeBackNo;

	return (
		<Card
			title={
				<span className="inline-flex items-center gap-1.5">
					Your part
					{(actions.takeBack ||
						actions.withdraw ||
						actions.sayNo ||
						actions.takeBackNo) && <Help k="waysOut" />}
				</span>
			}
			actions={isFinaliser ? <Tag tone="you">you are the finaliser</Tag> : null}
		>
			{restate && <Restated {...restate} />}
			{theirs && (
				<p className="mb-2.5 flex items-start gap-1.5 text-[13px] text-warning">
					<span
						className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
						aria-hidden
					/>
					<span>
						<Sentence parts={theirs} />
					</span>
				</p>
			)}
			{signsCodeNow && (
				<div className="mb-3">
					<CodePanel
						payload={proposal.payload}
						needsNetwork={needsNetwork}
						busy={wallet.busy}
						onAdd={addNetwork}
						failed={addFailed}
					/>
				</div>
			)}
			{(stage.canExecute || stage.canSign || waits) && (
				<StopLines titles={stops} />
			)}
			{any && (
				<div className="flex flex-wrap items-center gap-2">
					{unclear ? (
						// the same request again, never a new signature over it
						<Btn variant="brand" disabled={wallet.busy} onClick={tryAgain}>
							{SEND_ANSWER.tryAgain}
						</Btn>
					) : stage.canExecute ? (
						<Btn
							variant={needsNetwork ? "outline" : "brand"}
							disabled={wallet.busy || doc.relay.busy}
							onClick={submit}
						>
							{adds ? "Sign and send to Hyperliquid" : "Send to Hyperliquid"}
						</Btn>
					) : stage.canSign ? (
						<Btn
							variant={needsNetwork ? "outline" : "brand"}
							disabled={wallet.busy || doc.relay.busy}
							onClick={sign}
						>
							{chain && !stage.onRequiredChain
								? `Switch to ${chain.label.replace(/ \(\d+\)$/, "")} and sign`
								: `Sign as ${me ? shortAddress(me) : "…"}`}
						</Btn>
					) : null}
					{waits && (
						<Btn
							variant="brand"
							disabled
							title={`Hyperliquid would refuse it before the ${held}'s lockup has ended.`}
						>
							Send to Hyperliquid
						</Btn>
					)}
					{actions.takeBack && (
						<Btn
							variant="outline"
							disabled={doc.relay.busy || wallet.busy}
							title={RELAY_COPY.takeBackHint}
							onClick={() => {
								setOutcome(null);
								void doc.takeBack().then(said(TOAST_TITLES.takenBack));
							}}
						>
							Take back my signature
						</Btn>
					)}
					{actions.takeBackNo && (
						<Btn
							variant={stage.canSign || stage.canExecute ? "outline" : "brand"}
							disabled={doc.relay.busy || wallet.busy}
							onClick={() => {
								setOutcome(null);
								void doc.takeBackNo().then(said(TOAST_TITLES.noTakenBack));
							}}
						>
							{RELAY_COPY.takeBackNo}
						</Btn>
					)}
					{actions.sayNo && (
						<Btn
							variant="outline"
							className="border-warning/50 text-warning hover:text-warning"
							disabled={doc.relay.busy || wallet.busy}
							title={
								stage.hasSigned ? RELAY_COPY.saidNoAfterSigning : undefined
							}
							onClick={() => {
								setOutcome(null);
								void doc.sayNo().then(said(TOAST_TITLES.saidNo));
							}}
						>
							{RELAY_COPY.sayNo}
						</Btn>
					)}
					{actions.withdraw && (
						<Btn
							variant="outline"
							className="border-danger/40 text-danger hover:text-danger"
							disabled={doc.relay.busy}
							onClick={() => setConfirm(true)}
						>
							Cancel for everyone
						</Btn>
					)}
				</div>
			)}
			{waits && stage.opensAt !== null && !stage.closesFirst && (
				<p className="mt-2.5 flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
					<span>
						Sending opens on <When at={stage.opensAt} /> (
						{untilWords(stage.opensAt, now)}): the {held} this takes from is
						locked until then.
						{stage.canSign ? " You can sign now." : ""}
					</span>
					<Help k={held === "deposit" ? "vaultLockup" : "stakeLockup"} />
				</p>
			)}
			{itself ? (
				<SwitchToSigner signers={signers} className={any ? "mt-2.5" : ""} />
			) : mine ? (
				// the reader's own no, in place of the note about signing
				<p
					className={
						any
							? "mt-2.5 text-[13px] text-muted-foreground"
							: "text-[13px] text-muted-foreground"
					}
				>
					<Sentence parts={mine} /> <Help k="sayNo" />
				</p>
			) : note && !(waits && !stage.canSign) ? (
				<p
					className={
						any
							? "mt-2.5 text-[13px] text-muted-foreground"
							: "text-[13px] text-muted-foreground"
					}
				>
					{note}
					{stage.canSign && !stage.canExecute && chain && (
						<>
							{" "}
							<Help k="signingChain" />
						</>
					)}
				</p>
			) : null}
			{stage.networkMismatch && (
				<div className="mt-3">
					<Btn size="sm" variant="outline" onClick={() => setNetwork(network)}>
						Switch the header to {network}
					</Btn>
				</div>
			)}
			{confirm && (
				<Callout
					tone="warning"
					className="mt-3"
					title="Cancel this proposal for everyone?"
					action={
						<div className="flex flex-wrap items-center gap-2">
							<Btn
								size="sm"
								variant="outline"
								className="border-danger/40 text-danger hover:text-danger"
								disabled={doc.relay.busy}
								onClick={() => {
									setConfirm(false);
									void doc.withdraw().then(said(TOAST_TITLES.cancelled));
								}}
							>
								Yes, cancel it
							</Btn>
							<Btn size="sm" variant="ghost" onClick={() => setConfirm(false)}>
								Keep it
							</Btn>
						</div>
					}
				>
					<Sentence parts={cancelNote(stage.window.validUntil)} />
				</Callout>
			)}
			<Heard when={outcome ?? failure ?? unclear ?? sent}>
				{outcome?.ok === true && (
					<Callout tone="success" title="Signature added" className="mt-3">
						{doc.relay.known
							? "Your co-signers see it now."
							: "Saved in this browser. Nobody else can see it yet: use Share below to send it to your co-signers."}
					</Callout>
				)}
				{outcome?.ok === false && (
					<Callout tone="danger" title="Not signed" className="mt-3">
						<IssueList plain issues={outcome.issues} />
					</Callout>
				)}
				{failure && (
					<Callout tone="danger" title="Not sent" className="mt-3">
						<IssueList plain issues={failure} />
					</Callout>
				)}
				{unclear && (
					<Callout tone="warning" title={TOAST_TITLES.unclear} className="mt-3">
						<IssueList plain issues={unclear.issues} />
					</Callout>
				)}
				{sent === "accepted" && (
					<Callout
						tone="success"
						title="Sent · accepted by Hyperliquid"
						className="mt-3"
					>
						The top of this page shows it against Hyperliquid's record in a
						moment.
					</Callout>
				)}
				{sent === "used" && (
					<Callout tone="warning" title={TOAST_TITLES.used} className="mt-3">
						{SEND_ANSWER.used}
					</Callout>
				)}
				{sent === "refused" && (
					<Callout
						tone="danger"
						title="Sent · refused by Hyperliquid"
						className="mt-3"
					>
						Its reason is at the top of this page. A refused proposal cannot be
						sent again: propose it again.
					</Callout>
				)}
			</Heard>
		</Card>
	);
}

/**
 * At the top of the reader's part: what is signed, once more, where it is
 * signed. The action's own words, its amount and its address whole, and the
 * network it is for.
 */
export function Restated({
	headline,
	network,
}: {
	headline: string;
	network: Network;
}) {
	return (
		<div className="@container mb-3.5 rounded-lg border border-border bg-surface-2 px-3.5 py-3">
			{/* the network beside the action where there is room, under it on a phone */}
			<div className="flex flex-col gap-2 @min-[30rem]:flex-row @min-[30rem]:items-start @min-[30rem]:justify-between @min-[30rem]:gap-3">
				<Headline text={headline} size="sm" className="flex-1" />
				<span className="shrink-0">
					<NetTag network={network} />
				</span>
			</div>
		</div>
	);
}

/**
 * The stop notices that apply, by their titles, right above the buttons:
 * one amber line each. The notices themselves stay in full above the action.
 */
export function StopLines({ titles }: { titles: readonly string[] }) {
	if (titles.length === 0) return null;
	return (
		<ul className="mb-3 flex flex-col gap-1">
			{titles.map((t) => (
				<li
					key={t}
					className="flex items-start gap-1.5 text-[13px] font-medium text-warning"
				>
					<span
						className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-warning"
						aria-hidden
					/>
					<span className="min-w-0 [overflow-wrap:anywhere]">{t}</span>
				</li>
			))}
		</ul>
	);
}
