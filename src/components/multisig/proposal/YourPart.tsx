import {
	type Address,
	type Issue,
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
	signHint,
} from "../model/relay/copy";
import { objectionNote, ownPosition } from "../model/relay/positions";
import { relayActions } from "../model/relay/status";
import { CODE_COPY } from "../model/signingNetwork";
import {
	CANNOT_BE_SENT,
	heldWhat,
	type Stage,
	shortAddress,
} from "../model/stage";
import { untilWords } from "../model/time";
import { Sentence } from "../names/Sentence";
import { Heard } from "../shell/Heard";
import { Help } from "../shell/Help";
import { Btn, Card, Tag } from "../shell/kit";
import { When } from "../shell/live";
import { SwitchToSigner } from "../shell/SwitchToSigner";
import type { WalletSigner } from "../useWalletSigner";
import {
	finalise,
	type Outcome,
	type StepId,
	type StepState,
	signInner,
} from "./actions";
import { CodePanel } from "./CodePanel";
import type { ProposalDoc } from "./useProposalDoc";

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
}) {
	const setNetwork = useNetworkStore((s) => s.setNetwork);
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const [steps, setSteps] = useState<Record<StepId, StepState> | null>(null);
	const [failure, setFailure] = useState<readonly Issue[] | null>(null);
	/** Hyperliquid's answer to this page's own send: accepted, or not. */
	const [sent, setSent] = useState<boolean | null>(null);
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
		}
	};
	const sign = () => void wallet.run("Waiting for the wallet…", doSign);

	const doSubmit = async () => {
		setOutcome(null);
		setFailure(null);
		setSent(null);
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
		if (!result.ok && result.needsNetwork) {
			setNeedsNetwork(true);
			return;
		}
		setNeedsNetwork(false);
		if (!result.ok) {
			setFailure(result.issues);
			return;
		}
		setSent(result.accepted);
		// a staking step that went through changed what the treasury has in staking
		if (result.accepted && stakingActionOf(proposal.payload.action))
			void refreshStaking(
				queries,
				proposal.payload.network,
				proposal.payload.multiSigUser,
			);
		// a vault step that went through changed what the treasury has in vaults
		else if (result.accepted && vaultActionOf(proposal.payload.action))
			void refreshVaults(
				queries,
				proposal.payload.network,
				proposal.payload.multiSigUser,
			);
		// the same for the mode and the API wallets, which are read once a minute otherwise
		else if (result.accepted && modeTargetOf(proposal.payload.action))
			void queries.invalidateQueries({
				queryKey: modeQueryOptions(
					proposal.payload.network,
					proposal.payload.multiSigUser,
				).queryKey,
			});
		else if (result.accepted && proposal.payload.action.type === "approveAgent")
			void queries.invalidateQueries({
				queryKey: agentsQueryOptions(
					proposal.payload.network,
					proposal.payload.multiSigUser,
				).queryKey,
			});
	};
	const submit = () => void wallet.run("Waiting for the wallet…", doSubmit);

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
	const note =
		stage.phase === "stuck"
			? actions.withdraw
				? "It cannot be sent, so nothing here needs a signature. Cancel it, then propose it again with another finaliser."
				: "It cannot be sent, so nothing here needs your signature. Its proposer can cancel it."
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
							? stage.phase === "ready"
								? `You signed this. It is waiting for ${isFinaliser ? "you" : shortAddress(outerSigner)} to send it.`
								: waiting
									? `You signed this. It needs ${waiting} more ${waiting === 1 ? "signature" : "signatures"}; then ${isFinaliser ? "you send" : `${shortAddress(outerSigner)} sends`} it. You can close this page.`
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
			{any && (
				<div className="flex flex-wrap items-center gap-2">
					{stage.canExecute ? (
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
								void doc.takeBack();
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
								void doc.takeBackNo();
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
								void doc.sayNo();
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
									void doc.withdraw();
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
			<Heard when={outcome ?? failure ?? sent}>
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
				{sent === true && (
					<Callout
						tone="success"
						title="Sent · accepted by Hyperliquid"
						className="mt-3"
					>
						The top of this page shows it against Hyperliquid's record in a
						moment.
					</Callout>
				)}
				{sent === false && (
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
